import { createSign } from "crypto";
import { Client, Guild } from "discord.js";
import {
  syncRegistrationSubmissionFromSourceRow,
  RegistrationPlayerInput,
} from "../storage/registrations";
import {
  clearRegistrationSyncIssue,
  logRegistrationSyncFailure,
  logRegistrationSyncPollComplete,
  logRegistrationSyncPollStart,
  recordRegistrationSyncIssue,
  upsertRegistrationSyncSourceState,
} from "../storage/registrationSync";
import { ensureDiscordTeamSetup } from "./discordTeamSetup";
import { getTeamBySubmissionId, syncImportedTeamFromSubmission } from "../storage/teams";

interface SheetSyncSourceConfig {
  sourceKey: string;
  sourceLabel: string;
  spreadsheetId: string;
  worksheetTitle?: string;
  enabled: boolean;
}

interface RegistrationSyncConfig {
  enabled: boolean;
  intervalMs: number;
  serviceAccountEmail?: string;
  privateKey?: string;
  scopes: string[];
  sources: SheetSyncSourceConfig[];
}

interface NormalizedSheetRow {
  rowKey: string;
  rowNumber: number;
  teamName: string;
  leaderDiscordIdentifier: string;
  leaderDisplayName: string;
  discordCommunity: string | null;
  discordCommunityKey: string | null;
  originalSubmittedAt: Date | null;
  mapBan: string | null;
  submittedNotes: string;
  players: RegistrationPlayerInput[];
}

interface RowValidationIssue {
  severity: "warning" | "error";
  reason: string;
}

let syncIntervalHandle: NodeJS.Timeout | undefined;
let pollInFlight = false;

const GOOGLE_SHEETS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

function normalizePrivateKey(value: string | undefined): string | undefined {
  return value?.replace(/\\n/g, "\n").trim() || undefined;
}

function parseSpreadsheetId(rawValue: string | undefined): string {
  const trimmed = rawValue?.trim() || "";

  if (!trimmed) {
    return "";
  }

  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return urlMatch?.[1] ?? trimmed;
}

export function getRegistrationSyncConfig(): RegistrationSyncConfig {
  const intervalSeconds = Number(
    process.env.GOOGLE_SHEETS_SYNC_INTERVAL_SECONDS ?? "120"
  );
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = normalizePrivateKey(
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  );
  const sources: SheetSyncSourceConfig[] = [
    {
      sourceKey: "dd_registration",
      sourceLabel:
        process.env.GOOGLE_SHEET_REGISTRATION_LABEL?.trim() ||
        "Development Division Registration Form",
      spreadsheetId: parseSpreadsheetId(process.env.GOOGLE_SHEET_REGISTRATION_ID),
      worksheetTitle:
        process.env.GOOGLE_SHEET_REGISTRATION_TAB?.trim() || undefined,
      enabled: boolFromEnv(process.env.GOOGLE_SHEET_REGISTRATION_ENABLED, true),
    },
    {
      sourceKey: "7th-circle",
      sourceLabel:
        process.env.GOOGLE_SHEET_7TH_CIRCLE_LABEL?.trim() || "7th Circle",
      spreadsheetId: parseSpreadsheetId(process.env.GOOGLE_SHEET_7TH_CIRCLE_ID),
      worksheetTitle:
        process.env.GOOGLE_SHEET_7TH_CIRCLE_TAB?.trim() ||
        process.env.GOOGLE_SHEET_REGISTRATION_TAB?.trim() ||
        undefined,
      enabled: boolFromEnv(process.env.GOOGLE_SHEET_7TH_CIRCLE_ENABLED, true),
    },
  ];

  return {
    enabled: boolFromEnv(process.env.GOOGLE_SHEETS_SYNC_ENABLED, true),
    intervalMs:
      Number.isFinite(intervalSeconds) && intervalSeconds > 0
        ? intervalSeconds * 1000
        : 120_000,
    serviceAccountEmail,
    privateKey,
    scopes: [GOOGLE_SHEETS_READONLY_SCOPE],
    sources,
  };
}

export function isRegistrationSyncAuthConfigured(
  config = getRegistrationSyncConfig()
): boolean {
  return Boolean(config.serviceAccountEmail && config.privateKey);
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function readCell(row: string[], index: number | undefined): string {
  return (index === undefined ? "" : row[index] ?? "").trim();
}

function normalizeLinkCell(value: string): string {
  return value.trim();
}

function inferOrderFromHeader(header: string): number {
  const normalized = normalizeHeader(header);

  if (normalized.includes("leader") || normalized.includes("captain")) {
    return 0;
  }

  if (normalized.includes("sub") || normalized.includes("substitute")) {
    return 4;
  }

  if (normalized.includes("player1") || normalized.includes("one")) {
    return 1;
  }

  if (normalized.includes("player2") || normalized.includes("two")) {
    return 2;
  }

  if (normalized.includes("player3") || normalized.includes("three")) {
    return 3;
  }

  if (normalized.includes("player4") || normalized.includes("four")) {
    return 4;
  }

  return 99;
}

function findFirstIndex(
  headers: string[],
  matcher: (normalized: string) => boolean
) {
  return headers.findIndex((header) => matcher(normalizeHeader(header)));
}

function findAllIndexes(
  headers: string[],
  matcher: (normalized: string) => boolean
) {
  return headers
    .map((header, index) => ({ header, normalized: normalizeHeader(header), index }))
    .filter(({ normalized }) => matcher(normalized));
}

function findDiscordCommunityIndex(headers: string[]): number {
  return findFirstIndex(headers, (normalized) => {
    const hasDiscord = normalized.includes("discord");
    const hasCommunity = normalized.includes("community");
    const hasServer = normalized.includes("server");
    const hasFrom =
      normalized.includes("from") ||
      normalized.includes("comingfrom") ||
      normalized.includes("origin");

    return (
      (hasDiscord && hasFrom) ||
      (hasDiscord && hasCommunity) ||
      (hasServer && hasFrom)
    );
  });
}

function findTeamNameIndex(headers: string[]): number {
  return findFirstIndex(
    headers,
    (normalized) => normalized.includes("team") && normalized.includes("name")
  );
}

function parseSubmittedAt(value: string): Date | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildSubmittedNotes(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

function normalizeOptionalValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeCommunityKey(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const key = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return key || null;
}

function normalizeRow(
  source: SheetSyncSourceConfig,
  worksheetTitle: string,
  headers: string[],
  row: string[],
  rowNumber: number
): NormalizedSheetRow {
  const teamNameIndex = findTeamNameIndex(headers);
  const timestampIndex = findFirstIndex(
    headers,
    (normalized) => normalized === "timestamp" || normalized.includes("submitted")
  );
  const mapBanIndex = findFirstIndex(
    headers,
    (normalized) => normalized.includes("map") && normalized.includes("ban")
  );
  const leaderDiscordIndex = findFirstIndex(
    headers,
    (normalized) =>
      (normalized.includes("leader") || normalized.includes("captain")) &&
      normalized.includes("discord")
  );
  const leaderNameIndex = findFirstIndex(
    headers,
    (normalized) =>
      (normalized.includes("leader") || normalized.includes("captain")) &&
      normalized.includes("name")
  );
  const discordCommunityIndex = findDiscordCommunityIndex(headers);
  const embarkColumns = findAllIndexes(
    headers,
    (normalized) =>
      normalized.includes("embark") ||
      (normalized.includes("player") && normalized.endsWith("id")) ||
      (normalized.includes("leader") && normalized.endsWith("id")) ||
      (normalized.includes("captain") && normalized.endsWith("id"))
  ).sort(
    (left, right) => inferOrderFromHeader(left.header) - inferOrderFromHeader(right.header)
  );
  const screenshotColumns = findAllIndexes(
    headers,
    (normalized) =>
      normalized.includes("screenshot") ||
      normalized.includes("proof") ||
      normalized.includes("image")
  );
  const playerNameColumns = findAllIndexes(
    headers,
    (normalized) =>
      normalized.includes("name") &&
      (normalized.includes("player") ||
        normalized.includes("leader") ||
        normalized.includes("captain") ||
        normalized.includes("sub"))
  );

  const teamName = readCell(row, teamNameIndex);

  if (!teamName) {
    throw new Error("Missing team name.");
  }

  const embarkEntries = embarkColumns
    .map(({ header, index }) => ({
      order: inferOrderFromHeader(header),
      embarkId: readCell(row, index),
      displayName:
        readCell(
          row,
          playerNameColumns.find(
            (column) =>
              inferOrderFromHeader(column.header) === inferOrderFromHeader(header)
          )?.index
        ) || "",
      screenshotLink: normalizeLinkCell(
        readCell(
          row,
          screenshotColumns.find(
            (column) =>
              inferOrderFromHeader(column.header) === inferOrderFromHeader(header)
          )?.index
        )
      ),
    }))
    .filter((entry) => entry.embarkId);

  if (embarkEntries.length < 3) {
    throw new Error("Fewer than 3 player Embark IDs were found.");
  }

  const leaderEntry = embarkEntries.find((entry) => entry.order === 0) ?? embarkEntries[0];
  const leaderDisplayName =
    readCell(row, leaderNameIndex) || leaderEntry.displayName || "Leader";
  const fallbackScreenshot = normalizeLinkCell(
    readCell(row, screenshotColumns[0]?.index)
  );

  const players = embarkEntries
    .sort((left, right) => left.order - right.order)
    .map((entry, index) => ({
      displayName:
        index === 0
          ? leaderDisplayName
          : entry.displayName || (entry.order === 4 ? "Substitute" : `Player ${index + 1}`),
      embarkId: entry.embarkId.trim(),
      screenshotLink: entry.screenshotLink || fallbackScreenshot,
      discordUserId:
        index === 0
          ? readCell(row, leaderDiscordIndex).replace(/[<@!>]/g, "").trim()
          : undefined,
      isLeader: index === 0,
      sortOrder: index,
    }));

  const rowKey = `${source.spreadsheetId}:${worksheetTitle}:${rowNumber}`;
  return {
    rowKey,
    rowNumber,
    teamName,
    leaderDiscordIdentifier: readCell(row, leaderDiscordIndex)
      .replace(/[<@!>]/g, "")
      .trim(),
    leaderDisplayName,
    discordCommunity: normalizeOptionalValue(readCell(row, discordCommunityIndex)),
    discordCommunityKey: normalizeCommunityKey(
      normalizeOptionalValue(readCell(row, discordCommunityIndex))
    ),
    originalSubmittedAt: parseSubmittedAt(readCell(row, timestampIndex)),
    mapBan: readCell(row, mapBanIndex) || null,
    submittedNotes: buildSubmittedNotes([
      readCell(row, mapBanIndex) ? `Map Ban: ${readCell(row, mapBanIndex)}` : null,
      `Synced from ${source.sourceLabel} row ${rowNumber}.`,
    ]),
    players,
  };
}

function getRowValidationIssues(row: NormalizedSheetRow): RowValidationIssue[] {
  const issues: RowValidationIssue[] = [];
  const missingAccessPlayers = row.players.filter((player) =>
    player.screenshotLink.toLowerCase().includes("missing access")
  );

  if (missingAccessPlayers.length > 0) {
    issues.push({
      severity: "warning",
      reason: `Missing Access (${missingAccessPlayers
        .map((player) => player.displayName)
        .join(", ")})`,
    });
  }

  return issues;
}

function toBase64Url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function quoteWorksheetTitleForA1(worksheetTitle: string): string {
  return `'${worksheetTitle.replace(/'/g, "''")}'`;
}

function buildWorksheetA1Range(worksheetTitle: string): string {
  return `${quoteWorksheetTitleForA1(worksheetTitle)}!A:ZZ`;
}

async function readGoogleErrorBody(response: Response): Promise<string> {
  const rawBody = await response.text();

  if (!rawBody) {
    return "No response body.";
  }

  try {
    const parsed = JSON.parse(rawBody) as {
      error?: {
        message?: string;
        status?: string;
        errors?: Array<{ message?: string; reason?: string }>;
      };
    };
    const topLevelMessage = parsed.error?.message ?? rawBody;
    const reasons =
      parsed.error?.errors
        ?.map((entry) => [entry.reason, entry.message].filter(Boolean).join(": "))
        .filter(Boolean)
        .join(" | ") ?? "";

    return reasons ? `${topLevelMessage} | ${reasons}` : topLevelMessage;
  } catch {
    return rawBody;
  }
}

async function getGoogleAccessToken(config: RegistrationSyncConfig): Promise<string> {
  if (!config.serviceAccountEmail || !config.privateKey) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL and/or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY."
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: config.serviceAccountEmail,
    scope: config.scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    exp: nowSeconds + 3600,
    iat: nowSeconds,
  };
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(
    JSON.stringify(payload)
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(config.privateKey, "base64url");
  const assertion = `${signingInput}.${signature}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google auth failed with ${response.status}.`);
  }

  const body = (await response.json()) as { access_token?: string };

  if (!body.access_token) {
    throw new Error("Google auth response did not include an access token.");
  }

  return body.access_token;
}

async function fetchSpreadsheetMetadata(
  spreadsheetId: string,
  accessToken: string
): Promise<{ title: string }[]> {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(title,index))`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const errorBody = await readGoogleErrorBody(response);
    throw new Error(
      `Google Sheets metadata fetch failed with ${response.status}: ${errorBody}`
    );
  }

  const body = (await response.json()) as {
    sheets?: Array<{ properties?: { title?: string } }>;
  };

  return (body.sheets ?? [])
    .map((sheet) => ({ title: sheet.properties?.title ?? "" }))
    .filter((sheet) => sheet.title);
}

async function fetchSheetValues(
  source: SheetSyncSourceConfig,
  spreadsheetId: string,
  worksheetTitle: string,
  requestedRange: string,
  accessToken: string
): Promise<string[][]> {
  const range = encodeURIComponent(requestedRange);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const errorBody = await readGoogleErrorBody(response);
    throw new Error(
      [
        `Google Sheets values fetch failed with ${response.status}.`,
        `Source: ${source.sourceLabel}`,
        `Spreadsheet: ${spreadsheetId}`,
        `Worksheet: ${worksheetTitle}`,
        `Range: ${requestedRange}`,
        `Auth initialized: yes`,
        `Scopes: ${getRegistrationSyncConfig().scopes.join(", ")}`,
        `Google error: ${errorBody}`,
      ].join(" ")
    );
  }

  const body = (await response.json()) as { values?: string[][] };
  return body.values ?? [];
}

async function syncSource(
  source: SheetSyncSourceConfig,
  accessToken: string,
  guild: Guild | null
): Promise<void> {
  if (!source.enabled) {
    await upsertRegistrationSyncSourceState({
      sourceKey: source.sourceKey,
      sourceLabel: source.sourceLabel,
      spreadsheetId: source.spreadsheetId,
      worksheetTitle: source.worksheetTitle ?? null,
      lastResolvedRange: source.worksheetTitle
        ? buildWorksheetA1Range(source.worksheetTitle)
        : null,
      enabled: false,
      lastImportedCount: 0,
      lastDuplicateCount: 0,
      lastInvalidCount: 0,
    });
    return;
  }

  if (!source.spreadsheetId) {
    await upsertRegistrationSyncSourceState({
      sourceKey: source.sourceKey,
      sourceLabel: source.sourceLabel,
      spreadsheetId: "",
      worksheetTitle: source.worksheetTitle ?? null,
      lastResolvedRange: source.worksheetTitle
        ? buildWorksheetA1Range(source.worksheetTitle)
        : null,
      enabled: false,
      lastCheckedAt: new Date(),
      lastImportedCount: 0,
      lastDuplicateCount: 0,
      lastInvalidCount: 0,
      lastSummaryJson: JSON.stringify({
        skipped: 1,
        reason: "missing_spreadsheet_id",
      }),
      lastError: null,
    });
    return;
  }

  await logRegistrationSyncPollStart(source.sourceLabel);

  try {
    const worksheetTitle =
      source.worksheetTitle ??
      (await fetchSpreadsheetMetadata(source.spreadsheetId, accessToken))[0]?.title;

    if (!worksheetTitle) {
      throw new Error("No worksheet title was configured or discovered.");
    }

    const requestedRange = buildWorksheetA1Range(worksheetTitle);

    const values = await fetchSheetValues(
      source,
      source.spreadsheetId,
      worksheetTitle,
      requestedRange,
      accessToken
    );
    const headers = values[0] ?? [];
    let imported = 0;
    let unchanged = 0;
    let invalid = 0;
    let warnings = 0;
    let updated = 0;
    let teamNameChanges = 0;
    let communityChanges = 0;
    let rolesCreated = 0;
    let rolesRenamed = 0;
    let channelsCreated = 0;
    let channelsRenamed = 0;

    for (let index = 1; index < values.length; index += 1) {
      const row = values[index] ?? [];
      const rowNumber = index + 1;
      const rowKey = `${source.spreadsheetId}:${worksheetTitle}:${rowNumber}`;

      if (row.every((cell) => !cell?.trim())) {
        continue;
      }

      try {
        const normalized = normalizeRow(
          source,
          worksheetTitle,
          headers,
          row,
          rowNumber
        );
        const validationIssues = getRowValidationIssues(normalized);
        const warningReasons = validationIssues
          .filter((issue) => issue.severity === "warning")
          .map((issue) => issue.reason);
        const submittedNotesWithWarnings = [
          normalized.submittedNotes,
          ...warningReasons.map((reason) => `Validation warning: ${reason}`),
        ]
          .filter(Boolean)
          .join("\n");

        const result = await syncRegistrationSubmissionFromSourceRow({
          teamName: normalized.teamName,
          leaderDiscordUserId: normalized.leaderDiscordIdentifier,
          leaderDisplayName: normalized.leaderDisplayName,
          discordCommunity: normalized.discordCommunity,
          sourceLabel: source.sourceLabel,
          sourceSpreadsheetId: source.spreadsheetId,
          sourceWorksheetTitle: worksheetTitle,
          sourceRowKey: rowKey,
          sourceRowNumber: normalized.rowNumber,
          originalSubmittedAt: normalized.originalSubmittedAt,
          mapBan: normalized.mapBan,
          submittedNotes: submittedNotesWithWarnings,
          actorDiscordUserId: "google-sheets-sync",
          actorDisplayName: "Google Sheets Sync",
          players: normalized.players,
        });

        for (const warning of warningReasons) {
          warnings += 1;
          await recordRegistrationSyncIssue({
            sourceKey: source.sourceKey,
            sourceLabel: source.sourceLabel,
            spreadsheetId: source.spreadsheetId,
            worksheetTitle,
            rowKey,
            rowNumber,
            rawTeamName: normalized.teamName,
            reason: warning,
            severity: "warning",
          });
        }
        if (warningReasons.length === 0) {
          await clearRegistrationSyncIssue(rowKey);
        }

        if (result.created) {
          imported += 1;
        }

        const teamSync = await syncImportedTeamFromSubmission(
          result.submission,
          "google-sheets-sync"
        );

        if (result.updated || teamSync.updated) {
          updated += 1;
          if (result.teamNameChanged) {
            teamNameChanges += 1;
          }
          if (result.communityChanged) {
            communityChanges += 1;
          }

          if (teamSync.team && guild) {
            const setup = await ensureDiscordTeamSetup(
              guild,
              teamSync.team,
              "google-sheets-sync",
              teamSync.previousTeamName
            );
            if (setup.roleAction === "created") rolesCreated += 1;
            if (setup.roleAction === "renamed") rolesRenamed += 1;
            if (setup.voiceAction === "created") channelsCreated += 1;
            if (setup.voiceAction === "renamed") channelsRenamed += 1;
          }
        } else {
          const team = teamSync.team ?? (await getTeamBySubmissionId(result.submission.id));
          if (team && guild) {
            const setup = await ensureDiscordTeamSetup(
              guild,
              team,
              "google-sheets-sync"
            );
            if (setup.roleAction === "created") rolesCreated += 1;
            if (setup.voiceAction === "created") channelsCreated += 1;
          } else {
            unchanged += 1;
          }
        }
      } catch (error) {
        invalid += 1;

        const teamNameIndex = findTeamNameIndex(headers);

        await recordRegistrationSyncIssue({
          sourceKey: source.sourceKey,
          sourceLabel: source.sourceLabel,
          spreadsheetId: source.spreadsheetId,
          worksheetTitle,
          rowKey,
          rowNumber,
          rawTeamName: readCell(row, teamNameIndex) || null,
          reason: error instanceof Error ? error.message : "Unknown row parse error.",
          severity: "error",
        });
      }
    }

    await upsertRegistrationSyncSourceState({
      sourceKey: source.sourceKey,
      sourceLabel: source.sourceLabel,
      spreadsheetId: source.spreadsheetId,
      worksheetTitle,
      lastResolvedRange: requestedRange,
      enabled: true,
      lastCheckedAt: new Date(),
      lastSuccessfulSyncAt: new Date(),
      lastImportedCount: imported,
      lastDuplicateCount: unchanged,
      lastInvalidCount: invalid,
      lastWarningCount: warnings,
      lastSummaryJson: JSON.stringify({
        teamsCreated: imported,
        teamsUpdated: updated,
        teamNameChanges,
        communityMetadataChanges: communityChanges,
        discordRolesCreated: rolesCreated,
        discordRolesRenamed: rolesRenamed,
        discordChannelsCreated: channelsCreated,
        discordChannelsRenamed: channelsRenamed,
        warnings,
        blockingErrors: invalid,
        instanceAssignmentsChanged: 0,
      }),
      lastError: null,
    });

    await logRegistrationSyncPollComplete({
      sourceLabel: source.sourceLabel,
      imported,
      duplicates: unchanged,
      invalid,
      details: [
        `warnings=${warnings}`,
        `blocking_errors=${invalid}`,
        `teams_updated=${updated}`,
        `team_name_changes=${teamNameChanges}`,
        `community_changes=${communityChanges}`,
        `roles_created=${rolesCreated}`,
        `roles_renamed=${rolesRenamed}`,
        `channels_created=${channelsCreated}`,
        `channels_renamed=${channelsRenamed}`,
        "instance_assignments_changed=0",
      ].join(" "),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Google Sheets sync error.";
    await upsertRegistrationSyncSourceState({
      sourceKey: source.sourceKey,
      sourceLabel: source.sourceLabel,
      spreadsheetId: source.spreadsheetId,
      worksheetTitle: source.worksheetTitle ?? null,
      lastResolvedRange: source.worksheetTitle
        ? buildWorksheetA1Range(source.worksheetTitle)
        : null,
      enabled: true,
      lastCheckedAt: new Date(),
      lastImportedCount: 0,
      lastDuplicateCount: 0,
      lastInvalidCount: 0,
      lastWarningCount: 0,
      lastSummaryJson: null,
      lastError: message,
    });
    await logRegistrationSyncFailure({
      sourceLabel: source.sourceLabel,
      errorMessage: message,
    });
    console.error(`[registration-sync] ${source.sourceLabel}: ${message}`);
  }
}

export async function pollRegistrationSheetsOnce(client?: Client): Promise<void> {
  const config = getRegistrationSyncConfig();

  if (!config.enabled) {
    return;
  }

  if (pollInFlight) {
    return;
  }

  pollInFlight = true;

  try {
    const accessToken = await getGoogleAccessToken(config);
    const guildId = process.env.DISCORD_GUILD_ID?.trim();
    const guild =
      guildId && client ? await client.guilds.fetch(guildId).catch(() => null) : null;

    for (const source of config.sources) {
      await syncSource(source, accessToken, guild);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown registration sync error.";
    console.error(`[registration-sync] startup poll failed: ${message}`);
  } finally {
    pollInFlight = false;
  }
}

export function startRegistrationSheetSyncPolling(client?: Client): void {
  const config = getRegistrationSyncConfig();

  if (!config.enabled) {
    console.log("[registration-sync] polling disabled via env.");
    return;
  }

  if (!config.serviceAccountEmail || !config.privateKey) {
    console.error(
      "[registration-sync] missing Google service account config; polling not started."
    );
    return;
  }

  const enabledConfiguredSources = config.sources.filter(
    (source) => source.enabled && source.spreadsheetId
  );

  if (enabledConfiguredSources.length === 0) {
    console.error(
      "[registration-sync] no enabled+configured registration sources found; polling not started."
    );
    return;
  }

  if (syncIntervalHandle) {
    return;
  }

  void pollRegistrationSheetsOnce(client);
  syncIntervalHandle = setInterval(() => {
    void pollRegistrationSheetsOnce(client);
  }, config.intervalMs);
  syncIntervalHandle.unref?.();

  console.log(
    `[registration-sync] polling ${config.sources
      .filter((source) => source.enabled && source.spreadsheetId)
      .map((source) => source.sourceLabel)
      .join(", ")} every ${Math.round(config.intervalMs / 1000)}s. scopes=${config.scopes.join(
      ","
    )}`
  );
}

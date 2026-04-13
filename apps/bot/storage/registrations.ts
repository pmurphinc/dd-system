import { prisma } from "./prisma";
import { createAuditLog } from "./auditLog";
import { notifyPanelDataChanged } from "../services/panelRefreshBus";

export type RegistrationStatus = "pending" | "approved" | "rejected";

export interface RegistrationPlayerInput {
  displayName: string;
  discordUserId?: string;
  embarkId: string;
  screenshotLink: string;
  isLeader: boolean;
  sortOrder: number;
}

export interface RegistrationSubmissionInput {
  teamName: string;
  leaderDiscordUserId: string;
  leaderDisplayName: string;
  discordCommunity?: string | null;
  sourceLabel?: string;
  sourceSpreadsheetId?: string;
  sourceWorksheetTitle?: string;
  sourceRowKey?: string;
  sourceRowNumber?: number;
  originalSubmittedAt?: Date | null;
  mapBan?: string;
  syncImportedAt?: Date | null;
  submittedNotes: string;
  createdByDiscordUserId: string;
  createdByDisplayName: string;
  players: RegistrationPlayerInput[];
}

export interface StoredRegistrationPlayer extends RegistrationPlayerInput {
  id: number;
  submissionId: number;
}

export interface StoredRegistrationSubmission {
  id: number;
  teamName: string;
  leaderDiscordUserId: string;
  leaderDisplayName: string;
  discordCommunity: string | null;
  sourceLabel: string | null;
  sourceSpreadsheetId: string | null;
  sourceWorksheetTitle: string | null;
  sourceRowKey: string | null;
  sourceRowNumber: number | null;
  originalSubmittedAt: Date | null;
  mapBan: string | null;
  syncImportedAt: Date | null;
  reviewStatus: RegistrationStatus;
  reviewerNotes: string;
  submittedNotes: string;
  importedTeamId: number | null;
  createdByDiscordUserId: string;
  createdByDisplayName: string;
  createdAt: Date;
  updatedAt: Date;
  players: StoredRegistrationPlayer[];
}

export interface RegistrationSummary {
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
}

let registrationTablesReady: Promise<void> | undefined;

async function ensureColumn(
  tableName: string,
  columnName: string,
  alterSql: string
): Promise<void> {
  const columns = (await prisma.$queryRawUnsafe(
    `PRAGMA table_info("${tableName}")`
  )) as Array<{ name: string }>;

  if (!columns.some((column) => column.name === columnName)) {
    await prisma.$executeRawUnsafe(alterSql);
  }
}

async function ensureRegistrationTables(): Promise<void> {
  registrationTablesReady ??= Promise.resolve().then(async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RegistrationSubmission" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "teamName" TEXT NOT NULL,
        "leaderDiscordUserId" TEXT NOT NULL,
        "leaderDisplayName" TEXT NOT NULL DEFAULT '',
        "discordCommunity" TEXT,
        "sourceLabel" TEXT,
        "sourceSpreadsheetId" TEXT,
        "sourceWorksheetTitle" TEXT,
        "sourceRowKey" TEXT,
        "sourceRowNumber" INTEGER,
        "originalSubmittedAt" DATETIME,
        "mapBan" TEXT,
        "syncImportedAt" DATETIME,
        "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
        "reviewerNotes" TEXT NOT NULL DEFAULT '',
        "submittedNotes" TEXT NOT NULL DEFAULT '',
        "importedTeamId" INTEGER,
        "createdByDiscordUserId" TEXT NOT NULL DEFAULT '',
        "createdByDisplayName" TEXT NOT NULL DEFAULT '',
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL
      )
    `);

    await ensureColumn(
      "RegistrationSubmission",
      "leaderDisplayName",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "leaderDisplayName" TEXT NOT NULL DEFAULT ''`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "discordCommunity",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "discordCommunity" TEXT`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "sourceLabel",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "sourceLabel" TEXT`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "sourceSpreadsheetId",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "sourceSpreadsheetId" TEXT`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "sourceWorksheetTitle",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "sourceWorksheetTitle" TEXT`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "sourceRowKey",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "sourceRowKey" TEXT`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "sourceRowNumber",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "sourceRowNumber" INTEGER`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "originalSubmittedAt",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "originalSubmittedAt" DATETIME`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "mapBan",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "mapBan" TEXT`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "syncImportedAt",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "syncImportedAt" DATETIME`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "reviewStatus",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'pending'`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "reviewerNotes",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "reviewerNotes" TEXT NOT NULL DEFAULT ''`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "submittedNotes",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "submittedNotes" TEXT NOT NULL DEFAULT ''`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "importedTeamId",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "importedTeamId" INTEGER`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "createdByDiscordUserId",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "createdByDiscordUserId" TEXT NOT NULL DEFAULT ''`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "createdByDisplayName",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "createdByDisplayName" TEXT NOT NULL DEFAULT ''`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "createdAt",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`
    );
    await ensureColumn(
      "RegistrationSubmission",
      "updatedAt",
      `ALTER TABLE "RegistrationSubmission" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`
    );

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "RegistrationSubmission_sourceRowKey_key"
      ON "RegistrationSubmission" ("sourceRowKey")
      WHERE "sourceRowKey" IS NOT NULL
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RegistrationPlayer" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "submissionId" INTEGER NOT NULL,
        "displayName" TEXT NOT NULL,
        "discordUserId" TEXT,
        "embarkId" TEXT NOT NULL,
        "screenshotLink" TEXT NOT NULL,
        "isLeader" BOOLEAN NOT NULL DEFAULT false,
        "sortOrder" INTEGER NOT NULL DEFAULT 0
      )
    `);

    await ensureColumn(
      "RegistrationPlayer",
      "discordUserId",
      `ALTER TABLE "RegistrationPlayer" ADD COLUMN "discordUserId" TEXT`
    );
    await ensureColumn(
      "RegistrationPlayer",
      "embarkId",
      `ALTER TABLE "RegistrationPlayer" ADD COLUMN "embarkId" TEXT NOT NULL DEFAULT ''`
    );
    await ensureColumn(
      "RegistrationPlayer",
      "screenshotLink",
      `ALTER TABLE "RegistrationPlayer" ADD COLUMN "screenshotLink" TEXT NOT NULL DEFAULT ''`
    );
    await ensureColumn(
      "RegistrationPlayer",
      "isLeader",
      `ALTER TABLE "RegistrationPlayer" ADD COLUMN "isLeader" BOOLEAN NOT NULL DEFAULT false`
    );
    await ensureColumn(
      "RegistrationPlayer",
      "sortOrder",
      `ALTER TABLE "RegistrationPlayer" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0`
    );
  });

  await registrationTablesReady;
}

function mapSubmission(record: {
  id: number;
  teamName: string;
  leaderDiscordUserId: string;
  leaderDisplayName: string;
  discordCommunity: string | null;
  sourceLabel: string | null;
  sourceSpreadsheetId: string | null;
  sourceWorksheetTitle: string | null;
  sourceRowKey: string | null;
  sourceRowNumber: number | null;
  originalSubmittedAt: Date | null;
  mapBan: string | null;
  syncImportedAt: Date | null;
  reviewStatus: string;
  reviewerNotes: string;
  submittedNotes: string;
  importedTeamId: number | null;
  createdByDiscordUserId: string;
  createdByDisplayName: string;
  createdAt: Date;
  updatedAt: Date;
  players: Array<{
    id: number;
    submissionId: number;
    displayName: string;
    discordUserId: string | null;
    embarkId: string;
    screenshotLink: string;
    isLeader: boolean;
    sortOrder: number;
  }>;
}): StoredRegistrationSubmission {
  return {
    id: record.id,
    teamName: record.teamName,
    leaderDiscordUserId: record.leaderDiscordUserId,
    leaderDisplayName: record.leaderDisplayName,
    discordCommunity: record.discordCommunity,
    sourceLabel: record.sourceLabel,
    sourceSpreadsheetId: record.sourceSpreadsheetId,
    sourceWorksheetTitle: record.sourceWorksheetTitle,
    sourceRowKey: record.sourceRowKey,
    sourceRowNumber: record.sourceRowNumber,
    originalSubmittedAt: record.originalSubmittedAt
      ? new Date(record.originalSubmittedAt)
      : null,
    mapBan: record.mapBan,
    syncImportedAt: record.syncImportedAt ? new Date(record.syncImportedAt) : null,
    reviewStatus: record.reviewStatus as RegistrationStatus,
    reviewerNotes: record.reviewerNotes,
    submittedNotes: record.submittedNotes,
    importedTeamId: record.importedTeamId,
    createdByDiscordUserId: record.createdByDiscordUserId,
    createdByDisplayName: record.createdByDisplayName,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    players: record.players.map((player) => ({
      id: player.id,
      submissionId: player.submissionId,
      displayName: player.displayName,
      discordUserId: player.discordUserId ?? undefined,
      embarkId: player.embarkId,
      screenshotLink: player.screenshotLink,
      isLeader: player.isLeader,
      sortOrder: player.sortOrder,
    })),
  };
}

export async function createRegistrationSubmission(
  input: RegistrationSubmissionInput
): Promise<StoredRegistrationSubmission> {
  await ensureRegistrationTables();

  const now = new Date();
  const leaderPlayer =
    input.players.find((player) => player.isLeader) ?? input.players[0];
  const leaderDisplayName = input.leaderDisplayName.trim() || leaderPlayer?.displayName || "Leader";
  const leaderDiscordUserId =
    input.leaderDiscordUserId.trim() || leaderPlayer?.discordUserId || "";
  const created = await prisma.registrationSubmission.create({
    data: {
      teamName: input.teamName,
      leaderDiscordUserId,
      leaderDisplayName,
      discordCommunity: input.discordCommunity?.trim() || null,
      sourceLabel: input.sourceLabel ?? null,
      sourceSpreadsheetId: input.sourceSpreadsheetId ?? null,
      sourceWorksheetTitle: input.sourceWorksheetTitle ?? null,
      sourceRowKey: input.sourceRowKey ?? null,
      sourceRowNumber: input.sourceRowNumber ?? null,
      originalSubmittedAt: input.originalSubmittedAt ?? null,
      mapBan: input.mapBan ?? null,
      syncImportedAt: input.syncImportedAt ?? null,
      reviewStatus: "pending",
      reviewerNotes: "",
      submittedNotes: input.submittedNotes,
      createdByDiscordUserId: input.createdByDiscordUserId,
      createdByDisplayName: input.createdByDisplayName,
      createdAt: now,
      updatedAt: now,
      players: {
        create: input.players.map((player) => ({
          displayName: player.displayName,
          discordUserId: player.discordUserId ?? null,
          embarkId: player.embarkId,
          screenshotLink: player.screenshotLink,
          isLeader: player.isLeader,
          sortOrder: player.sortOrder,
        })),
      },
    },
    include: {
      players: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  await createAuditLog({
    action: "registration_created",
    entityType: "registration_submission",
    entityId: `${created.id}`,
    summary: `Created submission for ${created.teamName}.`,
    details: created.sourceRowKey
      ? `Synced from ${created.sourceLabel ?? "manual"} row ${created.sourceRowNumber ?? "?"}.${created.discordCommunity ? ` Community: ${created.discordCommunity}.` : ""}`
      : `Players: ${created.players.length}.${created.discordCommunity ? ` Community: ${created.discordCommunity}.` : ""}`,
    actorDiscordUserId: input.createdByDiscordUserId,
  });

  return mapSubmission(created);
}

export async function hasRegistrationSourceRowKey(
  sourceRowKey: string
): Promise<boolean> {
  await ensureRegistrationTables();

  const count = await prisma.registrationSubmission.count({
    where: { sourceRowKey },
  });

  return count > 0;
}

export async function getRegistrationBySourceRowKey(
  sourceRowKey: string
): Promise<StoredRegistrationSubmission | null> {
  await ensureRegistrationTables();

  const row = await prisma.registrationSubmission.findUnique({
    where: { sourceRowKey },
    include: {
      players: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return row ? mapSubmission(row) : null;
}

export async function syncRegistrationSubmissionFromSourceRow(input: {
  sourceRowKey: string;
  teamName: string;
  leaderDiscordUserId: string;
  leaderDisplayName: string;
  discordCommunity: string | null;
  sourceLabel: string;
  sourceSpreadsheetId: string;
  sourceWorksheetTitle: string;
  sourceRowNumber: number;
  originalSubmittedAt: Date | null;
  mapBan: string | null;
  submittedNotes: string;
  players: RegistrationPlayerInput[];
  actorDiscordUserId: string;
  actorDisplayName: string;
}): Promise<{
  submission: StoredRegistrationSubmission;
  created: boolean;
  updated: boolean;
  teamNameChanged: boolean;
  communityChanged: boolean;
}> {
  await ensureRegistrationTables();

  const existing = await getRegistrationBySourceRowKey(input.sourceRowKey);

  if (!existing) {
    const created = await createRegistrationSubmission({
      teamName: input.teamName,
      leaderDiscordUserId: input.leaderDiscordUserId,
      leaderDisplayName: input.leaderDisplayName,
      discordCommunity: input.discordCommunity,
      sourceLabel: input.sourceLabel,
      sourceSpreadsheetId: input.sourceSpreadsheetId,
      sourceWorksheetTitle: input.sourceWorksheetTitle,
      sourceRowKey: input.sourceRowKey,
      sourceRowNumber: input.sourceRowNumber,
      originalSubmittedAt: input.originalSubmittedAt,
      mapBan: input.mapBan ?? undefined,
      syncImportedAt: new Date(),
      submittedNotes: input.submittedNotes,
      createdByDiscordUserId: input.actorDiscordUserId,
      createdByDisplayName: input.actorDisplayName,
      players: input.players,
    });

    return {
      submission: created,
      created: true,
      updated: false,
      teamNameChanged: false,
      communityChanged: false,
    };
  }

  const incomingCommunity = input.discordCommunity?.trim() || null;
  const existingCommunity = existing.discordCommunity?.trim() || null;
  const incomingLeaderId = input.leaderDiscordUserId.trim();
  const existingLeaderId = existing.leaderDiscordUserId.trim();
  const incomingLeaderName = input.leaderDisplayName.trim();
  const existingLeaderName = existing.leaderDisplayName.trim();
  const teamNameChanged = existing.teamName !== input.teamName;
  const communityChanged = existingCommunity !== incomingCommunity;
  const metadataChanged =
    teamNameChanged ||
    communityChanged ||
    existing.sourceRowNumber !== input.sourceRowNumber ||
    existing.mapBan !== (input.mapBan ?? null) ||
    existing.submittedNotes !== input.submittedNotes ||
    existing.sourceWorksheetTitle !== input.sourceWorksheetTitle ||
    existing.sourceSpreadsheetId !== input.sourceSpreadsheetId ||
    existing.sourceLabel !== input.sourceLabel ||
    existingLeaderId !== incomingLeaderId ||
    existingLeaderName !== incomingLeaderName ||
    (existing.originalSubmittedAt?.toISOString() ?? null) !==
      (input.originalSubmittedAt?.toISOString() ?? null);

  const existingPlayers = [...existing.players]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((player) => ({
      displayName: player.displayName,
      discordUserId: player.discordUserId ?? null,
      embarkId: player.embarkId,
      screenshotLink: player.screenshotLink,
      isLeader: player.isLeader,
      sortOrder: player.sortOrder,
    }));
  const incomingPlayers = [...input.players]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((player) => ({
      displayName: player.displayName,
      discordUserId: player.discordUserId ?? null,
      embarkId: player.embarkId,
      screenshotLink: player.screenshotLink,
      isLeader: player.isLeader,
      sortOrder: player.sortOrder,
    }));
  const playersChanged =
    JSON.stringify(existingPlayers) !== JSON.stringify(incomingPlayers);

  if (!metadataChanged && !playersChanged) {
    return {
      submission: existing,
      created: false,
      updated: false,
      teamNameChanged: false,
      communityChanged: false,
    };
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx: any) => {
    const submission = await tx.registrationSubmission.update({
      where: { id: existing.id },
      data: {
        teamName: input.teamName,
        leaderDiscordUserId: incomingLeaderId,
        leaderDisplayName: incomingLeaderName || "Leader",
        discordCommunity: incomingCommunity,
        sourceLabel: input.sourceLabel,
        sourceSpreadsheetId: input.sourceSpreadsheetId,
        sourceWorksheetTitle: input.sourceWorksheetTitle,
        sourceRowNumber: input.sourceRowNumber,
        originalSubmittedAt: input.originalSubmittedAt,
        mapBan: input.mapBan ?? null,
        syncImportedAt: now,
        submittedNotes: input.submittedNotes,
        updatedAt: now,
      },
      include: {
        players: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (playersChanged) {
      await tx.registrationPlayer.deleteMany({
        where: { submissionId: existing.id },
      });
      await tx.registrationPlayer.createMany({
        data: input.players.map((player) => ({
          submissionId: existing.id,
          displayName: player.displayName,
          discordUserId: player.discordUserId ?? null,
          embarkId: player.embarkId,
          screenshotLink: player.screenshotLink,
          isLeader: player.isLeader,
          sortOrder: player.sortOrder,
        })),
      });
    }

    return tx.registrationSubmission.findUniqueOrThrow({
      where: { id: submission.id },
      include: {
        players: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  });

  await createAuditLog({
    action: "registration_synced_from_sheet",
    entityType: "registration_submission",
    entityId: `${updated.id}`,
    summary: `Synced submission for ${updated.teamName} from Google Sheets.`,
    details: [
      teamNameChanged ? `Team renamed from "${existing.teamName}" to "${updated.teamName}".` : null,
      communityChanged
        ? `Community changed from "${existingCommunity ?? "none"}" to "${incomingCommunity ?? "none"}".`
        : null,
      playersChanged ? "Player roster updated from source row." : null,
      "Tournament instance placement was not modified by sync.",
    ]
      .filter(Boolean)
      .join(" "),
    actorDiscordUserId: input.actorDiscordUserId,
  });

  return {
    submission: mapSubmission(updated),
    created: false,
    updated: true,
    teamNameChanged,
    communityChanged,
  };
}

export async function getRegistrationSummary(): Promise<RegistrationSummary> {
  await ensureRegistrationTables();

  const [pendingCount, approvedCount, rejectedCount] = await Promise.all([
    prisma.registrationSubmission.count({
      where: { reviewStatus: "pending" },
    }),
    prisma.registrationSubmission.count({
      where: { reviewStatus: "approved" },
    }),
    prisma.registrationSubmission.count({
      where: { reviewStatus: "rejected" },
    }),
  ]);

  return {
    pendingCount,
    approvedCount,
    rejectedCount,
  };
}

export async function listRegistrationsByStatus(
  status: RegistrationStatus,
  limit = 25
): Promise<StoredRegistrationSubmission[]> {
  await ensureRegistrationTables();

  const rows = await prisma.registrationSubmission.findMany({
    where: { reviewStatus: status },
    include: {
      players: {
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
  });

  return rows.map(mapSubmission);
}

export async function getRegistrationById(
  id: number
): Promise<StoredRegistrationSubmission | null> {
  await ensureRegistrationTables();

  const row = await prisma.registrationSubmission.findUnique({
    where: { id },
    include: {
      players: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return row ? mapSubmission(row) : null;
}

export async function updateRegistrationStatus(
  id: number,
  status: RegistrationStatus,
  reviewerNotes: string,
  actorDiscordUserId: string
): Promise<StoredRegistrationSubmission | null> {
  await ensureRegistrationTables();

  const existing = await getRegistrationById(id);

  if (!existing) {
    return null;
  }

  const updated = await prisma.registrationSubmission.update({
    where: { id },
    data: {
      reviewStatus: status,
      reviewerNotes,
      updatedAt: new Date(),
    },
    include: {
      players: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  await createAuditLog({
    action: `registration_${status}`,
    entityType: "registration_submission",
    entityId: `${id}`,
    summary: `${updated.teamName} marked ${status}.`,
    details: `${reviewerNotes || "No reviewer notes."}${updated.discordCommunity ? ` Community: ${updated.discordCommunity}.` : ""}`,
    actorDiscordUserId,
  });

  notifyPanelDataChanged({
    reason: "registration_status_updated",
    panelTypes: ["admin", "tournament"],
  });

  return mapSubmission(updated);
}

export async function updateRegistrationReviewerNotes(
  id: number,
  reviewerNotes: string,
  actorDiscordUserId: string
): Promise<StoredRegistrationSubmission | null> {
  await ensureRegistrationTables();

  const existing = await getRegistrationById(id);

  if (!existing) {
    return null;
  }

  const updated = await prisma.registrationSubmission.update({
    where: { id },
    data: {
      reviewerNotes,
      updatedAt: new Date(),
    },
    include: {
      players: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  await createAuditLog({
    action: "registration_notes_updated",
    entityType: "registration_submission",
    entityId: `${id}`,
    summary: `Updated reviewer notes for ${updated.teamName}.`,
    details: `${reviewerNotes || "Reviewer notes cleared."}${updated.discordCommunity ? ` Community: ${updated.discordCommunity}.` : ""}`,
    actorDiscordUserId,
  });

  return mapSubmission(updated);
}

export async function markRegistrationImported(
  id: number,
  teamId: number,
  actorDiscordUserId: string
): Promise<void> {
  await ensureRegistrationTables();

  const updated = await prisma.registrationSubmission.update({
    where: { id },
    data: {
      importedTeamId: teamId,
      updatedAt: new Date(),
    },
  });

  await createAuditLog({
    action: "registration_imported",
    entityType: "registration_submission",
    entityId: `${id}`,
    summary: `Imported ${updated.teamName} into live teams.`,
    details: `Team id ${teamId}.${updated.discordCommunity ? ` Community: ${updated.discordCommunity}.` : ""}`,
    actorDiscordUserId,
  });
}

export async function clearRegistrationImportedTeam(
  id: number,
  actorDiscordUserId: string
): Promise<void> {
  await ensureRegistrationTables();

  const existing = await prisma.registrationSubmission.findUnique({
    where: { id },
  });

  if (!existing || existing.importedTeamId === null) {
    return;
  }

  await prisma.registrationSubmission.update({
    where: { id },
    data: {
      importedTeamId: null,
      updatedAt: new Date(),
    },
  });

  await createAuditLog({
    action: "registration_import_link_cleared",
    entityType: "registration_submission",
    entityId: `${id}`,
    summary: `Cleared imported team link for ${existing.teamName}.`,
    actorDiscordUserId,
  });
}

import { prisma } from "./prisma";
import { createAuditLog } from "./auditLog";

export interface RegistrationSyncSourceStateRow {
  sourceKey: string;
  sourceLabel: string;
  spreadsheetId: string;
  worksheetTitle: string | null;
  lastResolvedRange: string | null;
  enabled: boolean;
  lastCheckedAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  lastImportedCount: number;
  lastDuplicateCount: number;
  lastInvalidCount: number;
  lastWarningCount: number;
  totalImportedCount: number;
  totalDuplicateCount: number;
  totalInvalidCount: number;
  totalWarningCount: number;
  lastSummaryJson: string | null;
  lastError: string | null;
  updatedAt: Date;
}

export interface RegistrationSyncIssueRow {
  id: number;
  sourceKey: string;
  sourceLabel: string;
  spreadsheetId: string;
  worksheetTitle: string | null;
  rowKey: string;
  rowNumber: number;
  rawTeamName: string | null;
  reason: string;
  severity: "warning" | "error";
  createdAt: Date;
  updatedAt: Date;
}

let registrationSyncTablesReady: Promise<void> | undefined;

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

async function ensureRegistrationSyncTables(): Promise<void> {
  registrationSyncTablesReady ??= Promise.resolve().then(async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RegistrationSyncSourceState" (
        "sourceKey" TEXT NOT NULL PRIMARY KEY,
        "sourceLabel" TEXT NOT NULL,
        "spreadsheetId" TEXT NOT NULL,
        "worksheetTitle" TEXT,
        "lastResolvedRange" TEXT,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "lastCheckedAt" DATETIME,
        "lastSuccessfulSyncAt" DATETIME,
        "lastImportedCount" INTEGER NOT NULL DEFAULT 0,
        "lastDuplicateCount" INTEGER NOT NULL DEFAULT 0,
        "lastInvalidCount" INTEGER NOT NULL DEFAULT 0,
        "lastWarningCount" INTEGER NOT NULL DEFAULT 0,
        "totalImportedCount" INTEGER NOT NULL DEFAULT 0,
        "totalDuplicateCount" INTEGER NOT NULL DEFAULT 0,
        "totalInvalidCount" INTEGER NOT NULL DEFAULT 0,
        "totalWarningCount" INTEGER NOT NULL DEFAULT 0,
        "lastSummaryJson" TEXT,
        "lastError" TEXT,
        "updatedAt" DATETIME NOT NULL
      )
    `);

    await ensureColumn(
      "RegistrationSyncSourceState",
      "worksheetTitle",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "worksheetTitle" TEXT`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "lastResolvedRange",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "lastResolvedRange" TEXT`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "enabled",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "lastCheckedAt",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "lastCheckedAt" DATETIME`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "lastSuccessfulSyncAt",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "lastSuccessfulSyncAt" DATETIME`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "lastImportedCount",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "lastImportedCount" INTEGER NOT NULL DEFAULT 0`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "lastDuplicateCount",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "lastDuplicateCount" INTEGER NOT NULL DEFAULT 0`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "lastInvalidCount",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "lastInvalidCount" INTEGER NOT NULL DEFAULT 0`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "lastWarningCount",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "lastWarningCount" INTEGER NOT NULL DEFAULT 0`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "totalImportedCount",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "totalImportedCount" INTEGER NOT NULL DEFAULT 0`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "totalDuplicateCount",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "totalDuplicateCount" INTEGER NOT NULL DEFAULT 0`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "totalInvalidCount",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "totalInvalidCount" INTEGER NOT NULL DEFAULT 0`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "totalWarningCount",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "totalWarningCount" INTEGER NOT NULL DEFAULT 0`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "lastSummaryJson",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "lastSummaryJson" TEXT`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "lastError",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "lastError" TEXT`
    );
    await ensureColumn(
      "RegistrationSyncSourceState",
      "updatedAt",
      `ALTER TABLE "RegistrationSyncSourceState" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`
    );

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RegistrationSyncIssue" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "sourceKey" TEXT NOT NULL,
        "sourceLabel" TEXT NOT NULL,
        "spreadsheetId" TEXT NOT NULL,
        "worksheetTitle" TEXT,
        "rowKey" TEXT NOT NULL,
        "rowNumber" INTEGER NOT NULL,
        "rawTeamName" TEXT,
        "reason" TEXT NOT NULL,
        "severity" TEXT NOT NULL DEFAULT 'error',
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL
      )
    `);

    await ensureColumn(
      "RegistrationSyncIssue",
      "worksheetTitle",
      `ALTER TABLE "RegistrationSyncIssue" ADD COLUMN "worksheetTitle" TEXT`
    );
    await ensureColumn(
      "RegistrationSyncIssue",
      "rawTeamName",
      `ALTER TABLE "RegistrationSyncIssue" ADD COLUMN "rawTeamName" TEXT`
    );
    await ensureColumn(
      "RegistrationSyncIssue",
      "severity",
      `ALTER TABLE "RegistrationSyncIssue" ADD COLUMN "severity" TEXT NOT NULL DEFAULT 'error'`
    );
    await ensureColumn(
      "RegistrationSyncIssue",
      "updatedAt",
      `ALTER TABLE "RegistrationSyncIssue" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`
    );

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "RegistrationSyncIssue_rowKey_key"
      ON "RegistrationSyncIssue" ("rowKey")
    `);
  });

  await registrationSyncTablesReady;
}

export async function upsertRegistrationSyncSourceState(input: {
  sourceKey: string;
  sourceLabel: string;
  spreadsheetId: string;
  worksheetTitle?: string | null;
  lastResolvedRange?: string | null;
  enabled: boolean;
  lastCheckedAt?: Date | null;
  lastSuccessfulSyncAt?: Date | null;
  lastImportedCount: number;
  lastDuplicateCount: number;
  lastInvalidCount: number;
  lastWarningCount?: number;
  lastSummaryJson?: string | null;
  lastError?: string | null;
}): Promise<void> {
  await ensureRegistrationSyncTables();

  const now = new Date();
  const existing = (await prisma.$queryRawUnsafe(
    `SELECT * FROM "RegistrationSyncSourceState" WHERE "sourceKey" = ? LIMIT 1`,
    input.sourceKey
  )) as RegistrationSyncSourceStateRow[];
  const current = existing[0];
  const lastCheckedAt = input.lastCheckedAt ?? now;
  const lastSuccessfulSyncAt =
    input.lastSuccessfulSyncAt ?? current?.lastSuccessfulSyncAt ?? null;
  const totalImportedCount =
    (current?.totalImportedCount ?? 0) + input.lastImportedCount;
  const totalDuplicateCount =
    (current?.totalDuplicateCount ?? 0) + input.lastDuplicateCount;
  const totalInvalidCount =
    (current?.totalInvalidCount ?? 0) + input.lastInvalidCount;
  const totalWarningCount =
    (current?.totalWarningCount ?? 0) + (input.lastWarningCount ?? 0);

  if (current) {
    await prisma.$executeRawUnsafe(
      `UPDATE "RegistrationSyncSourceState"
       SET "sourceLabel" = ?, "spreadsheetId" = ?, "worksheetTitle" = ?, "lastResolvedRange" = ?,
           "enabled" = ?, "lastCheckedAt" = ?, "lastSuccessfulSyncAt" = ?, "lastImportedCount" = ?,
           "lastDuplicateCount" = ?, "lastInvalidCount" = ?, "lastWarningCount" = ?, "totalImportedCount" = ?,
           "totalDuplicateCount" = ?, "totalInvalidCount" = ?, "totalWarningCount" = ?, "lastSummaryJson" = ?, "lastError" = ?, "updatedAt" = ?
       WHERE "sourceKey" = ?`,
      input.sourceLabel,
      input.spreadsheetId,
      input.worksheetTitle ?? null,
      input.lastResolvedRange ?? null,
      input.enabled,
      lastCheckedAt,
      lastSuccessfulSyncAt,
      input.lastImportedCount,
      input.lastDuplicateCount,
      input.lastInvalidCount,
      input.lastWarningCount ?? 0,
      totalImportedCount,
      totalDuplicateCount,
      totalInvalidCount,
      totalWarningCount,
      input.lastSummaryJson ?? null,
      input.lastError ?? null,
      now,
      input.sourceKey
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "RegistrationSyncSourceState" (
      "sourceKey", "sourceLabel", "spreadsheetId", "worksheetTitle", "lastResolvedRange",
      "enabled", "lastCheckedAt", "lastSuccessfulSyncAt", "lastImportedCount",
      "lastDuplicateCount", "lastInvalidCount", "lastWarningCount", "totalImportedCount", "totalDuplicateCount",
      "totalInvalidCount", "totalWarningCount", "lastSummaryJson", "lastError", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.sourceKey,
    input.sourceLabel,
    input.spreadsheetId,
    input.worksheetTitle ?? null,
    input.lastResolvedRange ?? null,
    input.enabled,
    lastCheckedAt,
    lastSuccessfulSyncAt,
    input.lastImportedCount,
    input.lastDuplicateCount,
    input.lastInvalidCount,
    input.lastWarningCount ?? 0,
    input.lastImportedCount,
    input.lastDuplicateCount,
    input.lastInvalidCount,
    input.lastWarningCount ?? 0,
    input.lastSummaryJson ?? null,
    input.lastError ?? null,
    now
  );
}

export async function recordRegistrationSyncIssue(input: {
  sourceKey: string;
  sourceLabel: string;
  spreadsheetId: string;
  worksheetTitle?: string | null;
  rowKey: string;
  rowNumber: number;
  rawTeamName?: string | null;
  reason: string;
  severity?: "warning" | "error";
}): Promise<void> {
  await ensureRegistrationSyncTables();

  const now = new Date();
  const existing = (await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "RegistrationSyncIssue" WHERE "rowKey" = ? LIMIT 1`,
    input.rowKey
  )) as Array<{ id: number }>;

  if (existing[0]) {
    await prisma.$executeRawUnsafe(
      `UPDATE "RegistrationSyncIssue"
       SET "sourceLabel" = ?, "spreadsheetId" = ?, "worksheetTitle" = ?, "rowNumber" = ?,
           "rawTeamName" = ?, "reason" = ?, "severity" = ?, "updatedAt" = ?
       WHERE "rowKey" = ?`,
      input.sourceLabel,
      input.spreadsheetId,
      input.worksheetTitle ?? null,
      input.rowNumber,
      input.rawTeamName ?? null,
      input.reason,
      input.severity ?? "error",
      now,
      input.rowKey
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "RegistrationSyncIssue" (
      "sourceKey", "sourceLabel", "spreadsheetId", "worksheetTitle", "rowKey",
      "rowNumber", "rawTeamName", "reason", "severity", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.sourceKey,
    input.sourceLabel,
    input.spreadsheetId,
    input.worksheetTitle ?? null,
    input.rowKey,
    input.rowNumber,
    input.rawTeamName ?? null,
    input.reason,
    input.severity ?? "error",
    now,
    now
  );
}

export async function clearRegistrationSyncIssue(rowKey: string): Promise<void> {
  await ensureRegistrationSyncTables();
  await prisma.$executeRawUnsafe(
    `DELETE FROM "RegistrationSyncIssue" WHERE "rowKey" = ?`,
    rowKey
  );
}

export async function listRegistrationSyncSourceStates(): Promise<
  RegistrationSyncSourceStateRow[]
> {
  await ensureRegistrationSyncTables();

  return (await prisma.$queryRawUnsafe(
    `SELECT * FROM "RegistrationSyncSourceState" ORDER BY "sourceLabel" ASC`
  )) as RegistrationSyncSourceStateRow[];
}

export async function listRecentRegistrationSyncIssues(
  limit = 10
): Promise<RegistrationSyncIssueRow[]> {
  await ensureRegistrationSyncTables();

  return (await prisma.$queryRawUnsafe(
    `SELECT * FROM "RegistrationSyncIssue" ORDER BY "updatedAt" DESC, "id" DESC LIMIT ?`,
    limit
  )) as RegistrationSyncIssueRow[];
}

export async function logRegistrationSyncPollStart(
  sourceLabel: string,
  actorDiscordUserId = "system"
): Promise<void> {
  await createAuditLog({
    action: "registration_sync_poll_started",
    entityType: "registration_sync",
    entityId: sourceLabel,
    summary: `Started sheet poll for ${sourceLabel}.`,
    actorDiscordUserId,
  });
}

export async function logRegistrationSyncPollComplete(input: {
  sourceLabel: string;
  imported: number;
  duplicates: number;
  invalid: number;
  details?: string;
  actorDiscordUserId?: string;
}): Promise<void> {
  await createAuditLog({
    action: "registration_sync_poll_completed",
    entityType: "registration_sync",
    entityId: input.sourceLabel,
    summary: `Completed sheet poll for ${input.sourceLabel}.`,
    details: [
      `Imported ${input.imported}, duplicates ${input.duplicates}, invalid ${input.invalid}.`,
      input.details ?? null,
      "Tournament instance assignments changed: 0.",
    ]
      .filter(Boolean)
      .join(" "),
    actorDiscordUserId: input.actorDiscordUserId ?? "system",
  });
}

export async function logRegistrationSyncFailure(input: {
  sourceLabel: string;
  errorMessage: string;
  actorDiscordUserId?: string;
}): Promise<void> {
  await createAuditLog({
    action: "registration_sync_poll_failed",
    entityType: "registration_sync",
    entityId: input.sourceLabel,
    summary: `Sheet poll failed for ${input.sourceLabel}.`,
    details: input.errorMessage,
    actorDiscordUserId: input.actorDiscordUserId ?? "system",
  });
}

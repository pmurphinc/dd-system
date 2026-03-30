import { prisma } from "./prisma";

export interface AuditLogInput {
  guildId?: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  details?: string;
  actorDiscordUserId: string;
}

let auditLogTableReady: Promise<void> | undefined;

async function ensureAuditLogTable(): Promise<void> {
  auditLogTableReady ??= Promise.resolve().then(async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AuditLog" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "guildId" TEXT,
        "action" TEXT NOT NULL,
        "entityType" TEXT NOT NULL,
        "entityId" TEXT NOT NULL,
        "summary" TEXT NOT NULL,
        "details" TEXT NOT NULL DEFAULT '',
        "actorDiscordUserId" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL
      )
    `);
  });

  await auditLogTableReady;
}

export async function createAuditLog(input: AuditLogInput): Promise<void> {
  await ensureAuditLogTable();

  await prisma.auditLog.create({
    data: {
      guildId: input.guildId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      details: input.details ?? "",
      actorDiscordUserId: input.actorDiscordUserId,
      createdAt: new Date(),
    },
  });

  console.log("[audit]", {
    ...input,
    details: input.details ?? "",
  });
}

import { prisma } from "./prisma";

export interface StoredGuildConfig {
  guildId: string;
  teamVoiceCategoryId: string | null;
  teamLeaderRoleId: string | null;
  playerRoleId: string | null;
  adminRoleId: string | null;
  founderRoleId: string | null;
  updatedAt: Date;
}

let guildConfigTableReady: Promise<void> | undefined;

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

async function ensureGuildConfigTable(): Promise<void> {
  guildConfigTableReady ??= Promise.resolve().then(async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "GuildConfig" (
        "guildId" TEXT NOT NULL PRIMARY KEY,
        "teamVoiceCategoryId" TEXT,
        "teamLeaderRoleId" TEXT,
        "playerRoleId" TEXT,
        "adminRoleId" TEXT,
        "founderRoleId" TEXT,
        "updatedAt" DATETIME NOT NULL
      )
    `);

    await ensureColumn(
      "GuildConfig",
      "teamVoiceCategoryId",
      `ALTER TABLE "GuildConfig" ADD COLUMN "teamVoiceCategoryId" TEXT`
    );
    await ensureColumn(
      "GuildConfig",
      "teamLeaderRoleId",
      `ALTER TABLE "GuildConfig" ADD COLUMN "teamLeaderRoleId" TEXT`
    );
    await ensureColumn(
      "GuildConfig",
      "playerRoleId",
      `ALTER TABLE "GuildConfig" ADD COLUMN "playerRoleId" TEXT`
    );
    await ensureColumn(
      "GuildConfig",
      "adminRoleId",
      `ALTER TABLE "GuildConfig" ADD COLUMN "adminRoleId" TEXT`
    );
    await ensureColumn(
      "GuildConfig",
      "founderRoleId",
      `ALTER TABLE "GuildConfig" ADD COLUMN "founderRoleId" TEXT`
    );
    await ensureColumn(
      "GuildConfig",
      "updatedAt",
      `ALTER TABLE "GuildConfig" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`
    );
  });

  await guildConfigTableReady;
}

function mapGuildConfig(record: {
  guildId: string;
  teamVoiceCategoryId: string | null;
  teamLeaderRoleId: string | null;
  playerRoleId: string | null;
  adminRoleId: string | null;
  founderRoleId: string | null;
  updatedAt: Date;
}): StoredGuildConfig {
  return {
    guildId: record.guildId,
    teamVoiceCategoryId: record.teamVoiceCategoryId,
    teamLeaderRoleId: record.teamLeaderRoleId,
    playerRoleId: record.playerRoleId,
    adminRoleId: record.adminRoleId,
    founderRoleId: record.founderRoleId,
    updatedAt: new Date(record.updatedAt),
  };
}

export async function getGuildConfig(
  guildId: string
): Promise<StoredGuildConfig | null> {
  await ensureGuildConfigTable();

  const record = await prisma.guildConfig.findUnique({
    where: { guildId },
  });

  return record ? mapGuildConfig(record) : null;
}

export async function upsertGuildConfig(input: {
  guildId: string;
  teamVoiceCategoryId?: string | null;
  teamLeaderRoleId?: string | null;
  playerRoleId?: string | null;
  adminRoleId?: string | null;
  founderRoleId?: string | null;
}): Promise<StoredGuildConfig> {
  await ensureGuildConfigTable();

  const record = await prisma.guildConfig.upsert({
    where: { guildId: input.guildId },
    update: {
      teamVoiceCategoryId: input.teamVoiceCategoryId,
      teamLeaderRoleId: input.teamLeaderRoleId,
      playerRoleId: input.playerRoleId,
      adminRoleId: input.adminRoleId,
      founderRoleId: input.founderRoleId,
      updatedAt: new Date(),
    },
    create: {
      guildId: input.guildId,
      teamVoiceCategoryId: input.teamVoiceCategoryId ?? null,
      teamLeaderRoleId: input.teamLeaderRoleId ?? null,
      playerRoleId: input.playerRoleId ?? null,
      adminRoleId: input.adminRoleId ?? null,
      founderRoleId: input.founderRoleId ?? null,
      updatedAt: new Date(),
    },
  });

  return mapGuildConfig(record);
}

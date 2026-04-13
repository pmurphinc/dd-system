import { TournamentStage } from "@prisma/client";
import { createAuditLog } from "./auditLog";
import { getCurrentFinalRoundAssignmentForTeam } from "./matchAssignments";
import { prisma } from "./prisma";
import { getTeamById } from "./teams";
import { getTournamentInstanceById } from "./tournamentInstances";
import { pickScrimMap } from "./tournamentMaps";

export type ScrimQueueStatus = "LOOKING" | "MATCHED" | "CANCELLED" | "EXPIRED";
export type ScrimMatchStatus =
  | "MATCHED"
  | "IN_LOBBY_SETUP"
  | "READY"
  | "ACTIVE"
  | "COMPLETED"
  | "CANCELLED";

interface QueueInput {
  guildId: string;
  teamId: number;
  requestedByDiscordUserId: string;
  durationMinutes: number;
}

let scrimTablesReady: Promise<void> | undefined;

async function ensureScrimTables() {
  scrimTablesReady ??= Promise.resolve().then(async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ScrimQueueEntry" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "guildId" TEXT NOT NULL,
        "teamId" INTEGER NOT NULL,
        "requestedByDiscordUserId" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "expiresAt" DATETIME NOT NULL,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL,
        "matchedAt" DATETIME,
        "cancelledAt" DATETIME,
        "expiredAt" DATETIME
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ScrimMatch" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "guildId" TEXT NOT NULL,
        "map" TEXT,
        "teamAId" INTEGER NOT NULL,
        "teamBId" INTEGER NOT NULL,
        "status" TEXT NOT NULL,
        "teamAReadyAt" DATETIME,
        "teamBReadyAt" DATETIME,
        "lobbyCode" TEXT,
        "lobbyCodeSetByDiscordUserId" TEXT,
        "lobbyCodeSetAt" DATETIME,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL,
        "startedAt" DATETIME,
        "completedAt" DATETIME,
        "cancelledAt" DATETIME
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ScrimTeamState" (
        "teamId" INTEGER NOT NULL PRIMARY KEY,
        "guildId" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "activeQueueEntryId" INTEGER,
        "activeMatchId" INTEGER,
        "opponentTeamId" INTEGER,
        "lastUpdatedAt" DATETIME NOT NULL,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL
      )
    `);

    await prisma.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "ScrimQueueEntry_guild_status_created_idx" ON "ScrimQueueEntry" ("guildId", "status", "createdAt")'
    );
  });

  await scrimTablesReady;
}

function now() {
  return new Date();
}

export async function expireScrimQueueEntries(guildId: string): Promise<number> {
  await ensureScrimTables();
  const ts = now();
  return prisma.$transaction(async (tx) => {
    const expired = (await tx.$queryRawUnsafe(
      `SELECT id, teamId FROM "ScrimQueueEntry" WHERE "guildId" = ? AND "status" = 'LOOKING' AND "expiresAt" <= ?`,
      guildId,
      ts.toISOString()
    )) as Array<{ id: number; teamId: number }>;

    for (const entry of expired) {
      await tx.$executeRawUnsafe(
        `UPDATE "ScrimQueueEntry" SET "status" = 'EXPIRED', "expiredAt" = ?, "updatedAt" = ? WHERE "id" = ? AND "status" = 'LOOKING'`,
        ts.toISOString(),
        ts.toISOString(),
        entry.id
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO "ScrimTeamState" ("teamId","guildId","status","lastUpdatedAt","createdAt","updatedAt")
         VALUES (?,?, 'IDLE', ?, ?, ?)
         ON CONFLICT("teamId") DO UPDATE SET
         "status" = 'IDLE',
         "activeQueueEntryId" = NULL,
         "activeMatchId" = NULL,
         "opponentTeamId" = NULL,
         "lastUpdatedAt" = excluded."lastUpdatedAt",
         "updatedAt" = excluded."updatedAt"`,
        entry.teamId,
        guildId,
        ts.toISOString(),
        ts.toISOString(),
        ts.toISOString()
      );
    }

    return expired.length;
  });
}

export async function getScrimStateForTeam(guildId: string, teamId: number) {
  await ensureScrimTables();
  await expireScrimQueueEntries(guildId);

  const [teamState] = (await prisma.$queryRawUnsafe(
    `SELECT * FROM "ScrimTeamState" WHERE "guildId" = ? AND "teamId" = ?`,
    guildId,
    teamId
  )) as Array<any>;

  const [activeQueue] = teamState?.activeQueueEntryId
    ? ((await prisma.$queryRawUnsafe(
        `SELECT * FROM "ScrimQueueEntry" WHERE "id" = ?`,
        teamState.activeQueueEntryId
      )) as Array<any>)
    : [null];

  const [activeMatch] = teamState?.activeMatchId
    ? ((await prisma.$queryRawUnsafe(
        `SELECT * FROM "ScrimMatch" WHERE "id" = ?`,
        teamState.activeMatchId
      )) as Array<any>)
    : [null];

  return {
    teamState: teamState ?? null,
    activeQueue: activeQueue ?? null,
    activeMatch: activeMatch ?? null,
  };
}

async function assertScrimEligible(guildId: string, teamId: number) {
  const snapshot = await getScrimStateForTeam(guildId, teamId);
  if (snapshot.activeQueue && snapshot.activeQueue.status === "LOOKING") {
    throw new Error("Your team is already looking for a scrim.");
  }
  if (
    snapshot.activeMatch &&
    ["MATCHED", "IN_LOBBY_SETUP", "READY", "ACTIVE"].includes(snapshot.activeMatch.status)
  ) {
    throw new Error("Your team is already in an active scrim match.");
  }

  const team = await getTeamById(teamId);
  if (team?.tournamentInstanceId) {
    const instance = await getTournamentInstanceById(team.tournamentInstanceId);
    if (instance?.currentStage === TournamentStage.FINAL_ROUND) {
      const assignment = await getCurrentFinalRoundAssignmentForTeam(
        team.tournamentInstanceId,
        teamId,
        instance.currentCycle ?? 1
      );
      if (assignment) {
        throw new Error("Your team is currently assigned to a tournament match and cannot queue for scrims.");
      }
    }
  }
}

async function resolveOldestLookingEntry(tx: any, guildId: string, excludedTeamId: number) {
  const entries = (await tx.$queryRawUnsafe(
    `SELECT * FROM "ScrimQueueEntry"
     WHERE "guildId" = ? AND "status" = 'LOOKING' AND "teamId" != ?
     ORDER BY "createdAt" ASC LIMIT 1`,
    guildId,
    excludedTeamId
  )) as Array<any>;
  return entries[0] ?? null;
}

async function getTeamMapBan(teamId: number): Promise<string | null> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT "mapBan" FROM "Team" WHERE "id" = ?`,
    teamId
  )) as Array<{ mapBan: string | null }>;
  return rows[0]?.mapBan ?? null;
}

export async function queueForScrim(input: QueueInput) {
  await ensureScrimTables();
  await assertScrimEligible(input.guildId, input.teamId);

  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + input.durationMinutes * 60_000);

  return prisma.$transaction(async (tx) => {
    const duplicate = (await tx.$queryRawUnsafe(
      `SELECT id FROM "ScrimQueueEntry" WHERE "guildId" = ? AND "teamId" = ? AND "status" = 'LOOKING' LIMIT 1`,
      input.guildId,
      input.teamId
    )) as Array<{ id: number }>;

    if (duplicate.length > 0) {
      throw new Error("Your team is already looking for a scrim.");
    }

    await tx.$executeRawUnsafe(
      `INSERT INTO "ScrimQueueEntry" ("guildId","teamId","requestedByDiscordUserId","status","expiresAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`,
      input.guildId,
      input.teamId,
      input.requestedByDiscordUserId,
      "LOOKING",
      expiresAt.toISOString(),
      createdAt.toISOString(),
      createdAt.toISOString()
    );

    const queueRows = (await tx.$queryRawUnsafe(
      `SELECT * FROM "ScrimQueueEntry" WHERE "guildId" = ? AND "teamId" = ? AND "status" = 'LOOKING' ORDER BY "id" DESC LIMIT 1`,
      input.guildId,
      input.teamId
    )) as Array<any>;
    const queueEntry = queueRows[0]!;

    await tx.$executeRawUnsafe(
      `INSERT INTO "ScrimTeamState" ("teamId","guildId","status","activeQueueEntryId","lastUpdatedAt","createdAt","updatedAt")
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT("teamId") DO UPDATE SET
      "guildId" = excluded."guildId",
      "status" = excluded."status",
      "activeQueueEntryId" = excluded."activeQueueEntryId",
      "activeMatchId" = NULL,
      "opponentTeamId" = NULL,
      "lastUpdatedAt" = excluded."lastUpdatedAt",
      "updatedAt" = excluded."updatedAt"`,
      input.teamId,
      input.guildId,
      "LOOKING",
      queueEntry.id,
      createdAt.toISOString(),
      createdAt.toISOString(),
      createdAt.toISOString()
    );

    const opponentQueue = await resolveOldestLookingEntry(tx, input.guildId, input.teamId);
    if (!opponentQueue) {
      return { queueEntry, matched: null };
    }

    const [teamABan, teamBBan] = await Promise.all([
      getTeamMapBan(opponentQueue.teamId),
      getTeamMapBan(input.teamId),
    ]);
    const assignedMap = pickScrimMap([teamABan, teamBBan]);

    await tx.$executeRawUnsafe(
      `INSERT INTO "ScrimMatch" ("guildId","map","teamAId","teamBId","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`,
      input.guildId,
      assignedMap,
      opponentQueue.teamId,
      input.teamId,
      "MATCHED",
      createdAt.toISOString(),
      createdAt.toISOString()
    );
    const matches = (await tx.$queryRawUnsafe(
      `SELECT * FROM "ScrimMatch" WHERE "guildId" = ? ORDER BY "id" DESC LIMIT 1`,
      input.guildId
    )) as Array<any>;
    const match = matches[0]!;

    for (const q of [queueEntry.id, opponentQueue.id]) {
      await tx.$executeRawUnsafe(
        `UPDATE "ScrimQueueEntry" SET "status" = 'MATCHED', "matchedAt" = ?, "updatedAt" = ? WHERE "id" = ?`,
        createdAt.toISOString(),
        createdAt.toISOString(),
        q
      );
    }

    await tx.$executeRawUnsafe(
      `INSERT INTO "ScrimTeamState" ("teamId","guildId","status","activeMatchId","opponentTeamId","lastUpdatedAt","createdAt","updatedAt")
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT("teamId") DO UPDATE SET
      "status" = excluded."status",
      "activeQueueEntryId" = NULL,
      "activeMatchId" = excluded."activeMatchId",
      "opponentTeamId" = excluded."opponentTeamId",
      "lastUpdatedAt" = excluded."lastUpdatedAt",
      "updatedAt" = excluded."updatedAt"`,
      match.teamAId,
      input.guildId,
      "MATCHED",
      match.id,
      match.teamBId,
      createdAt.toISOString(),
      createdAt.toISOString(),
      createdAt.toISOString()
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "ScrimTeamState" ("teamId","guildId","status","activeMatchId","opponentTeamId","lastUpdatedAt","createdAt","updatedAt")
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT("teamId") DO UPDATE SET
      "status" = excluded."status",
      "activeQueueEntryId" = NULL,
      "activeMatchId" = excluded."activeMatchId",
      "opponentTeamId" = excluded."opponentTeamId",
      "lastUpdatedAt" = excluded."lastUpdatedAt",
      "updatedAt" = excluded."updatedAt"`,
      match.teamBId,
      input.guildId,
      "MATCHED",
      match.id,
      match.teamAId,
      createdAt.toISOString(),
      createdAt.toISOString(),
      createdAt.toISOString()
    );

    return { queueEntry, matched: match };
  });
}

export async function cancelScrimSearch(guildId: string, teamId: number, actorDiscordUserId: string) {
  await ensureScrimTables();
  const ts = now();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE "ScrimQueueEntry" SET "status" = 'CANCELLED', "cancelledAt" = ?, "updatedAt" = ? WHERE "guildId" = ? AND "teamId" = ? AND "status" = 'LOOKING'`,
      ts.toISOString(),
      ts.toISOString(),
      guildId,
      teamId
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "ScrimTeamState" ("teamId","guildId","status","lastUpdatedAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?)
       ON CONFLICT("teamId") DO UPDATE SET "status"='IDLE',"activeQueueEntryId"=NULL,"lastUpdatedAt"=excluded."lastUpdatedAt","updatedAt"=excluded."updatedAt"`,
      teamId,
      guildId,
      "IDLE",
      ts.toISOString(),
      ts.toISOString(),
      ts.toISOString()
    );
  });

  await createAuditLog({
    guildId,
    action: "SCRIM_QUEUE_CANCELLED",
    entityType: "ScrimQueueEntry",
    entityId: `${teamId}`,
    summary: "Team cancelled scrim queue search.",
    actorDiscordUserId,
  });
}

export async function setScrimLobbyCode(guildId: string, teamId: number, lobbyCode: string, actorDiscordUserId: string) {
  const snapshot = await getScrimStateForTeam(guildId, teamId);
  if (!snapshot.activeMatch) {
    throw new Error("No active scrim match found for your team.");
  }

  const ts = now();
  await prisma.$executeRawUnsafe(
    `UPDATE "ScrimMatch" SET "lobbyCode"=?,"lobbyCodeSetByDiscordUserId"=?,"lobbyCodeSetAt"=?,"status"=CASE WHEN "status"='MATCHED' THEN 'IN_LOBBY_SETUP' ELSE "status" END,"updatedAt"=? WHERE "id"=?`,
    lobbyCode,
    actorDiscordUserId,
    ts.toISOString(),
    ts.toISOString(),
    snapshot.activeMatch.id
  );
}

export async function markScrimReady(guildId: string, teamId: number) {
  const snapshot = await getScrimStateForTeam(guildId, teamId);
  if (!snapshot.activeMatch) {
    throw new Error("No active scrim match found for your team.");
  }

  const match = snapshot.activeMatch;
  const ts = now().toISOString();
  const isTeamA = match.teamAId === teamId;

  await prisma.$executeRawUnsafe(
    `UPDATE "ScrimMatch" SET ${isTeamA ? '"teamAReadyAt"' : '"teamBReadyAt"'} = COALESCE(${isTeamA ? '"teamAReadyAt"' : '"teamBReadyAt"'}, ?), "updatedAt"=? WHERE "id"=?`,
    ts,
    ts,
    match.id
  );

  const [updated] = (await prisma.$queryRawUnsafe(
    `SELECT * FROM "ScrimMatch" WHERE "id" = ?`,
    match.id
  )) as Array<any>;

  const nextStatus =
    updated.teamAReadyAt && updated.teamBReadyAt
      ? "ACTIVE"
      : updated.lobbyCode
        ? "READY"
        : "IN_LOBBY_SETUP";

  await prisma.$executeRawUnsafe(
    `UPDATE "ScrimMatch" SET "status" = ?, "startedAt" = CASE WHEN ? = 'ACTIVE' AND "startedAt" IS NULL THEN ? ELSE "startedAt" END, "updatedAt" = ? WHERE "id" = ?`,
    nextStatus,
    nextStatus,
    ts,
    ts,
    match.id
  );

  await prisma.$executeRawUnsafe(
    `UPDATE "ScrimTeamState" SET "status"=?,"lastUpdatedAt"=?,"updatedAt"=? WHERE "teamId" IN (?,?)`,
    nextStatus,
    ts,
    ts,
    updated.teamAId,
    updated.teamBId
  );
}

export async function leaveOrCompleteScrim(guildId: string, teamId: number, complete: boolean) {
  const snapshot = await getScrimStateForTeam(guildId, teamId);
  if (!snapshot.activeMatch) {
    return;
  }

  const ts = now().toISOString();
  const status = complete ? "COMPLETED" : "CANCELLED";

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE "ScrimMatch" SET "status" = ?, "completedAt" = CASE WHEN ? = 'COMPLETED' THEN ? ELSE "completedAt" END, "cancelledAt" = CASE WHEN ? = 'CANCELLED' THEN ? ELSE "cancelledAt" END, "updatedAt" = ? WHERE "id" = ?`,
      status,
      status,
      ts,
      status,
      ts,
      ts,
      snapshot.activeMatch!.id
    );

    await tx.$executeRawUnsafe(
      `UPDATE "ScrimTeamState" SET "status"='IDLE',"activeQueueEntryId"=NULL,"activeMatchId"=NULL,"opponentTeamId"=NULL,"lastUpdatedAt"=?,"updatedAt"=? WHERE "guildId"=? AND "teamId" IN (?,?)`,
      ts,
      ts,
      guildId,
      snapshot.activeMatch!.teamAId,
      snapshot.activeMatch!.teamBId
    );
  });
}

export async function adminListOpenScrimQueue(guildId: string) {
  await ensureScrimTables();
  return (await prisma.$queryRawUnsafe(
    `SELECT * FROM "ScrimQueueEntry" WHERE "guildId" = ? AND "status" = 'LOOKING' ORDER BY "createdAt" ASC`,
    guildId
  )) as Array<any>;
}

export async function adminListActiveScrimMatches(guildId: string) {
  await ensureScrimTables();
  return (await prisma.$queryRawUnsafe(
    `SELECT * FROM "ScrimMatch" WHERE "guildId" = ? AND "status" IN ('MATCHED','IN_LOBBY_SETUP','READY','ACTIVE') ORDER BY "createdAt" ASC`,
    guildId
  )) as Array<any>;
}

export async function adminReassignScrimMap(matchId: number) {
  const [match] = (await prisma.$queryRawUnsafe(
    `SELECT * FROM "ScrimMatch" WHERE "id"=?`,
    matchId
  )) as Array<any>;
  if (!match) throw new Error("Scrim match not found.");

  const [banA, banB] = await Promise.all([getTeamMapBan(match.teamAId), getTeamMapBan(match.teamBId)]);
  const map = pickScrimMap([banA, banB]);
  await prisma.$executeRawUnsafe(
    `UPDATE "ScrimMatch" SET "map"=?,"updatedAt"=? WHERE "id"=?`,
    map,
    now().toISOString(),
    matchId
  );
}

export async function adminClearScrimLobbyCode(matchId: number) {
  await prisma.$executeRawUnsafe(
    `UPDATE "ScrimMatch" SET "lobbyCode"=NULL,"lobbyCodeSetByDiscordUserId"=NULL,"lobbyCodeSetAt"=NULL,"updatedAt"=? WHERE "id"=?`,
    now().toISOString(),
    matchId
  );
}

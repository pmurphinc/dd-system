-- Scrim system persistence
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
);

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
);

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
);

CREATE INDEX IF NOT EXISTS "ScrimQueueEntry_guild_status_created_idx"
ON "ScrimQueueEntry" ("guildId", "status", "createdAt");

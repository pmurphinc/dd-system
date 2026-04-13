-- CreateTable
CREATE TABLE "ActivePanelMessage" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "guildId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "panelType" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "ownerDiscordUserId" TEXT,
  "actorDiscordUserId" TEXT,
  "tournamentInstanceId" INTEGER,
  "teamId" INTEGER,
  "matchAssignmentId" INTEGER,
  "invalidatedAt" DATETIME,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SavedPanelContext" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "guildId" TEXT NOT NULL,
  "discordUserId" TEXT NOT NULL,
  "panelType" TEXT NOT NULL,
  "tournamentInstanceId" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ActivePanelMessage_scopeKey_key" ON "ActivePanelMessage"("scopeKey");
CREATE INDEX "ActivePanelMessage_guildId_panelType_idx" ON "ActivePanelMessage"("guildId", "panelType");
CREATE INDEX "ActivePanelMessage_ownerDiscordUserId_panelType_idx" ON "ActivePanelMessage"("ownerDiscordUserId", "panelType");
CREATE INDEX "ActivePanelMessage_tournamentInstanceId_panelType_idx" ON "ActivePanelMessage"("tournamentInstanceId", "panelType");
CREATE INDEX "ActivePanelMessage_teamId_panelType_idx" ON "ActivePanelMessage"("teamId", "panelType");

-- CreateIndex
CREATE UNIQUE INDEX "SavedPanelContext_guildId_discordUserId_panelType_key" ON "SavedPanelContext"("guildId", "discordUserId", "panelType");

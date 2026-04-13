-- CreateTable
CREATE TABLE "TournamentState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tournamentStatus" TEXT NOT NULL,
    "currentCycle" INTEGER,
    "currentStage" TEXT NOT NULL,
    "checkedInTeams" INTEGER NOT NULL,
    "totalTeams" INTEGER NOT NULL,
    "activeMatch" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "RegistrationSubmission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teamName" TEXT NOT NULL,
    "leaderDiscordUserId" TEXT NOT NULL,
    "leaderDisplayName" TEXT NOT NULL,
    "discordCommunity" TEXT,
    "sourceLabel" TEXT,
    "sourceSpreadsheetId" TEXT,
    "sourceWorksheetTitle" TEXT,
    "sourceRowKey" TEXT,
    "sourceRowNumber" INTEGER,
    "originalSubmittedAt" DATETIME,
    "mapBan" TEXT,
    "syncImportedAt" DATETIME,
    "reviewStatus" TEXT NOT NULL,
    "reviewerNotes" TEXT NOT NULL,
    "submittedNotes" TEXT NOT NULL,
    "importedTeamId" INTEGER,
    "createdByDiscordUserId" TEXT NOT NULL,
    "createdByDisplayName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RegistrationPlayer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "submissionId" INTEGER NOT NULL,
    "displayName" TEXT NOT NULL,
    "discordUserId" TEXT,
    "embarkId" TEXT NOT NULL,
    "screenshotLink" TEXT NOT NULL,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "RegistrationPlayer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "RegistrationSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pendingTeamsCount" INTEGER NOT NULL,
    "approvedTeamsCount" INTEGER NOT NULL,
    "deniedTeamsCount" INTEGER NOT NULL,
    "currentPendingTeam" TEXT,
    "approvedTeams" TEXT NOT NULL,
    "deniedTeams" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Team" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teamName" TEXT NOT NULL,
    "captainName" TEXT NOT NULL,
    "playerNames" TEXT NOT NULL,
    "substituteName" TEXT NOT NULL,
    "discordCommunity" TEXT,
    "approvalStatus" TEXT NOT NULL,
    "checkInStatus" TEXT NOT NULL,
    "leaderDiscordUserId" TEXT NOT NULL DEFAULT '',
    "discordRoleId" TEXT,
    "voiceChannelId" TEXT,
    "importedFromSubmissionId" INTEGER,
    "isPlacedInEvent" BOOLEAN NOT NULL DEFAULT false,
    "tournamentInstanceId" INTEGER,
    "mapBan" TEXT,
    CONSTRAINT "Team_tournamentInstanceId_fkey" FOREIGN KEY ("tournamentInstanceId") REFERENCES "TournamentInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "teamId" INTEGER NOT NULL,
    "displayName" TEXT NOT NULL,
    "discordUserId" TEXT,
    "embarkId" TEXT,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MatchAssignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tournamentInstanceId" INTEGER,
    "teamId" INTEGER,
    "opponentTeamId" INTEGER,
    "teamName" TEXT NOT NULL,
    "opponentTeamName" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "stageName" TEXT NOT NULL,
    "bracketLabel" TEXT,
    "assignedMap" TEXT,
    CONSTRAINT "MatchAssignment_tournamentInstanceId_fkey" FOREIGN KEY ("tournamentInstanceId") REFERENCES "TournamentInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReportSubmission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tournamentInstanceId" INTEGER,
    "teamId" INTEGER,
    "score" TEXT NOT NULL,
    "matchAssignmentId" INTEGER NOT NULL,
    "submittedByDiscordUserId" TEXT NOT NULL,
    "submittedByDisplayName" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "opponentTeamName" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "stageName" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "submittedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportSubmission_tournamentInstanceId_fkey" FOREIGN KEY ("tournamentInstanceId") REFERENCES "TournamentInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Standing" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tournamentInstanceId" INTEGER,
    "teamId" INTEGER,
    "teamName" TEXT NOT NULL,
    "frp" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Standing_tournamentInstanceId_fkey" FOREIGN KEY ("tournamentInstanceId") REFERENCES "TournamentInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Standing_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CycleResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cycleNumber" INTEGER NOT NULL,
    "matchAssignmentId" INTEGER NOT NULL,
    "reportSubmissionId" INTEGER NOT NULL,
    "teamName" TEXT NOT NULL,
    "opponentTeamName" TEXT NOT NULL,
    "score" TEXT NOT NULL,
    "frpAwardedToTeam" INTEGER NOT NULL,
    "frpAwardedToOpponent" INTEGER NOT NULL,
    "recordedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GuildConfig" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "teamVoiceCategoryId" TEXT,
    "teamLeaderRoleId" TEXT,
    "playerRoleId" TEXT,
    "adminRoleId" TEXT,
    "founderRoleId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "actorDiscordUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RegistrationSyncSourceState" (
    "sourceKey" TEXT NOT NULL PRIMARY KEY,
    "sourceLabel" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "worksheetTitle" TEXT,
    "lastResolvedRange" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "lastCheckedAt" DATETIME,
    "lastSuccessfulSyncAt" DATETIME,
    "lastImportedCount" INTEGER NOT NULL,
    "lastDuplicateCount" INTEGER NOT NULL,
    "lastInvalidCount" INTEGER NOT NULL,
    "totalImportedCount" INTEGER NOT NULL,
    "totalDuplicateCount" INTEGER NOT NULL,
    "totalInvalidCount" INTEGER NOT NULL,
    "lastSummaryJson" TEXT,
    "lastError" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RegistrationSyncIssue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sourceKey" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "worksheetTitle" TEXT,
    "rowKey" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawTeamName" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TournamentInstance" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orgKey" TEXT NOT NULL,
    "orgName" TEXT,
    "displayName" TEXT,
    "internalKey" TEXT,
    "podNumber" INTEGER,
    "status" TEXT NOT NULL,
    "currentCycle" INTEGER,
    "currentStage" TEXT NOT NULL,
    "maxTeams" INTEGER NOT NULL DEFAULT 4,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "winningTeamId" INTEGER,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CashoutPlacement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tournamentInstanceId" INTEGER NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "firstPlaceTeamId" INTEGER NOT NULL,
    "secondPlaceTeamId" INTEGER NOT NULL,
    "thirdPlaceTeamId" INTEGER NOT NULL,
    "fourthPlaceTeamId" INTEGER NOT NULL,
    "assignedMap" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CashoutPlacement_tournamentInstanceId_fkey" FOREIGN KEY ("tournamentInstanceId") REFERENCES "TournamentInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CashoutFrpBonus" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tournamentInstanceId" INTEGER NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "teamName" TEXT NOT NULL,
    "frpAwarded" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL DEFAULT 'CASHOUT_FIRST_PLACE',
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CashoutFrpBonus_tournamentInstanceId_fkey" FOREIGN KEY ("tournamentInstanceId") REFERENCES "TournamentInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OfficialMatchResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tournamentInstanceId" INTEGER NOT NULL,
    "matchAssignmentId" INTEGER NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "opponentTeamId" INTEGER NOT NULL,
    "round1WinnerTeamId" INTEGER NOT NULL,
    "round2WinnerTeamId" INTEGER NOT NULL,
    "round3Played" BOOLEAN NOT NULL,
    "round3WinnerTeamId" INTEGER,
    "teamScore" INTEGER NOT NULL,
    "opponentScore" INTEGER NOT NULL,
    "winnerTeamId" INTEGER NOT NULL,
    "loserTeamId" INTEGER NOT NULL,
    "score" TEXT NOT NULL,
    "frpAwardedToTeam" INTEGER NOT NULL,
    "frpAwardedToOpponent" INTEGER NOT NULL,
    "enteredByDiscordUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OfficialMatchResult_tournamentInstanceId_fkey" FOREIGN KEY ("tournamentInstanceId") REFERENCES "TournamentInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OfficialMatchResult_matchAssignmentId_fkey" FOREIGN KEY ("matchAssignmentId") REFERENCES "MatchAssignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationSubmission_sourceRowKey_key" ON "RegistrationSubmission"("sourceRowKey");

-- CreateIndex
CREATE UNIQUE INDEX "Team_importedFromSubmissionId_key" ON "Team"("importedFromSubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Standing_tournamentInstanceId_teamId_key" ON "Standing"("tournamentInstanceId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "CycleResult_matchAssignmentId_key" ON "CycleResult"("matchAssignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "CycleResult_reportSubmissionId_key" ON "CycleResult"("reportSubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationSyncIssue_rowKey_key" ON "RegistrationSyncIssue"("rowKey");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentInstance_guildId_name_key" ON "TournamentInstance"("guildId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentInstance_guildId_internalKey_key" ON "TournamentInstance"("guildId", "internalKey");

-- CreateIndex
CREATE UNIQUE INDEX "CashoutPlacement_tournamentInstanceId_cycleNumber_key" ON "CashoutPlacement"("tournamentInstanceId", "cycleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CashoutFrpBonus_tournamentInstanceId_cycleNumber_key" ON "CashoutFrpBonus"("tournamentInstanceId", "cycleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OfficialMatchResult_matchAssignmentId_key" ON "OfficialMatchResult"("matchAssignmentId");


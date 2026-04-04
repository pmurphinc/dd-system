import { prisma } from "../storage/prisma";

const SOURCE_ROW_KEY = "manual:player:ospuze-gooner";
const DISPLAY_NAME = "OSPUZE.GOONER";
const EMBARK_ID = "OSPUZE.GOONER";
const PROFILE_SCREENSHOT_PATH = "provided-by-user-apr-4-2026";

async function ensurePlayerArchiveTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PlayerArchive" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "displayName" TEXT NOT NULL,
      "embarkId" TEXT NOT NULL UNIQUE,
      "careerLevel" INTEGER,
      "hoursPlayed" INTEGER,
      "matches" INTEGER,
      "wins" INTEGER,
      "losses" INTEGER,
      "eliminations" INTEGER,
      "deaths" INTEGER,
      "revives" INTEGER,
      "totalCashedOut" INTEGER,
      "damage" INTEGER,
      "profileScreenshotPath" TEXT,
      "capturedAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function ensureRegistrationTables() {
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
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "RegistrationSubmission_sourceRowKey_key"
    ON "RegistrationSubmission" ("sourceRowKey")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RegistrationPlayer" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "submissionId" INTEGER NOT NULL,
      "displayName" TEXT NOT NULL,
      "discordUserId" TEXT,
      "embarkId" TEXT NOT NULL DEFAULT '',
      "screenshotLink" TEXT NOT NULL DEFAULT '',
      "isLeader" BOOLEAN NOT NULL DEFAULT false,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY ("submissionId") REFERENCES "RegistrationSubmission" ("id") ON DELETE CASCADE
    )
  `);
}

async function upsertRegistrationPlayer() {
  const existingSubmission = await prisma.registrationSubmission.findUnique({
    where: {
      sourceRowKey: SOURCE_ROW_KEY,
    },
    include: {
      players: true,
    },
  });

  if (existingSubmission) {
    const alreadyPresent = existingSubmission.players.some(
      (player: { embarkId: string }) => player.embarkId === EMBARK_ID
    );

    if (!alreadyPresent) {
      await prisma.registrationPlayer.create({
        data: {
          submissionId: existingSubmission.id,
          displayName: DISPLAY_NAME,
          discordUserId: null,
          embarkId: EMBARK_ID,
          screenshotLink: PROFILE_SCREENSHOT_PATH,
          isLeader: true,
          sortOrder: 0,
        },
      });
    }

    return;
  }

  await prisma.registrationSubmission.create({
    data: {
      teamName: `Player Archive - ${DISPLAY_NAME}`,
      leaderDiscordUserId: "",
      leaderDisplayName: DISPLAY_NAME,
      discordCommunity: null,
      sourceLabel: "manual-player-entry",
      sourceSpreadsheetId: null,
      sourceWorksheetTitle: null,
      sourceRowKey: SOURCE_ROW_KEY,
      sourceRowNumber: null,
      originalSubmittedAt: null,
      mapBan: null,
      syncImportedAt: null,
      reviewStatus: "approved",
      reviewerNotes: "Manually added from career screenshot.",
      submittedNotes: "Single-player historical profile record.",
      importedTeamId: null,
      createdByDiscordUserId: "system",
      createdByDisplayName: "system",
      createdAt: new Date(),
      updatedAt: new Date(),
      players: {
        create: [
          {
            displayName: DISPLAY_NAME,
            discordUserId: null,
            embarkId: EMBARK_ID,
            screenshotLink: PROFILE_SCREENSHOT_PATH,
            isLeader: true,
            sortOrder: 0,
          },
        ],
      },
    },
  });
}

async function upsertPlayerArchive() {
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "PlayerArchive" (
        "displayName",
        "embarkId",
        "careerLevel",
        "hoursPlayed",
        "matches",
        "wins",
        "losses",
        "eliminations",
        "deaths",
        "revives",
        "totalCashedOut",
        "damage",
        "profileScreenshotPath",
        "capturedAt",
        "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT("embarkId") DO UPDATE SET
        "displayName" = excluded."displayName",
        "careerLevel" = excluded."careerLevel",
        "hoursPlayed" = excluded."hoursPlayed",
        "matches" = excluded."matches",
        "wins" = excluded."wins",
        "losses" = excluded."losses",
        "eliminations" = excluded."eliminations",
        "deaths" = excluded."deaths",
        "revives" = excluded."revives",
        "totalCashedOut" = excluded."totalCashedOut",
        "damage" = excluded."damage",
        "profileScreenshotPath" = excluded."profileScreenshotPath",
        "capturedAt" = excluded."capturedAt",
        "updatedAt" = CURRENT_TIMESTAMP
    `,
    DISPLAY_NAME,
    EMBARK_ID,
    143,
    1301,
    8027,
    4245,
    3782,
    64017,
    43357,
    13843,
    196850301,
    17764140,
    PROFILE_SCREENSHOT_PATH,
    new Date("2026-04-04T00:00:00.000Z").toISOString()
  );
}

async function main() {
  await ensureRegistrationTables();
  await ensurePlayerArchiveTable();
  await upsertRegistrationPlayer();
  await upsertPlayerArchive();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Player added to database and player archive.");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

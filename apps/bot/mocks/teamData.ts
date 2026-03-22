export interface MockTeamData {
  teamName: string;
  captainName: string;
  playerNames: string[];
  substituteName: string;
  approvalStatus: string;
  checkInStatus: string;
}

import { prisma } from "../storage/prisma";
import { getActiveDevTeamName } from "../helpers/devSelection";

const defaultTeamData: MockTeamData[] = [
  {
    teamName: "Development Division Alpha",
    captainName: "Captain Murphy",
    playerNames: ["Player One", "Player Two", "Player Three"],
    substituteName: "Player Four",
    approvalStatus: "Approved",
    checkInStatus: "Checked In",
  },
  {
    teamName: "Development Division Bravo",
    captainName: "Captain Vega",
    playerNames: ["Player Five", "Player Six", "Player Seven"],
    substituteName: "Player Eight",
    approvalStatus: "Approved",
    checkInStatus: "Not Checked In",
  },
  {
    teamName: "Development Division Charlie",
    captainName: "Captain Stone",
    playerNames: ["Player Nine", "Player Ten", "Player Eleven"],
    substituteName: "Player Twelve",
    approvalStatus: "Approved",
    checkInStatus: "Not Checked In",
  },
  {
    teamName: "Development Division Delta",
    captainName: "Captain Brooks",
    playerNames: ["Player Thirteen", "Player Fourteen", "Player Fifteen"],
    substituteName: "Player Sixteen",
    approvalStatus: "Approved",
    checkInStatus: "Not Checked In",
  },
];

export function getDefaultDevelopmentTeams(): MockTeamData[] {
  return defaultTeamData.map((teamData) => ({
    ...teamData,
    playerNames: [...teamData.playerNames],
  }));
}

let teamTableReady: Promise<void> | undefined;

function serializeTeamData(teamData: MockTeamData) {
  return {
    teamName: teamData.teamName,
    captainName: teamData.captainName,
    playerNames: JSON.stringify(teamData.playerNames),
    substituteName: teamData.substituteName,
    approvalStatus: teamData.approvalStatus,
    checkInStatus: teamData.checkInStatus,
  };
}

function mapTeamData(record: {
  teamName: string;
  captainName: string;
  playerNames: string;
  substituteName: string;
  approvalStatus: string;
  checkInStatus: string;
}): MockTeamData {
  return {
    teamName: record.teamName,
    captainName: record.captainName,
    playerNames: JSON.parse(record.playerNames) as string[],
    substituteName: record.substituteName,
    approvalStatus: record.approvalStatus,
    checkInStatus: record.checkInStatus,
  };
}

async function ensureTeamTable(): Promise<void> {
  teamTableReady ??= prisma
    .$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Team" (
        "id" INTEGER NOT NULL PRIMARY KEY,
        "teamName" TEXT NOT NULL,
        "captainName" TEXT NOT NULL,
        "playerNames" TEXT NOT NULL,
        "substituteName" TEXT NOT NULL,
        "approvalStatus" TEXT NOT NULL,
        "checkInStatus" TEXT NOT NULL
      )
    `)
    .then(() => undefined);

  await teamTableReady;
}

async function ensureTeamSeedData(): Promise<void> {
  await ensureTeamTable();

  const existingTeamsCount = await prisma.team.count();

  if (existingTeamsCount > 0) {
    return;
  }

  await prisma.team.createMany({
    data: defaultTeamData.map((teamData, index) => ({
      id: index + 1,
      ...serializeTeamData(teamData),
    })),
  });
}

async function ensureTeamData(): Promise<MockTeamData> {
  await ensureTeamSeedData();

  const activeTeamName = getActiveDevTeamName();
  const record =
    (await prisma.team.findFirst({
      where: { teamName: activeTeamName },
    })) ??
    (await prisma.team.findFirst({
      orderBy: { id: "asc" },
    }));

  if (!record) {
    throw new Error("Failed to load development team data.");
  }

  return mapTeamData(record);
}

export async function getMockTeamData(_reportingUserKey: string): Promise<MockTeamData> {
  return ensureTeamData();
}

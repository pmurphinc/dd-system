import { getDefaultDevelopmentTeams } from "../mocks/teamData";
import { StoredReportSubmission } from "./reportSubmissions";
import { PrismaDbClient, prisma } from "./prisma";

export interface StoredStanding {
  id: number;
  teamName: string;
  frp: number;
  updatedAt: Date;
}

let standingsTableReady: Promise<void> | undefined;

const frpByScore: Record<string, { reportingTeam: number; opponentTeam: number }> =
  {
    "2_0": { reportingTeam: 2, opponentTeam: 0 },
    "2_1": { reportingTeam: 2, opponentTeam: 1 },
    "1_2": { reportingTeam: 1, opponentTeam: 2 },
    "0_2": { reportingTeam: 0, opponentTeam: 2 },
  };

export function getFrpAwardByScore(score: string): {
  reportingTeam: number;
  opponentTeam: number;
} | null {
  return frpByScore[score] ?? null;
}

async function ensureStandingsTable(): Promise<void> {
  standingsTableReady ??= Promise.resolve().then(async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Standing" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "teamName" TEXT NOT NULL,
        "frp" INTEGER NOT NULL,
        "updatedAt" DATETIME NOT NULL
      )
    `);
  });

  await standingsTableReady;
}

async function ensureStandingsSeedData(
  db: PrismaDbClient = prisma
): Promise<void> {
  await ensureStandingsTable();

  const standingsCount = await db.standing.count();

  if (standingsCount > 0) {
    return;
  }

  const now = new Date();
  await db.standing.createMany({
    data: getDefaultDevelopmentTeams().map((teamData) => ({
      teamName: teamData.teamName,
      frp: 0,
      updatedAt: now,
    })),
  });
}

async function incrementTeamFrp(
  teamName: string,
  frpDelta: number,
  db: PrismaDbClient = prisma
): Promise<void> {
  const now = new Date();
  const standing = await db.standing.findFirst({
    where: { teamName },
  });

  if (!standing) {
    await db.standing.create({
      data: {
        teamName,
        frp: frpDelta,
        updatedAt: now,
      },
    });
    return;
  }

  await db.standing.update({
    where: { id: standing.id },
    data: {
      frp: standing.frp + frpDelta,
      updatedAt: now,
    },
  });
}

export async function applyApprovedReportToStandings(
  reportSubmission: StoredReportSubmission,
  db: PrismaDbClient = prisma
): Promise<void> {
  await ensureStandingsSeedData(db);

  const frpAward = getFrpAwardByScore(reportSubmission.score);

  if (!frpAward) {
    return;
  }

  await incrementTeamFrp(reportSubmission.teamName, frpAward.reportingTeam, db);
  await incrementTeamFrp(
    reportSubmission.opponentTeamName,
    frpAward.opponentTeam,
    db
  );
}

export async function getStandings(): Promise<StoredStanding[]> {
  await ensureStandingsSeedData();

  return prisma.standing.findMany({
    orderBy: [{ frp: "desc" }, { teamName: "asc" }],
  });
}

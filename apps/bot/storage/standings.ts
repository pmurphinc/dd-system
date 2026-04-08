import { PrismaDbClient, prisma } from "./prisma";
import { StoredCashoutFrpBonus, listCashoutFrpBonusesForTournamentInstance } from "./cashoutFrpBonuses";
import { listImportedTeams, listImportedTeamsForTournamentInstance } from "./teams";

export interface StoredStanding {
  id: number;
  tournamentInstanceId: number | null;
  teamId: number | null;
  tournamentInstanceName?: string;
  teamName: string;
  frp: number;
  updatedAt: Date;
}

interface FrpBearingTeam {
  id: number;
  teamName: string;
}

interface StandingOfficialResult {
  teamId: number;
  opponentTeamId: number;
  frpAwardedToTeam: number;
  frpAwardedToOpponent: number;
}

export function buildStandingsFrpTotals(
  teams: FrpBearingTeam[],
  officialResults: StandingOfficialResult[],
  cashoutFrpBonuses: Pick<StoredCashoutFrpBonus, "teamId" | "teamName" | "frpAwarded">[]
): Map<number, { teamName: string; frp: number }> {
  const totals = new Map<number, { teamName: string; frp: number }>();

  for (const team of teams) {
    totals.set(team.id, {
      teamName: team.teamName,
      frp: 0,
    });
  }

  for (const result of officialResults) {
    const teamTotals = totals.get(result.teamId);
    const opponentTotals = totals.get(result.opponentTeamId);

    if (teamTotals) {
      teamTotals.frp += result.frpAwardedToTeam;
    }

    if (opponentTotals) {
      opponentTotals.frp += result.frpAwardedToOpponent;
    }
  }

  for (const bonus of cashoutFrpBonuses) {
    const entry = totals.get(bonus.teamId);

    if (entry) {
      entry.frp += bonus.frpAwarded;
    }
  }

  return totals;
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
  tournamentInstanceId?: number,
  db: PrismaDbClient = prisma
): Promise<void> {
  await ensureStandingsTable();

  const activeTeams =
    tournamentInstanceId === undefined
      ? await listImportedTeams()
      : await listImportedTeamsForTournamentInstance(tournamentInstanceId);
  const now = new Date();

  for (const team of activeTeams) {
    const existing = await db.standing.findFirst({
      where: {
        tournamentInstanceId: team.tournamentInstanceId ?? -1,
        teamId: team.id,
      },
    });

    if (!existing && team.tournamentInstanceId !== null) {
      await db.standing.create({
        data: {
          tournamentInstanceId: team.tournamentInstanceId,
          teamId: team.id,
          teamName: team.teamName,
          frp: 0,
          updatedAt: now,
        },
      });
    }
  }
}

async function setTeamFrp(
  tournamentInstanceId: number,
  teamId: number,
  teamName: string,
  frpValue: number,
  db: PrismaDbClient = prisma
): Promise<void> {
  const now = new Date();
  const standing = await db.standing.findFirst({
    where: {
      tournamentInstanceId,
      teamId,
    },
  });

  if (!standing) {
    await db.standing.create({
      data: {
          tournamentInstanceId,
          teamId,
          teamName,
          frp: frpValue,
          updatedAt: now,
        },
      });
    return;
  }

  await db.standing.update({
    where: { id: standing.id },
    data: {
      frp: frpValue,
      updatedAt: now,
    },
  });
}

export async function recomputeStandingsForTournamentInstance(
  tournamentInstanceId: number,
  db: PrismaDbClient = prisma
): Promise<void> {
  await ensureStandingsSeedData(tournamentInstanceId, db);
  const teams = await listImportedTeamsForTournamentInstance(tournamentInstanceId);

  const [officialResults, cashoutFrpBonuses] = await Promise.all([
    db.officialMatchResult.findMany({
      where: {
        tournamentInstanceId,
        status: "active",
      },
    }),
    listCashoutFrpBonusesForTournamentInstance(tournamentInstanceId, undefined, db),
  ]);

  const totals = buildStandingsFrpTotals(
    teams.map((team) => ({ id: team.id, teamName: team.teamName })),
    officialResults,
    cashoutFrpBonuses
  );

  for (const [teamId, entry] of totals.entries()) {
    await setTeamFrp(
      tournamentInstanceId,
      teamId,
      entry.teamName,
      entry.frp,
      db
    );
  }
}

export async function getStandings(): Promise<StoredStanding[]> {
  await ensureStandingsSeedData();
  const standings = await prisma.standing.findMany({
    include: {
      tournamentInstance: true,
    },
    orderBy: [{ frp: "desc" }, { teamName: "asc" }],
  });

  return standings.map((standing) => ({
    id: standing.id,
    tournamentInstanceId: standing.tournamentInstanceId,
    teamId: standing.teamId,
    tournamentInstanceName: standing.tournamentInstance?.name ?? "Unassigned",
    teamName: standing.teamName,
    frp: standing.frp,
    updatedAt: standing.updatedAt,
  }));
}

export async function getStandingsForTournamentInstance(
  tournamentInstanceId: number
): Promise<StoredStanding[]> {
  await ensureStandingsSeedData(tournamentInstanceId);

  const standings = await prisma.standing.findMany({
    where: { tournamentInstanceId },
    include: {
      tournamentInstance: true,
    },
    orderBy: [{ frp: "desc" }, { teamName: "asc" }],
  });

  return standings.map((standing) => ({
    id: standing.id,
    tournamentInstanceId: standing.tournamentInstanceId,
    teamId: standing.teamId,
    tournamentInstanceName: standing.tournamentInstance?.name ?? "Unassigned",
    teamName: standing.teamName,
    frp: standing.frp,
    updatedAt: standing.updatedAt,
  }));
}

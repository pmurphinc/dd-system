export interface MockReportAssignment {
  id: number;
  teamName: string;
  opponentTeamName: string;
  cycleNumber: number;
  stageName: string;
}

interface TournamentAssignmentSyncState {
  currentCycle: number | null;
  currentStage: string;
}

import { PrismaDbClient, prisma } from "../storage/prisma";
import { getActiveDevTeamName } from "../helpers/devSelection";

const defaultAssignments: MockReportAssignment[] = [
  {
    id: 1,
    teamName: "Development Division Alpha",
    opponentTeamName: "Development Division Bravo",
    cycleNumber: 1,
    stageName: "Swiss Stage",
  },
  {
    id: 2,
    teamName: "Development Division Charlie",
    opponentTeamName: "Development Division Delta",
    cycleNumber: 1,
    stageName: "Swiss Stage",
  },
];

let matchAssignmentTableReady: Promise<void> | undefined;

async function ensureMatchAssignmentTable(): Promise<void> {
  matchAssignmentTableReady ??= prisma
    .$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MatchAssignment" (
        "id" INTEGER NOT NULL PRIMARY KEY,
        "teamName" TEXT NOT NULL,
        "opponentTeamName" TEXT NOT NULL,
        "cycleNumber" INTEGER NOT NULL,
        "stageName" TEXT NOT NULL
      )
    `)
    .then(() => undefined);

  await matchAssignmentTableReady;
}

function mapMatchAssignment(record: {
  id: number;
  teamName: string;
  opponentTeamName: string;
  cycleNumber: number;
  stageName: string;
}): MockReportAssignment {
  return {
    id: record.id,
    teamName: record.teamName,
    opponentTeamName: record.opponentTeamName,
    cycleNumber: record.cycleNumber,
    stageName: record.stageName,
  };
}

async function ensureMatchAssignmentSeedData(
  db: PrismaDbClient = prisma
): Promise<void> {
  await ensureMatchAssignmentTable();

  const existingAssignmentsCount = await db.matchAssignment.count();

  if (existingAssignmentsCount > 0) {
    return;
  }

  await db.matchAssignment.createMany({
    data: defaultAssignments,
  });
}

async function getActiveMatchAssignmentRecord(db: PrismaDbClient = prisma) {
  await ensureMatchAssignmentSeedData(db);

  const activeTeamName = getActiveDevTeamName();
  const record =
    (await db.matchAssignment.findFirst({
      where: { teamName: activeTeamName },
    })) ??
    (await db.matchAssignment.findFirst({
      orderBy: { id: "asc" },
    }));

  if (!record) {
    throw new Error("Failed to load development match assignment.");
  }

  return record;
}

async function getTournamentAssignmentSyncState(
  db: PrismaDbClient = prisma
): Promise<TournamentAssignmentSyncState | null> {
  const tournamentState = await db.tournamentState.findUnique({
    where: { id: 1 },
    select: {
      currentCycle: true,
      currentStage: true,
    },
  });

  return tournamentState;
}

export async function syncActiveDevAssignmentToTournamentState(
  tournamentState: TournamentAssignmentSyncState,
  db: PrismaDbClient = prisma
): Promise<MockReportAssignment> {
  const activeAssignment = await getActiveMatchAssignmentRecord(db);
  const nextCycleNumber = tournamentState.currentCycle ?? 0;

  if (
    activeAssignment.cycleNumber === nextCycleNumber &&
    activeAssignment.stageName === tournamentState.currentStage
  ) {
    return mapMatchAssignment(activeAssignment);
  }

  const updatedRecord = await db.matchAssignment.update({
    where: { id: activeAssignment.id },
    data: {
      cycleNumber: nextCycleNumber,
      stageName: tournamentState.currentStage,
    },
  });

  return mapMatchAssignment(updatedRecord);
}

async function ensureMatchAssignment(): Promise<MockReportAssignment> {
  const tournamentState = await getTournamentAssignmentSyncState();

  if (tournamentState) {
    return syncActiveDevAssignmentToTournamentState(tournamentState);
  }

  const record = await getActiveMatchAssignmentRecord();

  return mapMatchAssignment(record);
}

export async function getMockReportAssignment(
  _reportingUserKey: string
): Promise<MockReportAssignment> {
  return ensureMatchAssignment();
}

export async function getMatchAssignmentsForCycle(
  cycle: number,
  db: PrismaDbClient = prisma
): Promise<MockReportAssignment[]> {
  await ensureMatchAssignmentSeedData(db);

  const records = await db.matchAssignment.findMany({
    where: { cycleNumber: cycle },
    orderBy: { id: "asc" },
  });

  return records.map(mapMatchAssignment);
}

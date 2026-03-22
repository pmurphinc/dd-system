import { PrismaDbClient, prisma } from "../storage/prisma";
import { syncActiveDevAssignmentToTournamentState } from "./reportAssignment";

export interface MockTournamentState {
  tournamentStatus: string;
  currentCycle: number | null;
  currentStage: string;
  checkedInTeams: number;
  totalTeams: number;
  activeMatch: string;
}

const tournamentProgression: MockTournamentState[] = [
  {
    tournamentStatus: "Registration Open",
    currentCycle: 0,
    currentStage: "Registration",
    checkedInTeams: 0,
    totalTeams: 4,
    activeMatch: "No active match",
  },
  {
    tournamentStatus: "Check-In Open",
    currentCycle: 0,
    currentStage: "Check-In",
    checkedInTeams: 0,
    totalTeams: 4,
    activeMatch: "No active match",
  },
  {
    tournamentStatus: "Live",
    currentCycle: 1,
    currentStage: "Cashout",
    checkedInTeams: 0,
    totalTeams: 4,
    activeMatch: "Team Alpha vs Team Bravo",
  },
  {
    tournamentStatus: "Live",
    currentCycle: 1,
    currentStage: "Final Round",
    checkedInTeams: 0,
    totalTeams: 4,
    activeMatch: "Team Alpha vs Team Bravo",
  },
  {
    tournamentStatus: "Live",
    currentCycle: 2,
    currentStage: "Cashout",
    checkedInTeams: 0,
    totalTeams: 4,
    activeMatch: "Team Alpha vs Team Bravo",
  },
  {
    tournamentStatus: "Live",
    currentCycle: 2,
    currentStage: "Final Round",
    checkedInTeams: 0,
    totalTeams: 4,
    activeMatch: "Team Alpha vs Team Bravo",
  },
  {
    tournamentStatus: "Live",
    currentCycle: 3,
    currentStage: "Cashout",
    checkedInTeams: 0,
    totalTeams: 4,
    activeMatch: "Team Alpha vs Team Bravo",
  },
  {
    tournamentStatus: "Live",
    currentCycle: 3,
    currentStage: "Final Round",
    checkedInTeams: 0,
    totalTeams: 4,
    activeMatch: "Team Alpha vs Team Bravo",
  },
  {
    tournamentStatus: "Completed",
    currentCycle: 3,
    currentStage: "Complete",
    checkedInTeams: 0,
    totalTeams: 4,
    activeMatch: "No active match",
  },
];

const defaultTournamentState: MockTournamentState = {
  ...tournamentProgression[0],
};

let tournamentStateTableReady: Promise<void> | undefined;

function mapTournamentState(record: {
  tournamentStatus: string;
  currentCycle: number | null;
  currentStage: string;
  checkedInTeams: number;
  totalTeams: number;
  activeMatch: string;
}): MockTournamentState {
  return {
    tournamentStatus: record.tournamentStatus,
    currentCycle: record.currentCycle,
    currentStage: record.currentStage,
    checkedInTeams: record.checkedInTeams,
    totalTeams: record.totalTeams,
    activeMatch: record.activeMatch,
  };
}

async function ensureTournamentStateTable(): Promise<void> {
  tournamentStateTableReady ??= prisma
    .$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "TournamentState" (
        "id" INTEGER NOT NULL PRIMARY KEY,
        "tournamentStatus" TEXT NOT NULL,
        "currentCycle" INTEGER,
        "currentStage" TEXT NOT NULL,
        "checkedInTeams" INTEGER NOT NULL,
        "totalTeams" INTEGER NOT NULL,
        "activeMatch" TEXT NOT NULL
      )
    `)
    .then(() => undefined);

  await tournamentStateTableReady;
}

async function ensureTournamentState(
  db: PrismaDbClient = prisma
): Promise<MockTournamentState> {
  await ensureTournamentStateTable();

  const record = await db.tournamentState.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      ...defaultTournamentState,
    },
  });

  return mapTournamentState(record);
}

export async function getMockTournamentState(
  db: PrismaDbClient = prisma
): Promise<MockTournamentState> {
  return ensureTournamentState(db);
}

export async function setMockTournamentState(
  nextState: MockTournamentState,
  db: PrismaDbClient = prisma
): Promise<MockTournamentState> {
  await ensureTournamentStateTable();

  const updatedRecord = await db.tournamentState.upsert({
    where: { id: 1 },
    update: nextState,
    create: {
      id: 1,
      ...nextState,
    },
  });

  const updatedState = mapTournamentState(updatedRecord);
  await syncActiveDevAssignmentToTournamentState(updatedState, db);

  return updatedState;
}

export async function incrementCheckedInTeams(): Promise<MockTournamentState> {
  const currentState = await ensureTournamentState();

  if (currentState.checkedInTeams >= currentState.totalTeams) {
    return currentState;
  }

  const updatedRecord = await prisma.tournamentState.update({
    where: { id: 1 },
    data: {
      checkedInTeams: currentState.checkedInTeams + 1,
    },
  });

  return mapTournamentState(updatedRecord);
}

export async function advanceMockTournamentState(): Promise<MockTournamentState> {
  const currentState = await ensureTournamentState();

  const currentIndex = tournamentProgression.findIndex(
    (state) =>
      state.tournamentStatus === currentState.tournamentStatus &&
      state.currentCycle === currentState.currentCycle &&
      state.currentStage === currentState.currentStage
  );

  const nextIndex =
    currentIndex === -1
      ? 0
      : Math.min(currentIndex + 1, tournamentProgression.length - 1);

  const nextState = tournamentProgression[nextIndex];

  const updatedRecord = await prisma.tournamentState.update({
    where: { id: 1 },
    data: {
      ...nextState,
      checkedInTeams: Math.min(currentState.checkedInTeams, nextState.totalTeams),
    },
  });

  const updatedState = mapTournamentState(updatedRecord);
  await syncActiveDevAssignmentToTournamentState(updatedState);

  return updatedState;
}

export async function resetMockTournamentState(): Promise<MockTournamentState> {
  return setMockTournamentState(defaultTournamentState);
}

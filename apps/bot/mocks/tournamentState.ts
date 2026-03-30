import { PrismaDbClient, prisma } from "../storage/prisma";
import { getPlacedTeams } from "../storage/teams";
import { createAuditLog } from "../storage/auditLog";
import { ensureAssignmentsForStage } from "./reportAssignment";

export interface TournamentStateSnapshot {
  tournamentStatus: string;
  currentCycle: number | null;
  currentStage: string;
  checkedInTeams: number;
  totalTeams: number;
  activeMatch: string;
}

const defaultTournamentState: TournamentStateSnapshot = {
  tournamentStatus: "Registration Open",
  currentCycle: null,
  currentStage: "Registration",
  checkedInTeams: 0,
  totalTeams: 0,
  activeMatch: "No active match",
};

let tournamentStateTableReady: Promise<void> | undefined;

function mapTournamentState(record: {
  tournamentStatus: string;
  currentCycle: number | null;
  currentStage: string;
  checkedInTeams: number;
  totalTeams: number;
  activeMatch: string;
}): TournamentStateSnapshot {
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
): Promise<TournamentStateSnapshot> {
  await ensureTournamentStateTable();

  const record = await db.tournamentState.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      ...defaultTournamentState,
    },
  });

  return syncTournamentTeamCounts(mapTournamentState(record), db);
}

export async function syncTournamentTeamCounts(
  currentState?: TournamentStateSnapshot,
  db: PrismaDbClient = prisma
): Promise<TournamentStateSnapshot> {
  await ensureTournamentStateTable();

  const placedTeams = await getPlacedTeams();
  const checkedInTeams = placedTeams.filter(
    (team) => team.checkInStatus === "Checked In"
  ).length;
  const baseState = currentState ?? (await ensureTournamentState(db));

  const updated = await db.tournamentState.upsert({
    where: { id: 1 },
    update: {
      checkedInTeams,
      totalTeams: placedTeams.length,
    },
    create: {
      id: 1,
      ...baseState,
      checkedInTeams,
      totalTeams: placedTeams.length,
    },
  });

  return mapTournamentState(updated);
}

export async function getTournamentState(
  db: PrismaDbClient = prisma
): Promise<TournamentStateSnapshot> {
  return ensureTournamentState(db);
}

export async function setTournamentState(
  nextState: TournamentStateSnapshot,
  db: PrismaDbClient = prisma
): Promise<TournamentStateSnapshot> {
  await ensureTournamentStateTable();

  const updatedRecord = await db.tournamentState.upsert({
    where: { id: 1 },
    update: nextState,
    create: {
      id: 1,
      ...nextState,
    },
  });

  return syncTournamentTeamCounts(mapTournamentState(updatedRecord), db);
}

export async function incrementCheckedInTeams(): Promise<TournamentStateSnapshot> {
  return syncTournamentTeamCounts();
}

function buildActiveMatchLabel(pairs: Array<[string, string]>): string {
  if (pairs.length === 0) {
    return "No active match";
  }

  return pairs.map(([teamName, opponentName]) => `${teamName} vs ${opponentName}`).join("\n");
}

export async function openCheckIn(actorDiscordUserId = "system"): Promise<TournamentStateSnapshot> {
  const nextState = await setTournamentState({
    tournamentStatus: "Check-In Open",
    currentCycle: null,
    currentStage: "Check-In",
    checkedInTeams: 0,
    totalTeams: 0,
    activeMatch: "No active match",
  });

  await createAuditLog({
    action: "tournament_checkin_opened",
    entityType: "tournament_state",
    entityId: "1",
    summary: "Opened check-in.",
    actorDiscordUserId,
  });

  return nextState;
}

export async function startTournamentCycle(
  actorDiscordUserId: string
): Promise<TournamentStateSnapshot> {
  const placedTeams = await getPlacedTeams();

  if (placedTeams.length < 4) {
    throw new Error("Four placed teams are required to start the event.");
  }

  const checkedInTeams = placedTeams.filter(
    (team) => team.checkInStatus === "Checked In"
  );

  if (checkedInTeams.length < 4) {
    throw new Error("Four checked-in teams are required to start the event.");
  }

  const pairs: Array<[string, string]> = [
    [placedTeams[0].teamName, placedTeams[1].teamName],
    [placedTeams[2].teamName, placedTeams[3].teamName],
  ];

  await ensureAssignmentsForStage(1, "Cashout", pairs);

  const nextState = await setTournamentState({
    tournamentStatus: "Live",
    currentCycle: 1,
    currentStage: "Cashout",
    checkedInTeams: checkedInTeams.length,
    totalTeams: placedTeams.length,
    activeMatch: buildActiveMatchLabel(pairs),
  });

  await createAuditLog({
    action: "tournament_cycle_started",
    entityType: "tournament_state",
    entityId: "1",
    summary: "Started cycle 1 Cashout.",
    details: nextState.activeMatch,
    actorDiscordUserId,
  });

  return nextState;
}

export async function advanceTournamentState(): Promise<TournamentStateSnapshot> {
  const currentState = await ensureTournamentState();

  if (currentState.tournamentStatus === "Registration Open") {
    return openCheckIn("system");
  }

  if (currentState.tournamentStatus === "Check-In Open") {
    return startTournamentCycle("system");
  }

  return currentState;
}

export async function updateTournamentActiveMatch(
  activeMatch: string
): Promise<TournamentStateSnapshot> {
  const currentState = await getTournamentState();

  return setTournamentState({
    ...currentState,
    activeMatch,
  });
}

export async function resetTournamentState(): Promise<TournamentStateSnapshot> {
  await ensureTournamentStateTable();

  const reset = await prisma.tournamentState.upsert({
    where: { id: 1 },
    update: defaultTournamentState,
    create: {
      id: 1,
      ...defaultTournamentState,
    },
  });

  return mapTournamentState(reset);
}

export type MockTournamentState = TournamentStateSnapshot;
export const getMockTournamentState = getTournamentState;
export const setMockTournamentState = setTournamentState;
export const advanceMockTournamentState = advanceTournamentState;
export const resetMockTournamentState = resetTournamentState;

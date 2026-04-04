import { TournamentStage } from "@prisma/client";
import { prisma } from "./prisma";

export interface StoredMatchAssignment {
  id: number;
  tournamentInstanceId: number | null;
  teamId: number | null;
  opponentTeamId: number | null;
  teamName: string;
  opponentTeamName: string;
  cycleNumber: number;
  stageName: string;
  bracketLabel: string | null;
  assignedMap: string | null;
}

function normalizeAssignment(record: StoredMatchAssignment): StoredMatchAssignment {
  return record;
}

let matchAssignmentTableReady: Promise<void> | undefined;

async function ensureMatchAssignmentColumns(): Promise<void> {
  matchAssignmentTableReady ??= Promise.resolve().then(async () => {
    const columns = (await prisma.$queryRawUnsafe(
      `PRAGMA table_info("MatchAssignment")`
    )) as Array<{ name: string }>;

    if (!columns.some((column) => column.name === "assignedMap")) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "MatchAssignment" ADD COLUMN "assignedMap" TEXT`
      );
    }
  });

  await matchAssignmentTableReady;
}

export async function listMatchAssignmentsForTournamentInstance(
  tournamentInstanceId: number,
  cycleNumber?: number,
  stageName?: TournamentStage
): Promise<StoredMatchAssignment[]> {
  await ensureMatchAssignmentColumns();
  const assignments = await prisma.matchAssignment.findMany({
    where: {
      tournamentInstanceId,
      ...(cycleNumber === undefined ? {} : { cycleNumber }),
      ...(stageName === undefined ? {} : { stageName }),
    },
    orderBy: [{ cycleNumber: "asc" }, { id: "asc" }],
  });

  return assignments.map(normalizeAssignment);
}

export async function getMatchAssignmentById(
  id: number
): Promise<StoredMatchAssignment | null> {
  await ensureMatchAssignmentColumns();
  const assignment = await prisma.matchAssignment.findUnique({
    where: { id },
  });

  return assignment ? normalizeAssignment(assignment) : null;
}

export async function getCurrentFinalRoundAssignmentForTeam(
  tournamentInstanceId: number,
  teamId: number,
  cycleNumber: number | null
): Promise<StoredMatchAssignment | null> {
  await ensureMatchAssignmentColumns();
  if (cycleNumber === null) {
    return null;
  }

  const assignment = await prisma.matchAssignment.findFirst({
    where: {
      tournamentInstanceId,
      cycleNumber,
      stageName: TournamentStage.FINAL_ROUND,
      OR: [{ teamId }, { opponentTeamId: teamId }],
    },
    orderBy: { id: "asc" },
  });

  if (!assignment) {
    return null;
  }

  if (
    assignment.tournamentInstanceId === null ||
    assignment.teamId === null ||
    assignment.opponentTeamId === null
  ) {
    return null;
  }

  return assignment.teamId === teamId
    ? normalizeAssignment(assignment)
    : {
        id: assignment.id,
        tournamentInstanceId: assignment.tournamentInstanceId,
        teamId,
        opponentTeamId: assignment.teamId,
        teamName: assignment.opponentTeamName,
        opponentTeamName: assignment.teamName,
        cycleNumber: assignment.cycleNumber,
        stageName: assignment.stageName,
        bracketLabel: assignment.bracketLabel,
        assignedMap: assignment.assignedMap ?? null,
      };
}

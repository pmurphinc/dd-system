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
}

function normalizeAssignment(record: StoredMatchAssignment): StoredMatchAssignment {
  return record;
}

export async function listMatchAssignmentsForTournamentInstance(
  tournamentInstanceId: number,
  cycleNumber?: number,
  stageName?: TournamentStage
): Promise<StoredMatchAssignment[]> {
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
      };
}

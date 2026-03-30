import { getCycleCompletionStatus } from "./cycleCompletion";
import { getMatchAssignmentsForCycle } from "../mocks/reportAssignment";
import { TournamentStateSnapshot } from "../mocks/tournamentState";
import { getCycleResultsForCycle } from "../storage/cycleResults";

export interface TournamentProgressSummary {
  cycleCompletionLabel: string;
  missingAssignmentsLabel: string;
}

function formatMissingAssignmentsLabel(assignmentIds: number[]): string {
  return assignmentIds.map((assignmentId) => `Assignment ${assignmentId}`).join("\n");
}

export async function getTournamentProgressSummary(
  tournamentState: TournamentStateSnapshot
): Promise<TournamentProgressSummary> {
  if (tournamentState.tournamentStatus === "Completed") {
    return {
      cycleCompletionLabel: "Tournament finished",
      missingAssignmentsLabel: "None",
    };
  }

  if (tournamentState.currentCycle === null) {
    return {
      cycleCompletionLabel: "No active cycle",
      missingAssignmentsLabel: "-",
    };
  }

  if (tournamentState.tournamentStatus !== "Live") {
    return {
      cycleCompletionLabel: "Not evaluating",
      missingAssignmentsLabel: "-",
    };
  }

  if (tournamentState.currentStage !== "Final Round") {
    return {
      cycleCompletionLabel: "Awaiting Final Round",
      missingAssignmentsLabel: "-",
    };
  }

  const [assignments, cycleResults] = await Promise.all([
    getMatchAssignmentsForCycle(tournamentState.currentCycle),
    getCycleResultsForCycle(tournamentState.currentCycle),
  ]);

  const cycleCompletionStatus = getCycleCompletionStatus(
    tournamentState.currentCycle,
    assignments,
    cycleResults
  );

  if (cycleCompletionStatus.requiredAssignmentIds.length === 0) {
    return {
      cycleCompletionLabel: "No Final Round assignments",
      missingAssignmentsLabel: "-",
    };
  }

  if (cycleCompletionStatus.isComplete) {
    return {
      cycleCompletionLabel: "Yes",
      missingAssignmentsLabel: "None",
    };
  }

  if (cycleCompletionStatus.duplicateAssignmentIds.length > 0) {
    return {
      cycleCompletionLabel: "No",
      missingAssignmentsLabel: cycleCompletionStatus.missingAssignmentIds.length
        > 0
        ? formatMissingAssignmentsLabel(cycleCompletionStatus.missingAssignmentIds)
        : "Waiting on duplicate-result cleanup",
    };
  }

  return {
    cycleCompletionLabel: "No",
    missingAssignmentsLabel: formatMissingAssignmentsLabel(
      cycleCompletionStatus.missingAssignmentIds
    ),
  };
}

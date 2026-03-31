import {
  CycleCompletionStatus,
  getCycleCompletionStatus,
} from "../helpers/cycleCompletion";
import { getMatchAssignmentsForCycle } from "../mocks/reportAssignment";
import {
  TournamentStateSnapshot,
  setTournamentState,
} from "../mocks/tournamentState";
import { getCycleResultsForCycle } from "../storage/cycleResults";
import { PrismaDbClient, prisma } from "../storage/prisma";
import { pushTournamentWebhookUpdate } from "./tournamentWebhook";

export interface CycleFinalizationResult {
  didFinalizeCycle: boolean;
  cycle: number | null;
  nextAction: "none" | "advance_to_next_cycle" | "finish_tournament";
  completionStatus: CycleCompletionStatus | null;
  reason?: string;
}

interface FinalizeCycleOptions {
  cycle?: number;
}

function buildNextCycleTournamentState(
  tournamentState: TournamentStateSnapshot,
  nextCycle: number
): TournamentStateSnapshot {
  return {
    ...tournamentState,
    tournamentStatus: "Live",
    currentCycle: nextCycle,
    currentStage: "Cashout",
    activeMatch: "Assignments pending",
  };
}

function buildCompletedTournamentState(
  tournamentState: TournamentStateSnapshot
): TournamentStateSnapshot {
  return {
    ...tournamentState,
    tournamentStatus: "Completed",
    currentCycle: 3,
    currentStage: "Complete",
    activeMatch: "No active match",
  };
}

export async function finalizeCycleIfComplete(
  tournamentState: TournamentStateSnapshot,
  options: FinalizeCycleOptions = {},
  db: PrismaDbClient = prisma
): Promise<CycleFinalizationResult> {
  const cycle = options.cycle ?? tournamentState.currentCycle;

  if (cycle === null) {
    return {
      didFinalizeCycle: false,
      cycle: null,
      nextAction: "none",
      completionStatus: null,
      reason: "No active cycle is set.",
    };
  }

  const [assignments, cycleResults] = await Promise.all([
    getMatchAssignmentsForCycle(cycle, db),
    getCycleResultsForCycle(cycle, db),
  ]);

  const completionStatus = getCycleCompletionStatus(
    cycle,
    assignments,
    cycleResults
  );

  if (tournamentState.tournamentStatus === "Completed") {
    return {
      didFinalizeCycle: false,
      cycle,
      nextAction: "none",
      completionStatus,
      reason: "Tournament already finished.",
    };
  }

  if (
    tournamentState.currentCycle !== null &&
    tournamentState.currentCycle > cycle
  ) {
    return {
      didFinalizeCycle: false,
      cycle,
      nextAction: "none",
      completionStatus,
      reason: "Cycle already finalized.",
    };
  }

  if (
    tournamentState.currentCycle !== null &&
    tournamentState.currentCycle < cycle
  ) {
    return {
      didFinalizeCycle: false,
      cycle,
      nextAction: "none",
      completionStatus,
      reason: "Tournament state is behind the requested cycle.",
    };
  }

  if (tournamentState.tournamentStatus !== "Live") {
    return {
      didFinalizeCycle: false,
      cycle,
      nextAction: "none",
      completionStatus,
      reason: "Tournament is not in a live state.",
    };
  }

  if (tournamentState.currentStage !== "Final Round") {
    return {
      didFinalizeCycle: false,
      cycle,
      nextAction: "none",
      completionStatus,
      reason: "Cycle already finalized.",
    };
  }

  if (!completionStatus.isComplete) {
    return {
      didFinalizeCycle: false,
      cycle,
      nextAction: "none",
      completionStatus,
      reason:
        completionStatus.duplicateAssignmentIds.length > 0
          ? "Cycle has duplicate result conflicts."
          : "Cycle is not complete yet.",
    };
  }

  if (cycle >= 3) {
    await setTournamentState(buildCompletedTournamentState(tournamentState), db);
    await pushTournamentWebhookUpdate({
      reason: "legacy_finalize_cycle_complete",
    });

    return {
      didFinalizeCycle: true,
      cycle,
      nextAction: "finish_tournament",
      completionStatus,
    };
  }

  await setTournamentState(
    buildNextCycleTournamentState(tournamentState, cycle + 1),
    db
  );
  await pushTournamentWebhookUpdate({
    reason: "legacy_finalize_cycle_advanced",
  });

  return {
    didFinalizeCycle: true,
    cycle,
    nextAction: "advance_to_next_cycle",
    completionStatus,
  };
}

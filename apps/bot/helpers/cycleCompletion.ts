import { ReportAssignment } from "../domain/reportAssignment";
import { StoredCycleResult } from "../storage/cycleResults";

const FINAL_ROUND_STAGE_NAME = "Final Round";

export interface CycleCompletionStatus {
  cycle: number;
  requiredAssignmentIds: number[];
  completedAssignmentIds: number[];
  missingAssignmentIds: number[];
  duplicateAssignmentIds: number[];
  isComplete: boolean;
}

export function getCycleCompletionStatus(
  cycle: number,
  assignments: ReportAssignment[],
  cycleResults: StoredCycleResult[]
): CycleCompletionStatus {
  // Stage 2 is currently represented by Final Round assignments for the cycle.
  const requiredAssignments = assignments.filter(
    (assignment) =>
      assignment.cycleNumber === cycle &&
      assignment.stageName === FINAL_ROUND_STAGE_NAME
  );

  const requiredAssignmentIds = requiredAssignments
    .map((assignment) => assignment.id)
    .sort((left, right) => left - right);

  const requiredAssignmentIdSet = new Set(requiredAssignmentIds);

  // Only results tied to a valid Final Round assignment for this cycle count.
  const validCycleResults = cycleResults.filter(
    (cycleResult) =>
      cycleResult.cycleNumber === cycle &&
      requiredAssignmentIdSet.has(cycleResult.matchAssignmentId)
  );

  const resultCountByAssignmentId = new Map<number, number>();

  for (const cycleResult of validCycleResults) {
    const currentCount =
      resultCountByAssignmentId.get(cycleResult.matchAssignmentId) ?? 0;
    resultCountByAssignmentId.set(
      cycleResult.matchAssignmentId,
      currentCount + 1
    );
  }

  const duplicateAssignmentIds = Array.from(resultCountByAssignmentId.entries())
    .filter(([, count]) => count > 1)
    .map(([assignmentId]) => assignmentId)
    .sort((left, right) => left - right);

  const completedAssignmentIds = requiredAssignmentIds.filter(
    (assignmentId) => resultCountByAssignmentId.get(assignmentId) === 1
  );

  const missingAssignmentIds = requiredAssignmentIds.filter(
    (assignmentId) => !completedAssignmentIds.includes(assignmentId)
  );

  return {
    cycle,
    requiredAssignmentIds,
    completedAssignmentIds,
    missingAssignmentIds,
    duplicateAssignmentIds,
    isComplete:
      requiredAssignmentIds.length > 0 &&
      missingAssignmentIds.length === 0 &&
      duplicateAssignmentIds.length === 0,
  };
}

export function isCycleComplete(
  cycle: number,
  assignments: ReportAssignment[],
  cycleResults: StoredCycleResult[]
): boolean {
  return getCycleCompletionStatus(cycle, assignments, cycleResults).isComplete;
}

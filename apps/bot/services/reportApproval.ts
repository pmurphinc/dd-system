import { prisma } from "../storage/prisma";
import {
  getReportSubmissionById,
  StoredReportSubmission,
} from "../storage/reportSubmissions";
import { applyApprovedReportToStandings } from "../storage/standings";
import { recordApprovedCycleResult } from "../storage/cycleResults";
import { getMockTournamentState } from "../mocks/tournamentState";
import {
  CycleFinalizationResult,
  finalizeCycleIfComplete,
} from "./tournamentEngine";
import { CycleCompletionStatus } from "../helpers/cycleCompletion";

export interface ReportApprovalResult {
  approvedReportId: number;
  cycleResultCreated: boolean;
  cycleCompletion: CycleCompletionStatus | null;
  cycleFinalization: CycleFinalizationResult | null;
}

export async function approveReportSubmission(
  reportSubmission: StoredReportSubmission
): Promise<ReportApprovalResult> {
  return prisma.$transaction(async (tx) => {
    const currentReportSubmission = await getReportSubmissionById(
      reportSubmission.id,
      tx
    );

    if (!currentReportSubmission) {
      throw new Error(
        `Report submission ${reportSubmission.id} was not found during approval.`
      );
    }

    if (currentReportSubmission.status === "rejected") {
      return {
        approvedReportId: currentReportSubmission.id,
        cycleResultCreated: false,
        cycleCompletion: null,
        cycleFinalization: null,
      };
    }

    const approvalStatusUpdateResult = await tx.reportSubmission.updateMany({
      where: {
        id: currentReportSubmission.id,
        status: "pending",
      },
      data: { status: "approved" },
    });

    const didTransitionFromPendingToApproved =
      approvalStatusUpdateResult.count > 0;

    const approvedReportSubmission = didTransitionFromPendingToApproved
      ? {
          ...currentReportSubmission,
          status: "approved",
        }
      : ((await getReportSubmissionById(currentReportSubmission.id, tx)) ??
          currentReportSubmission);

    if (approvedReportSubmission.status === "rejected") {
      return {
        approvedReportId: approvedReportSubmission.id,
        cycleResultCreated: false,
        cycleCompletion: null,
        cycleFinalization: null,
      };
    }

    if (didTransitionFromPendingToApproved) {
      await applyApprovedReportToStandings(approvedReportSubmission, tx);
    }

    const cycleResult = await recordApprovedCycleResult(approvedReportSubmission, tx);

    if (!cycleResult) {
      return {
        approvedReportId: approvedReportSubmission.id,
        cycleResultCreated: false,
        cycleCompletion: null,
        cycleFinalization: null,
      };
    }

    const tournamentState = await getMockTournamentState(tx);
    const cycleFinalization = await finalizeCycleIfComplete(
      tournamentState,
      { cycle: approvedReportSubmission.cycleNumber },
      tx
    );

    return {
      approvedReportId: approvedReportSubmission.id,
      cycleResultCreated: true,
      cycleCompletion: cycleFinalization.completionStatus,
      cycleFinalization,
    };
  });
}

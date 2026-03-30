import { prisma } from "../storage/prisma";
import {
  getReportSubmissionById,
  StoredReportSubmission,
} from "../storage/reportSubmissions";

export interface ReportApprovalResult {
  approvedReportId: number;
  cycleResultCreated: false;
  cycleCompletion: null;
  cycleFinalization: null;
}

export async function approveReportSubmission(
  reportSubmission: StoredReportSubmission
): Promise<ReportApprovalResult> {
  const currentReportSubmission = await getReportSubmissionById(reportSubmission.id, prisma);

  if (!currentReportSubmission) {
    throw new Error(
      `Report submission ${reportSubmission.id} was not found during review.`
    );
  }

  if (currentReportSubmission.status !== "pending") {
    return {
      approvedReportId: currentReportSubmission.id,
      cycleResultCreated: false,
      cycleCompletion: null,
      cycleFinalization: null,
    };
  }

  await prisma.reportSubmission.update({
    where: { id: currentReportSubmission.id },
    data: { status: "reviewed" },
  });

  return {
    approvedReportId: currentReportSubmission.id,
    cycleResultCreated: false,
    cycleCompletion: null,
    cycleFinalization: null,
  };
}

import { InformationalReportStatus, TournamentStage } from "@prisma/client";
import { PrismaDbClient, prisma } from "./prisma";

export interface ReportSubmissionInput {
  tournamentInstanceId: number | null;
  teamId: number | null;
  score: string;
  matchAssignmentId: number;
  submittedByDiscordUserId: string;
  submittedByDisplayName: string;
  teamName: string;
  opponentTeamName: string;
  cycleNumber: number;
  stageName: string;
  notes: string;
}

export interface StoredReportSubmission extends ReportSubmissionInput {
  id: number;
  status: string;
  submittedAt: Date;
}

export type ReportSubmissionStatusFilter =
  | "all"
  | "pending"
  | "reviewed"
  | "dismissed";

export type TeamStageSubmissionType = "CASHOUT_PLACEMENT" | "FINAL_ROUND_SCORE";

export interface TeamStageSubmissionInput {
  tournamentInstanceId: number;
  teamId: number;
  teamName: string;
  opponentTeamName: string;
  cycleNumber: number;
  stageName: TournamentStage.CASHOUT | TournamentStage.FINAL_ROUND;
  submissionType: TeamStageSubmissionType;
  value: number;
  submittedByDiscordUserId: string;
  submittedByDisplayName: string;
  matchAssignmentId?: number;
}

let reportSubmissionTableReady: Promise<void> | undefined;

async function ensureReportSubmissionTable(): Promise<void> {
  reportSubmissionTableReady ??= Promise.resolve()
    .then(async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ReportSubmission" (
          "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
          "tournamentInstanceId" INTEGER NOT NULL DEFAULT 0,
          "teamId" INTEGER NOT NULL DEFAULT 0,
          "score" TEXT NOT NULL,
          "matchAssignmentId" INTEGER NOT NULL,
          "submittedByDiscordUserId" TEXT NOT NULL DEFAULT '',
          "submittedByDisplayName" TEXT NOT NULL DEFAULT '',
          "teamName" TEXT NOT NULL,
          "opponentTeamName" TEXT NOT NULL,
          "cycleNumber" INTEGER NOT NULL,
          "stageName" TEXT NOT NULL,
          "notes" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'pending',
          "submittedAt" DATETIME NOT NULL
        )
      `);

      const columns = (await prisma.$queryRawUnsafe(`
        PRAGMA table_info("ReportSubmission")
      `)) as Array<{ name: string }>;
      const hasStatusColumn = columns.some((column) => column.name === "status");
      const hasMatchAssignmentIdColumn = columns.some(
        (column) => column.name === "matchAssignmentId"
      );
      const hasSubmittedByDiscordUserIdColumn = columns.some(
        (column) => column.name === "submittedByDiscordUserId"
      );
      const hasSubmittedByDisplayNameColumn = columns.some(
        (column) => column.name === "submittedByDisplayName"
      );
      const hasTournamentInstanceIdColumn = columns.some(
        (column) => column.name === "tournamentInstanceId"
      );
      const hasTeamIdColumn = columns.some((column) => column.name === "teamId");

      if (!hasStatusColumn) {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "ReportSubmission"
          ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending'
        `);
      }

      if (!hasMatchAssignmentIdColumn) {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "ReportSubmission"
          ADD COLUMN "matchAssignmentId" INTEGER NOT NULL DEFAULT 1
        `);
      }

      if (!hasSubmittedByDiscordUserIdColumn) {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "ReportSubmission"
          ADD COLUMN "submittedByDiscordUserId" TEXT NOT NULL DEFAULT ''
        `);
      }

      if (!hasSubmittedByDisplayNameColumn) {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "ReportSubmission"
          ADD COLUMN "submittedByDisplayName" TEXT NOT NULL DEFAULT ''
        `);
      }

      if (!hasTournamentInstanceIdColumn) {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "ReportSubmission"
          ADD COLUMN "tournamentInstanceId" INTEGER NOT NULL DEFAULT 0
        `);
      }

      if (!hasTeamIdColumn) {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "ReportSubmission"
          ADD COLUMN "teamId" INTEGER NOT NULL DEFAULT 0
        `);
      }
    });

  await reportSubmissionTableReady;
}

function parseSubmissionType(notes: string): TeamStageSubmissionType | null {
  if (notes.startsWith("TEAM_STAGE:CASHOUT_PLACEMENT")) {
    return "CASHOUT_PLACEMENT";
  }

  if (notes.startsWith("TEAM_STAGE:FINAL_ROUND_SCORE")) {
    return "FINAL_ROUND_SCORE";
  }

  return null;
}

function isTeamStageSubmission(submission: StoredReportSubmission): boolean {
  return parseSubmissionType(submission.notes) !== null;
}

function normalizeStatusLabel(status: InformationalReportStatus): string {
  if (status === InformationalReportStatus.pending) return "pending approval";
  if (status === InformationalReportStatus.reviewed) return "approved";
  return "rejected";
}

function assertTeamStageValue(type: TeamStageSubmissionType, value: number): void {
  if (type === "CASHOUT_PLACEMENT" && ![1, 2, 3, 4].includes(value)) {
    throw new Error("Cashout placement must be 1, 2, 3, or 4.");
  }

  if (type === "FINAL_ROUND_SCORE" && ![0, 1, 2].includes(value)) {
    throw new Error("Final Round FRP must be 0, 1, or 2.");
  }
}

function assertStageTypeAlignment(
  stageName: TournamentStage.CASHOUT | TournamentStage.FINAL_ROUND,
  submissionType: TeamStageSubmissionType
): void {
  if (stageName === TournamentStage.CASHOUT && submissionType !== "CASHOUT_PLACEMENT") {
    throw new Error("Cashout stage only accepts cashout placement submissions.");
  }

  if (
    stageName === TournamentStage.FINAL_ROUND &&
    submissionType !== "FINAL_ROUND_SCORE"
  ) {
    throw new Error("Final Round stage only accepts final-round FRP submissions.");
  }
}

export async function createReportSubmission(
  input: ReportSubmissionInput
): Promise<StoredReportSubmission> {
  await ensureReportSubmissionTable();

  return prisma.reportSubmission.create({
    data: {
      ...input,
      status: "pending",
      submittedAt: new Date(),
    },
  });
}

export async function createOrUpdateTeamStageSubmission(
  input: TeamStageSubmissionInput
): Promise<StoredReportSubmission> {
  await ensureReportSubmissionTable();
  assertStageTypeAlignment(input.stageName, input.submissionType);
  assertTeamStageValue(input.submissionType, input.value);

  if (input.submissionType === "CASHOUT_PLACEMENT") {
    const conflicting = await prisma.reportSubmission.findFirst({
      where: {
        tournamentInstanceId: input.tournamentInstanceId,
        cycleNumber: input.cycleNumber,
        stageName: TournamentStage.CASHOUT,
        status: {
          in: [InformationalReportStatus.pending, InformationalReportStatus.reviewed],
        },
        teamId: { not: input.teamId },
        score: `${input.value}`,
      },
      orderBy: { submittedAt: "desc" },
    });

    if (conflicting && parseSubmissionType(conflicting.notes) === "CASHOUT_PLACEMENT") {
      throw new Error(`Placement ${input.value} is already reserved by another team.`);
    }
  }

  const existing = await prisma.reportSubmission.findFirst({
    where: {
      tournamentInstanceId: input.tournamentInstanceId,
      teamId: input.teamId,
      cycleNumber: input.cycleNumber,
      stageName: input.stageName,
    },
    orderBy: { submittedAt: "desc" },
  });

  if (existing && parseSubmissionType(existing.notes) !== input.submissionType) {
    throw new Error("Existing submission is incompatible with this stage submission type.");
  }

  if (existing && existing.status === InformationalReportStatus.reviewed) {
    throw new Error("Approved submissions are locked. Ask an admin to reopen/override.");
  }

  const notes = `TEAM_STAGE:${input.submissionType}`;

  if (existing) {
    return prisma.reportSubmission.update({
      where: { id: existing.id },
      data: {
        score: `${input.value}`,
        matchAssignmentId: input.matchAssignmentId ?? existing.matchAssignmentId,
        submittedByDiscordUserId: input.submittedByDiscordUserId,
        submittedByDisplayName: input.submittedByDisplayName,
        teamName: input.teamName,
        opponentTeamName: input.opponentTeamName,
        notes,
        status: InformationalReportStatus.pending,
        submittedAt: new Date(),
      },
    });
  }

  return prisma.reportSubmission.create({
    data: {
      tournamentInstanceId: input.tournamentInstanceId,
      teamId: input.teamId,
      score: `${input.value}`,
      matchAssignmentId: input.matchAssignmentId ?? 0,
      submittedByDiscordUserId: input.submittedByDiscordUserId,
      submittedByDisplayName: input.submittedByDisplayName,
      teamName: input.teamName,
      opponentTeamName: input.opponentTeamName,
      cycleNumber: input.cycleNumber,
      stageName: input.stageName,
      notes,
      status: InformationalReportStatus.pending,
      submittedAt: new Date(),
    },
  });
}

export async function getCurrentTeamStageSubmission(
  tournamentInstanceId: number,
  teamId: number,
  cycleNumber: number,
  stageName: TournamentStage.CASHOUT | TournamentStage.FINAL_ROUND
): Promise<StoredReportSubmission | null> {
  await ensureReportSubmissionTable();

  const submission = await prisma.reportSubmission.findFirst({
    where: {
      tournamentInstanceId,
      teamId,
      cycleNumber,
      stageName,
    },
    orderBy: { submittedAt: "desc" },
  });

  if (!submission || !isTeamStageSubmission(submission)) {
    return null;
  }

  return submission;
}

export async function listCurrentStageTeamSubmissions(
  tournamentInstanceId: number,
  cycleNumber: number,
  stageName: TournamentStage.CASHOUT | TournamentStage.FINAL_ROUND
): Promise<StoredReportSubmission[]> {
  await ensureReportSubmissionTable();

  const submissions = await prisma.reportSubmission.findMany({
    where: {
      tournamentInstanceId,
      cycleNumber,
      stageName,
    },
    orderBy: [{ teamName: "asc" }, { submittedAt: "desc" }],
  });

  return submissions.filter(isTeamStageSubmission);
}

export async function computeReservedCashoutPlacements(
  tournamentInstanceId: number,
  cycleNumber: number,
  excludeTeamId?: number
): Promise<number[]> {
  const submissions = await listCurrentStageTeamSubmissions(
    tournamentInstanceId,
    cycleNumber,
    TournamentStage.CASHOUT
  );

  const reserved = submissions
    .filter((submission) =>
      [InformationalReportStatus.pending, InformationalReportStatus.reviewed].includes(
        submission.status as InformationalReportStatus
      )
    )
    .filter((submission) => (excludeTeamId ? submission.teamId !== excludeTeamId : true))
    .map((submission) => Number(submission.score))
    .filter((placement) => [1, 2, 3, 4].includes(placement));

  return Array.from(new Set(reserved)).sort((a, b) => a - b);
}

export async function approveTeamStageSubmission(
  id: number,
  actorDiscordUserId: string
): Promise<StoredReportSubmission> {
  await ensureReportSubmissionTable();

  const existing = await prisma.reportSubmission.findUnique({ where: { id } });

  if (!existing || !isTeamStageSubmission(existing)) {
    throw new Error("Team stage submission not found.");
  }

  if (parseSubmissionType(existing.notes) === "CASHOUT_PLACEMENT") {
    const conflicting = await prisma.reportSubmission.findFirst({
      where: {
        id: { not: existing.id },
        tournamentInstanceId: existing.tournamentInstanceId,
        cycleNumber: existing.cycleNumber,
        stageName: TournamentStage.CASHOUT,
        score: existing.score,
        status: {
          in: [InformationalReportStatus.pending, InformationalReportStatus.reviewed],
        },
      },
      orderBy: { submittedAt: "desc" },
    });

    if (conflicting && parseSubmissionType(conflicting.notes) === "CASHOUT_PLACEMENT") {
      throw new Error(
        `Cannot approve placement ${existing.score}; it is already reserved by ${conflicting.teamName}.`
      );
    }
  }

  return prisma.reportSubmission.update({
    where: { id },
    data: {
      status: InformationalReportStatus.reviewed,
      notes: `${existing.notes}|APPROVED_BY:${actorDiscordUserId}`,
    },
  });
}

export async function rejectTeamStageSubmission(
  id: number,
  actorDiscordUserId: string,
  reason: string
): Promise<StoredReportSubmission> {
  await ensureReportSubmissionTable();

  const existing = await prisma.reportSubmission.findUnique({ where: { id } });

  if (!existing || !isTeamStageSubmission(existing)) {
    throw new Error("Team stage submission not found.");
  }

  return prisma.reportSubmission.update({
    where: { id },
    data: {
      status: InformationalReportStatus.dismissed,
      notes: `${existing.notes}|REJECTED_BY:${actorDiscordUserId}|REASON:${reason.slice(0, 180)}`,
    },
  });
}

export function getTeamStageSubmissionStatusLabel(
  submission: StoredReportSubmission | null
): string {
  if (!submission) {
    return "none";
  }

  return normalizeStatusLabel(submission.status as InformationalReportStatus);
}

export function getTeamStageSubmissionType(
  submission: StoredReportSubmission
): TeamStageSubmissionType | null {
  return parseSubmissionType(submission.notes);
}

export function reconcileFinalRoundFrpPair(
  teamFrp: number,
  opponentFrp: number
): { winnerFromTeamSide: boolean; score: "2_0" | "2_1" } {
  const key = `${teamFrp}:${opponentFrp}`;
  if (!["2:0", "2:1", "1:2", "0:2"].includes(key)) {
    throw new Error(`Invalid Final Round FRP combination ${teamFrp}-${opponentFrp}.`);
  }

  if (teamFrp === 2) {
    return {
      winnerFromTeamSide: true,
      score: opponentFrp === 0 ? "2_0" : "2_1",
    };
  }

  return {
    winnerFromTeamSide: false,
    score: teamFrp === 0 ? "2_0" : "2_1",
  };
}

export async function hasPendingReportSubmissionForAssignment(
  matchAssignmentId: number,
  teamId?: number
): Promise<boolean> {
  await ensureReportSubmissionTable();

  const pendingReportCount = await prisma.reportSubmission.count({
    where: {
      matchAssignmentId,
      status: "pending",
      ...(teamId === undefined ? {} : { teamId }),
    },
  });

  return pendingReportCount > 0;
}

export async function getRecentReportSubmissions(
  limit = 5,
  statusFilter: ReportSubmissionStatusFilter = "all",
  tournamentInstanceId?: number
): Promise<StoredReportSubmission[]> {
  await ensureReportSubmissionTable();

  return prisma.reportSubmission.findMany({
    where:
      statusFilter === "all"
        ? tournamentInstanceId === undefined
          ? undefined
          : {
              tournamentInstanceId,
            }
        : {
            status: statusFilter,
            ...(tournamentInstanceId === undefined
              ? {}
              : {
                  tournamentInstanceId,
                }),
          },
    orderBy: { submittedAt: "desc" },
    take: limit,
  });
}

export async function getPendingReportSubmissions(
  limit = 25,
  tournamentInstanceId?: number
): Promise<StoredReportSubmission[]> {
  await ensureReportSubmissionTable();

  return prisma.reportSubmission.findMany({
    where: {
      status: "pending",
      ...(tournamentInstanceId === undefined
        ? {}
        : {
            tournamentInstanceId,
          }),
    },
    orderBy: { submittedAt: "desc" },
    take: limit,
  });
}

export async function getLatestPendingReportSubmission(): Promise<StoredReportSubmission | null> {
  await ensureReportSubmissionTable();

  return prisma.reportSubmission.findFirst({
    where: { status: "pending" },
    orderBy: { submittedAt: "desc" },
  });
}

export async function listInformationalReportsForTeam(
  tournamentInstanceId: number,
  teamId: number,
  cycleNumber?: number
): Promise<StoredReportSubmission[]> {
  await ensureReportSubmissionTable();

  return prisma.reportSubmission.findMany({
    where: {
      tournamentInstanceId,
      teamId,
      ...(cycleNumber === undefined ? {} : { cycleNumber }),
    },
    orderBy: { submittedAt: "desc" },
  });
}

export async function getReportSubmissionById(
  id: number,
  db: PrismaDbClient = prisma
): Promise<StoredReportSubmission | null> {
  await ensureReportSubmissionTable();

  return db.reportSubmission.findUnique({
    where: { id },
  });
}

export async function updateReportSubmissionStatus(
  id: number,
  status: "reviewed" | "dismissed",
  db: PrismaDbClient = prisma
): Promise<void> {
  await ensureReportSubmissionTable();

  await db.reportSubmission.update({
    where: { id },
    data: { status },
  });
}

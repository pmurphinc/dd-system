import { PrismaDbClient, prisma } from "./prisma";

export interface ReportSubmissionInput {
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
  | "approved"
  | "rejected";

let reportSubmissionTableReady: Promise<void> | undefined;

async function ensureReportSubmissionTable(): Promise<void> {
  reportSubmissionTableReady ??= Promise.resolve()
    .then(async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ReportSubmission" (
          "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    });

  await reportSubmissionTableReady;
}

export async function createReportSubmission(
  input: ReportSubmissionInput
): Promise<void> {
  await ensureReportSubmissionTable();

  await prisma.reportSubmission.create({
    data: {
      ...input,
      status: "pending",
      submittedAt: new Date(),
    },
  });
}

export async function hasPendingReportSubmissionForAssignment(
  matchAssignmentId: number
): Promise<boolean> {
  await ensureReportSubmissionTable();

  const pendingReportCount = await prisma.reportSubmission.count({
    where: {
      matchAssignmentId,
      status: "pending",
    },
  });

  return pendingReportCount > 0;
}

export async function getRecentReportSubmissions(
  limit = 5,
  statusFilter: ReportSubmissionStatusFilter = "all"
): Promise<StoredReportSubmission[]> {
  await ensureReportSubmissionTable();

  return prisma.reportSubmission.findMany({
    where:
      statusFilter === "all"
        ? undefined
        : {
            status: statusFilter,
          },
    orderBy: { submittedAt: "desc" },
    take: limit,
  });
}

export async function getPendingReportSubmissions(
  limit = 25
): Promise<StoredReportSubmission[]> {
  await ensureReportSubmissionTable();

  return prisma.reportSubmission.findMany({
    where: { status: "pending" },
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
  status: "approved" | "rejected",
  db: PrismaDbClient = prisma
): Promise<void> {
  await ensureReportSubmissionTable();

  await db.reportSubmission.update({
    where: { id },
    data: { status },
  });
}

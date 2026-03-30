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

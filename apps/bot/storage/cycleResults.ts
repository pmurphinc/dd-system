import { Prisma } from "@prisma/client";
import { PrismaDbClient, prisma } from "./prisma";
import { StoredReportSubmission } from "./reportSubmissions";
import { getFrpAwardByScore } from "./standings";

export interface StoredCycleResult {
  id: number;
  cycleNumber: number;
  matchAssignmentId: number;
  reportSubmissionId: number;
  teamName: string;
  opponentTeamName: string;
  score: string;
  frpAwardedToTeam: number;
  frpAwardedToOpponent: number;
  recordedAt: Date;
}

export interface CycleResultDuplicateGroup {
  key: "matchAssignmentId" | "reportSubmissionId";
  value: number;
  rows: StoredCycleResult[];
}

export interface CycleResultDuplicateComponent {
  canonicalRow: StoredCycleResult;
  rows: StoredCycleResult[];
  isRepairable: boolean;
  reason?: string;
}

export interface CycleResultDuplicateAuditReport {
  hasDuplicates: boolean;
  duplicateAssignmentGroups: CycleResultDuplicateGroup[];
  duplicateReportSubmissionGroups: CycleResultDuplicateGroup[];
  components: CycleResultDuplicateComponent[];
}

export interface CycleResultDuplicateRepairAction {
  canonicalRow: StoredCycleResult;
  removedRows: StoredCycleResult[];
  selectionReason: string;
}

export interface CycleResultDuplicateRepairResult {
  audit: CycleResultDuplicateAuditReport;
  deletedRowIds: number[];
  repairedComponents: CycleResultDuplicateRepairAction[];
  skippedComponents: CycleResultDuplicateComponent[];
}

let cycleResultTableReady: Promise<void> | undefined;

function mapStoredCycleResult(record: StoredCycleResult): StoredCycleResult {
  return {
    id: record.id,
    cycleNumber: record.cycleNumber,
    matchAssignmentId: record.matchAssignmentId,
    reportSubmissionId: record.reportSubmissionId,
    teamName: record.teamName,
    opponentTeamName: record.opponentTeamName,
    score: record.score,
    frpAwardedToTeam: record.frpAwardedToTeam,
    frpAwardedToOpponent: record.frpAwardedToOpponent,
    recordedAt: new Date(record.recordedAt),
  };
}

async function ensureCycleResultTableExists(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CycleResult" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "cycleNumber" INTEGER NOT NULL,
      "matchAssignmentId" INTEGER NOT NULL,
      "reportSubmissionId" INTEGER NOT NULL,
      "teamName" TEXT NOT NULL,
      "opponentTeamName" TEXT NOT NULL,
      "score" TEXT NOT NULL,
      "frpAwardedToTeam" INTEGER NOT NULL,
      "frpAwardedToOpponent" INTEGER NOT NULL,
      "recordedAt" DATETIME NOT NULL
    )
  `);
}

function sortCanonicalRows(rows: StoredCycleResult[]): StoredCycleResult[] {
  return [...rows].sort((left, right) => {
    const recordedAtDelta =
      left.recordedAt.getTime() - right.recordedAt.getTime();

    if (recordedAtDelta !== 0) {
      return recordedAtDelta;
    }

    return left.id - right.id;
  });
}

function buildDuplicateGroups(
  rows: StoredCycleResult[],
  key: "matchAssignmentId" | "reportSubmissionId"
): CycleResultDuplicateGroup[] {
  const groupsByValue = new Map<number, StoredCycleResult[]>();

  for (const row of rows) {
    const currentRows = groupsByValue.get(row[key]) ?? [];
    currentRows.push(row);
    groupsByValue.set(row[key], currentRows);
  }

  return Array.from(groupsByValue.entries())
    .filter(([, groupRows]) => groupRows.length > 1)
    .map(([value, groupRows]) => ({
      key,
      value,
      rows: sortCanonicalRows(groupRows),
    }))
    .sort((left, right) => left.value - right.value);
}

function buildDuplicateComponents(
  rows: StoredCycleResult[],
  assignmentGroups: CycleResultDuplicateGroup[],
  reportGroups: CycleResultDuplicateGroup[]
): CycleResultDuplicateComponent[] {
  const duplicateRowIds = new Set<number>();

  for (const group of [...assignmentGroups, ...reportGroups]) {
    for (const row of group.rows) {
      duplicateRowIds.add(row.id);
    }
  }

  const rowMap = new Map(rows.map((row) => [row.id, row]));
  const adjacency = new Map<number, Set<number>>();

  for (const rowId of duplicateRowIds) {
    adjacency.set(rowId, new Set<number>());
  }

  for (const group of [...assignmentGroups, ...reportGroups]) {
    for (const row of group.rows) {
      const neighbors = adjacency.get(row.id);

      if (!neighbors) {
        continue;
      }

      for (const neighbor of group.rows) {
        if (neighbor.id !== row.id) {
          neighbors.add(neighbor.id);
        }
      }
    }
  }

  const visitedRowIds = new Set<number>();
  const components: CycleResultDuplicateComponent[] = [];

  for (const rowId of duplicateRowIds) {
    if (visitedRowIds.has(rowId)) {
      continue;
    }

    const pendingRowIds = [rowId];
    const componentRows: StoredCycleResult[] = [];

    while (pendingRowIds.length > 0) {
      const currentRowId = pendingRowIds.pop();

      if (currentRowId === undefined || visitedRowIds.has(currentRowId)) {
        continue;
      }

      visitedRowIds.add(currentRowId);
      const row = rowMap.get(currentRowId);

      if (row) {
        componentRows.push(row);
      }

      for (const neighborRowId of adjacency.get(currentRowId) ?? []) {
        if (!visitedRowIds.has(neighborRowId)) {
          pendingRowIds.push(neighborRowId);
        }
      }
    }

    const orderedRows = sortCanonicalRows(componentRows);
    const assignmentIds = new Set(orderedRows.map((row) => row.matchAssignmentId));
    const reportSubmissionIds = new Set(
      orderedRows.map((row) => row.reportSubmissionId)
    );
    const isRepairable =
      assignmentIds.size === 1 || reportSubmissionIds.size === 1;

    components.push({
      canonicalRow: orderedRows[0],
      rows: orderedRows,
      isRepairable,
      reason: isRepairable
        ? undefined
        : "Component spans multiple assignments and report submissions.",
    });
  }

  return components.sort((left, right) => left.canonicalRow.id - right.canonicalRow.id);
}

export async function scanCycleResultDuplicates(): Promise<CycleResultDuplicateAuditReport> {
  await ensureCycleResultTableExists();

  const rows = (await prisma.cycleResult.findMany({
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
  })) as StoredCycleResult[];

  const normalizedRows = rows.map(mapStoredCycleResult);
  const duplicateAssignmentGroups = buildDuplicateGroups(
    normalizedRows,
    "matchAssignmentId"
  );
  const duplicateReportSubmissionGroups = buildDuplicateGroups(
    normalizedRows,
    "reportSubmissionId"
  );
  const components = buildDuplicateComponents(
    normalizedRows,
    duplicateAssignmentGroups,
    duplicateReportSubmissionGroups
  );

  return {
    hasDuplicates:
      duplicateAssignmentGroups.length > 0 ||
      duplicateReportSubmissionGroups.length > 0,
    duplicateAssignmentGroups,
    duplicateReportSubmissionGroups,
    components,
  };
}

async function ensureCycleResultTable(): Promise<void> {
  cycleResultTableReady ??= Promise.resolve().then(async () => {
    await ensureCycleResultTableExists();

    const duplicateAudit = await scanCycleResultDuplicates();

    if (duplicateAudit.hasDuplicates) {
      throw new Error(
        "CycleResult contains duplicate rows that must be cleaned before unique constraints can be enforced."
      );
    }

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "CycleResult_matchAssignmentId_key"
      ON "CycleResult" ("matchAssignmentId")
    `);

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "CycleResult_reportSubmissionId_key"
      ON "CycleResult" ("reportSubmissionId")
    `);
  });

  await cycleResultTableReady;
}

export async function repairCycleResultDuplicates(): Promise<CycleResultDuplicateRepairResult> {
  const audit = await scanCycleResultDuplicates();

  if (!audit.hasDuplicates) {
    return {
      audit,
      deletedRowIds: [],
      repairedComponents: [],
      skippedComponents: [],
    };
  }

  const repairedComponents: CycleResultDuplicateRepairAction[] = [];
  const skippedComponents = audit.components.filter(
    (component) => !component.isRepairable
  );
  const deletedRowIds = new Set<number>();

  for (const component of audit.components) {
    if (!component.isRepairable) {
      continue;
    }

    const canonicalRow = component.canonicalRow;
    const removedRows = component.rows.slice(1);

    if (removedRows.length === 0) {
      continue;
    }

    await prisma.cycleResult.deleteMany({
      where: {
        id: {
          in: removedRows.map((row) => row.id),
        },
      },
    });

    removedRows.forEach((row) => deletedRowIds.add(row.id));
    repairedComponents.push({
      canonicalRow,
      removedRows,
      selectionReason:
        "Kept the earliest recorded row by recordedAt, breaking ties by lowest id.",
    });
  }

  cycleResultTableReady = undefined;

  const postRepairAudit = await scanCycleResultDuplicates();

  if (!postRepairAudit.hasDuplicates) {
    await ensureCycleResultTable();
  }

  return {
    audit: postRepairAudit,
    deletedRowIds: Array.from(deletedRowIds).sort((left, right) => left - right),
    repairedComponents,
    skippedComponents,
  };
}

export async function recordApprovedCycleResult(
  reportSubmission: StoredReportSubmission,
  db: PrismaDbClient = prisma
): Promise<StoredCycleResult | null> {
  await ensureCycleResultTable();

  const existingCycleResult = await db.cycleResult.findFirst({
    where: {
      OR: [
        { matchAssignmentId: reportSubmission.matchAssignmentId },
        { reportSubmissionId: reportSubmission.id },
      ],
    },
    orderBy: { id: "asc" },
  });

  if (existingCycleResult) {
    return existingCycleResult;
  }

  const frpAward = getFrpAwardByScore(reportSubmission.score);

  if (!frpAward) {
    return null;
  }

  try {
    return await db.cycleResult.create({
      data: {
        cycleNumber: reportSubmission.cycleNumber,
        matchAssignmentId: reportSubmission.matchAssignmentId,
        reportSubmissionId: reportSubmission.id,
        teamName: reportSubmission.teamName,
        opponentTeamName: reportSubmission.opponentTeamName,
        score: reportSubmission.score,
        frpAwardedToTeam: frpAward.reportingTeam,
        frpAwardedToOpponent: frpAward.opponentTeam,
        recordedAt: new Date(),
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return db.cycleResult.findFirst({
        where: {
          OR: [
            { matchAssignmentId: reportSubmission.matchAssignmentId },
            { reportSubmissionId: reportSubmission.id },
          ],
        },
        orderBy: { id: "asc" },
      });
    }

    throw error;
  }
}

export async function getRecentCycleResults(
  limit = 5
): Promise<StoredCycleResult[]> {
  await ensureCycleResultTable();

  return prisma.cycleResult.findMany({
    orderBy: { recordedAt: "desc" },
    take: limit,
  });
}

export async function getCycleResultsForCycle(
  cycle: number,
  db: PrismaDbClient = prisma
): Promise<StoredCycleResult[]> {
  await ensureCycleResultTable();

  return db.cycleResult.findMany({
    where: { cycleNumber: cycle },
    orderBy: [{ matchAssignmentId: "asc" }, { recordedAt: "asc" }],
  });
}

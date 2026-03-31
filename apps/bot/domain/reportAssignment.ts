import { GuildMemberRoleManager } from "discord.js";
import { PrismaDbClient, prisma } from "../storage/prisma";
import { getTeamForUser } from "../storage/teams";
import { getTournamentState, updateTournamentActiveMatch } from "./tournamentState";

export interface ReportAssignment {
  id: number;
  teamName: string;
  opponentTeamName: string;
  cycleNumber: number;
  stageName: string;
}

let matchAssignmentTableReady: Promise<void> | undefined;

async function ensureMatchAssignmentTable(): Promise<void> {
  matchAssignmentTableReady ??= Promise.resolve().then(async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MatchAssignment" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "teamName" TEXT NOT NULL,
        "opponentTeamName" TEXT NOT NULL,
        "cycleNumber" INTEGER NOT NULL,
        "stageName" TEXT NOT NULL
      )
    `);
  });

  await matchAssignmentTableReady;
}

function mapMatchAssignment(record: {
  id: number;
  teamName: string;
  opponentTeamName: string;
  cycleNumber: number;
  stageName: string;
}): ReportAssignment {
  return {
    id: record.id,
    teamName: record.teamName,
    opponentTeamName: record.opponentTeamName,
    cycleNumber: record.cycleNumber,
    stageName: record.stageName,
  };
}

async function listAssignmentsForStage(
  cycleNumber: number,
  stageName: string,
  db: PrismaDbClient = prisma
): Promise<ReportAssignment[]> {
  await ensureMatchAssignmentTable();

  const rows = await db.matchAssignment.findMany({
    where: {
      cycleNumber,
      stageName,
    },
    orderBy: [{ id: "asc" }],
  });

  return rows.map(mapMatchAssignment);
}

export async function ensureAssignmentsForStage(
  cycleNumber: number,
  stageName: string,
  pairs: Array<[string, string]>,
  db: PrismaDbClient = prisma
): Promise<ReportAssignment[]> {
  await ensureMatchAssignmentTable();

  const existing = await listAssignmentsForStage(cycleNumber, stageName, db);

  if (existing.length > 0) {
    return existing;
  }

  if (pairs.length === 0) {
    return [];
  }

  await db.matchAssignment.createMany({
    data: pairs.map(([teamName, opponentTeamName]) => ({
      teamName,
      opponentTeamName,
      cycleNumber,
      stageName,
    })),
  });

  const created = await listAssignmentsForStage(cycleNumber, stageName, db);
  await updateTournamentActiveMatch(
    created.length > 0
      ? created.map((assignment) => `${assignment.teamName} vs ${assignment.opponentTeamName}`).join("\n")
      : "No active match"
  );

  return created;
}

export async function replaceAssignmentsForStage(
  cycleNumber: number,
  stageName: string,
  pairs: Array<[string, string]>,
  db: PrismaDbClient = prisma
): Promise<ReportAssignment[]> {
  await ensureMatchAssignmentTable();

  await db.matchAssignment.deleteMany({
    where: {
      cycleNumber,
      stageName,
    },
  });

  if (pairs.length > 0) {
    await db.matchAssignment.createMany({
      data: pairs.map(([teamName, opponentTeamName]) => ({
        teamName,
        opponentTeamName,
        cycleNumber,
        stageName,
      })),
    });
  }

  const assignments = await listAssignmentsForStage(cycleNumber, stageName, db);
  await updateTournamentActiveMatch(
    assignments.length > 0
      ? assignments
          .map((assignment) => `${assignment.teamName} vs ${assignment.opponentTeamName}`)
          .join("\n")
      : "No active match"
  );

  return assignments;
}

export async function getReportAssignment(
  reportingUserKey: string,
  memberRoles?: GuildMemberRoleManager
): Promise<ReportAssignment> {
  await ensureMatchAssignmentTable();

  const tournamentState = await getTournamentState();
  const team = await getTeamForUser(reportingUserKey, memberRoles);

  if (!team || tournamentState.currentCycle === null) {
    return {
      id: 0,
      teamName: team?.teamName ?? "No team linked",
      opponentTeamName: "No assignment",
      cycleNumber: tournamentState.currentCycle ?? 0,
      stageName: tournamentState.currentStage,
    };
  }

  const assignment = await prisma.matchAssignment.findFirst({
    where: {
      cycleNumber: tournamentState.currentCycle,
      stageName: tournamentState.currentStage,
      OR: [
        { teamName: team.teamName },
        { opponentTeamName: team.teamName },
      ],
    },
    orderBy: { id: "asc" },
  });

  if (!assignment) {
    return {
      id: 0,
      teamName: team.teamName,
      opponentTeamName: "No assignment",
      cycleNumber: tournamentState.currentCycle,
      stageName: tournamentState.currentStage,
    };
  }

  return assignment.teamName === team.teamName
    ? mapMatchAssignment(assignment)
    : {
        id: assignment.id,
        teamName: team.teamName,
        opponentTeamName: assignment.teamName,
        cycleNumber: assignment.cycleNumber,
        stageName: assignment.stageName,
      };
}

export async function getMatchAssignmentsForCycle(
  cycle: number,
  db: PrismaDbClient = prisma
): Promise<ReportAssignment[]> {
  await ensureMatchAssignmentTable();

  const rows = await db.matchAssignment.findMany({
    where: { cycleNumber: cycle },
    orderBy: [{ stageName: "asc" }, { id: "asc" }],
  });

  return rows.map(mapMatchAssignment);
}

export async function getMatchAssignmentsForCurrentStage(): Promise<ReportAssignment[]> {
  const tournamentState = await getTournamentState();

  if (tournamentState.currentCycle === null) {
    return [];
  }

  return listAssignmentsForStage(
    tournamentState.currentCycle,
    tournamentState.currentStage
  );
}

export async function getMatchAssignmentById(
  id: number
): Promise<ReportAssignment | null> {
  await ensureMatchAssignmentTable();

  const assignment = await prisma.matchAssignment.findUnique({
    where: { id },
  });

  return assignment ? mapMatchAssignment(assignment) : null;
}

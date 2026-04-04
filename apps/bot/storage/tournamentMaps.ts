import { TournamentStage } from "@prisma/client";
import { prisma } from "./prisma";
import { listImportedTeamsForTournamentInstance } from "./teams";
import { listMatchAssignmentsForTournamentInstance } from "./matchAssignments";

export const OFFICIAL_MAP_POOL = [
  "FANGWAI CITY",
  "NOZOMI/CITADEL",
  "LAS VEGAS STADIUM",
  "BERNAL",
  "FORTUNE STADIUM",
  "SYS$HORIZON",
  "LAS VEGAS",
  "SKYWAY STADIUM",
  "SEOUL",
  "MONACO",
] as const;

function normalizeMapKey(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

export function normalizeMapBan(rawValue: string | null | undefined): string | null {
  if (!rawValue?.trim()) return null;
  const normalizedInput = normalizeMapKey(rawValue);
  const match = OFFICIAL_MAP_POOL.find((map) => normalizeMapKey(map) === normalizedInput);
  return match ?? null;
}

function pickRandomMap(availableMaps: string[]): string {
  const index = Math.floor(Math.random() * availableMaps.length);
  return availableMaps[index]!;
}

function buildPoolExcludingBans(bans: Array<string | null | undefined>): string[] {
  const uniqueBans = new Set(
    bans
      .map((ban) => normalizeMapBan(ban))
      .filter((ban): ban is string => Boolean(ban))
      .map((ban) => normalizeMapKey(ban))
  );

  return OFFICIAL_MAP_POOL.filter((map) => !uniqueBans.has(normalizeMapKey(map)));
}

let mapColumnsReady: Promise<void> | undefined;

async function ensureMapColumns(): Promise<void> {
  mapColumnsReady ??= Promise.resolve().then(async () => {
    const cashoutColumns = (await prisma.$queryRawUnsafe(
      `PRAGMA table_info("CashoutPlacement")`
    )) as Array<{ name: string }>;
    if (!cashoutColumns.some((column) => column.name === "assignedMap")) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CashoutPlacement" ADD COLUMN "assignedMap" TEXT`
      );
    }

    const teamColumns = (await prisma.$queryRawUnsafe(
      `PRAGMA table_info("Team")`
    )) as Array<{ name: string }>;
    if (!teamColumns.some((column) => column.name === "mapBan")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Team" ADD COLUMN "mapBan" TEXT`);
    }
  });

  await mapColumnsReady;
}

export async function assignCashoutMapForCycleIfMissing(
  tournamentInstanceId: number,
  cycleNumber: number
): Promise<string> {
  await ensureMapColumns();
  const placement = await prisma.cashoutPlacement.findUnique({
    where: {
      tournamentInstanceId_cycleNumber: {
        tournamentInstanceId,
        cycleNumber,
      },
    },
  });

  if (!placement) {
    throw new Error("Cashout placement row is missing for this cycle; cannot store assigned map.");
  }

  if (placement.assignedMap?.trim()) {
    return placement.assignedMap;
  }

  const teams = await listImportedTeamsForTournamentInstance(tournamentInstanceId);
  if (teams.length !== 4) {
    throw new Error("Cashout map assignment requires exactly 4 teams in the tournament instance.");
  }

  const missingBanTeams = teams.filter((team) => !normalizeMapBan(team.mapBan));
  if (missingBanTeams.length > 0) {
    throw new Error(
      `Cannot assign cashout map. Missing/invalid team bans: ${missingBanTeams
        .map((team) => team.teamName)
        .join(", ")}.`
    );
  }

  const availableMaps = buildPoolExcludingBans(teams.map((team) => team.mapBan));
  if (availableMaps.length === 0) {
    throw new Error(
      "No maps remain after excluding team map bans for cashout. Admin override required."
    );
  }

  const assignedMap = pickRandomMap(availableMaps);

  await prisma.cashoutPlacement.update({
    where: { id: placement.id },
    data: {
      assignedMap,
      updatedAt: new Date(),
    },
  });

  return assignedMap;
}

export async function getCashoutAssignedMapForCycle(
  tournamentInstanceId: number,
  cycleNumber: number
): Promise<string | null> {
  await ensureMapColumns();
  const placement = await prisma.cashoutPlacement.findUnique({
    where: {
      tournamentInstanceId_cycleNumber: {
        tournamentInstanceId,
        cycleNumber,
      },
    },
  });

  return placement?.assignedMap ?? null;
}

export async function assignFinalRoundMapsIfMissing(
  tournamentInstanceId: number,
  cycleNumber: number
): Promise<void> {
  await ensureMapColumns();
  const assignments = await listMatchAssignmentsForTournamentInstance(
    tournamentInstanceId,
    cycleNumber,
    TournamentStage.FINAL_ROUND
  );

  if (assignments.length === 0) {
    return;
  }

  const teams = await listImportedTeamsForTournamentInstance(tournamentInstanceId);
  const teamById = new Map(teams.map((team) => [team.id, team]));

  for (const assignment of assignments) {
    const current = await prisma.matchAssignment.findUnique({ where: { id: assignment.id } });

    if (!current || current.assignedMap?.trim()) {
      continue;
    }

    if (assignment.teamId === null || assignment.opponentTeamId === null) {
      throw new Error("Cannot assign final round map: matchup is missing team linkage.");
    }

    const team = teamById.get(assignment.teamId);
    const opponent = teamById.get(assignment.opponentTeamId);

    const teamBan = normalizeMapBan(team?.mapBan);
    const opponentBan = normalizeMapBan(opponent?.mapBan);

    if (!teamBan || !opponentBan) {
      throw new Error(
        `Cannot assign final round map for ${assignment.teamName} vs ${assignment.opponentTeamName}: missing/invalid team bans.`
      );
    }

    const availableMaps = buildPoolExcludingBans([teamBan, opponentBan]);
    if (availableMaps.length === 0) {
      throw new Error(
        `No maps remain for ${assignment.teamName} vs ${assignment.opponentTeamName} after bans. Admin override required.`
      );
    }

    await prisma.matchAssignment.update({
      where: { id: assignment.id },
      data: { assignedMap: pickRandomMap(availableMaps) },
    });
  }
}

export async function getAssignedMapForTeamCurrentStage(
  tournamentInstanceId: number,
  teamId: number,
  cycleNumber: number,
  stageName: TournamentStage
): Promise<string | null> {
  await ensureMapColumns();
  if (stageName === TournamentStage.CASHOUT) {
    return getCashoutAssignedMapForCycle(tournamentInstanceId, cycleNumber);
  }

  if (stageName === TournamentStage.FINAL_ROUND) {
    const assignment = await prisma.matchAssignment.findFirst({
      where: {
        tournamentInstanceId,
        cycleNumber,
        stageName: TournamentStage.FINAL_ROUND,
        OR: [{ teamId }, { opponentTeamId: teamId }],
      },
      orderBy: { id: "asc" },
    });

    return assignment?.assignedMap ?? null;
  }

  return null;
}

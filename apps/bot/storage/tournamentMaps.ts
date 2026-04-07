import { Prisma, TournamentStage } from "@prisma/client";
import { prisma } from "./prisma";
import { listMatchAssignmentsForTournamentInstance } from "./matchAssignments";
import { listImportedTeamsForTournamentInstance } from "./teams";

export const OFFICIAL_MAP_POOL = [
  "FANGWAI CITY",
  "NOZOMI CITADEL",
  "LAS VEGAS STADIUM",
  "BERNAL",
  "FORTUNE STADIUM",
  "SYS$HORIZON",
  "LAS VEGAS",
  "SKYWAY STADIUM",
  "SEOUL",
  "MONACO",
] as const;

type MapAssignmentStatus =
  | "assigned_new"
  | "already_assigned"
  | "no_legal_maps"
  | "stage_not_applicable";

export interface EnsureStageMapAssignedResult {
  status: MapAssignmentStatus;
  assignedMap: string | null;
  bannedMaps: string[];
  legalMaps: string[];
  reason?: string;
}

function normalizeMapKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ");
}

const MAP_BAN_ALIASES: Record<string, (typeof OFFICIAL_MAP_POOL)[number]> = {
  "NOZOMI/CITADEL": "NOZOMI CITADEL",
};

export function normalizeMapBan(rawValue: string | null | undefined): string | null {
  if (!rawValue?.trim()) return null;
  const normalizedInput = normalizeMapKey(rawValue);
  const aliasMatch = MAP_BAN_ALIASES[normalizedInput];
  if (aliasMatch) {
    return aliasMatch;
  }

  const canonicalMatch = OFFICIAL_MAP_POOL.find(
    (map) => normalizeMapKey(map) === normalizedInput
  );
  return canonicalMatch ?? null;
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
    if (!cashoutColumns.some((column) => column.name === "isOfficial")) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CashoutPlacement" ADD COLUMN "isOfficial" BOOLEAN NOT NULL DEFAULT 0`
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
  const result = await ensureStageMapAssigned({
    tournamentInstanceId,
    cycleNumber,
    stage: TournamentStage.CASHOUT,
  });

  if (result.status === "assigned_new" || result.status === "already_assigned") {
    return result.assignedMap!;
  }

  if (result.reason === "missing_or_invalid_bans") {
    throw new Error(
      "Cannot assign cashout map. Missing/invalid team bans prevent legal map selection."
    );
  }

  throw new Error("No maps remain after excluding team map bans for cashout. Admin override required.");
}

interface EnsureStageMapAssignedInput {
  tournamentInstanceId: number;
  cycleNumber: number;
  stage: TournamentStage;
  tx?: Prisma.TransactionClient;
}

export async function ensureStageMapAssigned(
  input: EnsureStageMapAssignedInput
): Promise<EnsureStageMapAssignedResult> {
  const { tournamentInstanceId, cycleNumber, stage, tx } = input;
  if (stage !== TournamentStage.CASHOUT) {
    return {
      status: "stage_not_applicable",
      assignedMap: null,
      bannedMaps: [],
      legalMaps: [],
    };
  }

  await ensureMapColumns();
  const db = tx ?? prisma;
  const context = `instance=${tournamentInstanceId} cycle=${cycleNumber} stage=${stage}`;
  console.log(`[stage-map-ensure] start ${context}`);

  let placement = await db.cashoutPlacement.findUnique({
    where: {
      tournamentInstanceId_cycleNumber: {
        tournamentInstanceId,
        cycleNumber,
      },
    },
  });

  if (!placement) {
    const teams = await db.team.findMany({
      where: { tournamentInstanceId },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (teams.length !== 4) {
      throw new Error("Cashout map assignment requires exactly 4 teams in the tournament instance.");
    }

    const now = new Date();
    await db.cashoutPlacement.upsert({
      where: {
        tournamentInstanceId_cycleNumber: {
          tournamentInstanceId,
          cycleNumber,
        },
      },
      update: {
        updatedAt: now,
      },
      create: {
        tournamentInstanceId,
        cycleNumber,
        isOfficial: false,
        firstPlaceTeamId: teams[0]!.id,
        secondPlaceTeamId: teams[1]!.id,
        thirdPlaceTeamId: teams[2]!.id,
        fourthPlaceTeamId: teams[3]!.id,
        createdAt: now,
        updatedAt: now,
      },
    });
    placement = await db.cashoutPlacement.findUnique({
      where: {
        tournamentInstanceId_cycleNumber: {
          tournamentInstanceId,
          cycleNumber,
        },
      },
    });
  }

  if (!placement) {
    throw new Error("Failed to initialize cashout placement row for this cycle.");
  }

  if (placement.assignedMap?.trim()) {
    console.log(`[stage-map-ensure] already_assigned ${context} map=${placement.assignedMap}`);
    return {
      status: "already_assigned",
      assignedMap: placement.assignedMap,
      bannedMaps: [],
      legalMaps: [],
    };
  }

  const teams = await db.team.findMany({
    where: { tournamentInstanceId },
    orderBy: { id: "asc" },
    select: { teamName: true, mapBan: true },
  });

  const normalizedBans = teams.map((team) => normalizeMapBan(team.mapBan));
  const missingBanTeams = teams.filter((_, index) => !normalizedBans[index]);
  const bannedMaps = normalizedBans.filter((ban): ban is string => Boolean(ban));
  const legalMaps = buildPoolExcludingBans(bannedMaps);
  console.log(
    `[stage-map-ensure] bans ${context} banned=[${bannedMaps.join(", ")}] legal=[${legalMaps.join(
      ", "
    )}]`
  );

  if (missingBanTeams.length > 0 || legalMaps.length === 0) {
    const reason =
      missingBanTeams.length > 0 ? "missing_or_invalid_bans" : "no_legal_maps_after_bans";
    console.warn(
      `[stage-map-ensure] no_legal_maps ${context} reason=${reason} missingTeams=${missingBanTeams
        .map((team) => team.teamName)
        .join(",")}`
    );
    return {
      status: "no_legal_maps",
      assignedMap: null,
      bannedMaps,
      legalMaps,
      reason,
    };
  }

  const pickedMap = pickRandomMap(legalMaps);
  const updated = await db.cashoutPlacement.updateMany({
    where: {
      id: placement.id,
      OR: [{ assignedMap: null }, { assignedMap: "" }],
    },
    data: {
      assignedMap: pickedMap,
      updatedAt: new Date(),
    },
  });

  if (updated.count === 0) {
    const current = await db.cashoutPlacement.findUnique({
      where: { id: placement.id },
    });
    console.log(
      `[stage-map-ensure] already_assigned_race ${context} map=${current?.assignedMap ?? "<none>"}`
    );
    return {
      status: "already_assigned",
      assignedMap: current?.assignedMap ?? null,
      bannedMaps,
      legalMaps,
    };
  }

  console.log(`[stage-map-ensure] assigned_new ${context} map=${pickedMap}`);
  return {
    status: "assigned_new",
    assignedMap: pickedMap,
    bannedMaps,
    legalMaps,
  };
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
    throw new Error(
      `No Final Round assignments found for cycle ${cycleNumber}. Approve cashout stage before starting Final Round.`
    );
  }

  if (assignments.length !== 2) {
    throw new Error(
      `Expected exactly 2 Final Round assignments for cycle ${cycleNumber}, found ${assignments.length}.`
    );
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

    const assignedMap = pickRandomMap(availableMaps);
    await prisma.matchAssignment.update({
      where: { id: assignment.id },
      data: { assignedMap },
    });
    console.log(
      `[final-round-map-assign] assignment=${assignment.id} teamA=${assignment.teamName} teamB=${assignment.opponentTeamName} map=${assignedMap}`
    );
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

import { prisma } from "./prisma";
import { createAuditLog } from "./auditLog";

export interface CashoutPlacementInput {
  tournamentInstanceId: number;
  cycleNumber: number;
  firstPlaceTeamId: number;
  secondPlaceTeamId: number;
  thirdPlaceTeamId: number;
  fourthPlaceTeamId: number;
  actorDiscordUserId: string;
}

export async function upsertCashoutPlacement(
  input: CashoutPlacementInput
): Promise<void> {
  const columns = (await prisma.$queryRawUnsafe(
    `PRAGMA table_info("CashoutPlacement")`
  )) as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "assignedMap")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "CashoutPlacement" ADD COLUMN "assignedMap" TEXT`
    );
  }

  const teamIds = [
    input.firstPlaceTeamId,
    input.secondPlaceTeamId,
    input.thirdPlaceTeamId,
    input.fourthPlaceTeamId,
  ];

  if (new Set(teamIds).size !== 4) {
    throw new Error("Cashout placements must contain 4 unique teams.");
  }

  const teams = await prisma.team.findMany({
    where: {
      id: {
        in: teamIds,
      },
      tournamentInstanceId: input.tournamentInstanceId,
    },
    orderBy: { teamName: "asc" },
  });

  if (teams.length !== 4) {
    throw new Error("All placed teams must belong to the selected tournament instance.");
  }

  await prisma.cashoutPlacement.upsert({
    where: {
      tournamentInstanceId_cycleNumber: {
        tournamentInstanceId: input.tournamentInstanceId,
        cycleNumber: input.cycleNumber,
      },
    },
    update: {
      firstPlaceTeamId: input.firstPlaceTeamId,
      secondPlaceTeamId: input.secondPlaceTeamId,
      thirdPlaceTeamId: input.thirdPlaceTeamId,
      fourthPlaceTeamId: input.fourthPlaceTeamId,
      updatedAt: new Date(),
    },
    create: {
      tournamentInstanceId: input.tournamentInstanceId,
      cycleNumber: input.cycleNumber,
      firstPlaceTeamId: input.firstPlaceTeamId,
      secondPlaceTeamId: input.secondPlaceTeamId,
      thirdPlaceTeamId: input.thirdPlaceTeamId,
      fourthPlaceTeamId: input.fourthPlaceTeamId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  await prisma.matchAssignment.deleteMany({
    where: {
      tournamentInstanceId: input.tournamentInstanceId,
      cycleNumber: input.cycleNumber,
      stageName: "FINAL_ROUND",
    },
  });

  const firstTeam = teams.find((team: { id: number }) => team.id === input.firstPlaceTeamId);
  const secondTeam = teams.find((team: { id: number }) => team.id === input.secondPlaceTeamId);
  const thirdTeam = teams.find((team: { id: number }) => team.id === input.thirdPlaceTeamId);
  const fourthTeam = teams.find((team: { id: number }) => team.id === input.fourthPlaceTeamId);

  if (!firstTeam || !secondTeam || !thirdTeam || !fourthTeam) {
    throw new Error("Unable to resolve the full set of placed teams.");
  }

  await prisma.matchAssignment.createMany({
    data: [
      {
        tournamentInstanceId: input.tournamentInstanceId,
        teamId: firstTeam.id,
        opponentTeamId: secondTeam.id,
        teamName: firstTeam.teamName,
        opponentTeamName: secondTeam.teamName,
        cycleNumber: input.cycleNumber,
        stageName: "FINAL_ROUND",
        bracketLabel: "1v2",
      },
      {
        tournamentInstanceId: input.tournamentInstanceId,
        teamId: thirdTeam.id,
        opponentTeamId: fourthTeam.id,
        teamName: thirdTeam.teamName,
        opponentTeamName: fourthTeam.teamName,
        cycleNumber: input.cycleNumber,
        stageName: "FINAL_ROUND",
        bracketLabel: "3v4",
      },
    ],
  });

  await createAuditLog({
    action: "cashout_placements_recorded",
    entityType: "tournament_instance",
    entityId: `${input.tournamentInstanceId}`,
    summary: `Recorded cashout placements for cycle ${input.cycleNumber}.`,
    details: `1st ${firstTeam.teamName}, 2nd ${secondTeam.teamName}, 3rd ${thirdTeam.teamName}, 4th ${fourthTeam.teamName}.`,
    actorDiscordUserId: input.actorDiscordUserId,
  });
}

export async function getCashoutPlacementForCycle(
  tournamentInstanceId: number,
  cycleNumber: number
) {
  return prisma.cashoutPlacement.findUnique({
    where: {
      tournamentInstanceId_cycleNumber: {
        tournamentInstanceId,
        cycleNumber,
      },
    },
  });
}

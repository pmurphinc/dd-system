import {
  TournamentInstanceStatus,
  TournamentStage,
} from "@prisma/client";
import { createAuditLog } from "./auditLog";
import { prisma } from "./prisma";
import {
  listImportedTeamsForTournamentInstance,
  setTeamCheckInStatus,
  assignTeamToTournamentInstance,
} from "./teams";
import { pushTournamentWebhookUpdate } from "../services/tournamentWebhook";
import { assignCashoutMapForCycleIfMissing, normalizeMapBan } from "./tournamentMaps";

export interface StoredTournamentInstance {
  id: number;
  guildId: string;
  name: string;
  orgKey: string;
  orgName: string | null;
  displayName: string | null;
  internalKey: string | null;
  podNumber: number | null;
  status: TournamentInstanceStatus;
  currentCycle: number | null;
  currentStage: TournamentStage;
  maxTeams: number;
  isLocked: boolean;
  winningTeamId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

function normalizeInstance(record: StoredTournamentInstance): StoredTournamentInstance {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function getInstanceAuditLabel(instance: StoredTournamentInstance): string {
  return getTournamentInstanceLabel(normalizeInstance(instance));
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getTournamentInstanceLabel(instance: StoredTournamentInstance): string {
  return instance.displayName ?? instance.orgName ?? instance.name;
}

function getCashoutReadyStatus(cycle: number): TournamentInstanceStatus {
  if (cycle === 1) return TournamentInstanceStatus.CYCLE_1_CASHOUT_READY;
  if (cycle === 2) return TournamentInstanceStatus.CYCLE_2_CASHOUT_READY;
  return TournamentInstanceStatus.CYCLE_3_CASHOUT_READY;
}

function getFinalRoundReadyStatus(cycle: number): TournamentInstanceStatus {
  if (cycle === 1) return TournamentInstanceStatus.CYCLE_1_FINAL_ROUND_READY;
  if (cycle === 2) return TournamentInstanceStatus.CYCLE_2_FINAL_ROUND_READY;
  return TournamentInstanceStatus.CYCLE_3_FINAL_ROUND_READY;
}

function getCycleCompleteStatus(cycle: number): TournamentInstanceStatus {
  if (cycle === 1) return TournamentInstanceStatus.CYCLE_1_COMPLETE;
  if (cycle === 2) return TournamentInstanceStatus.CYCLE_2_COMPLETE;
  return TournamentInstanceStatus.CYCLE_3_COMPLETE;
}

export async function syncTournamentInstancesForGuild(
  guildId: string,
  actorDiscordUserId = "system"
): Promise<StoredTournamentInstance[]> {
  void actorDiscordUserId;
  return listTournamentInstancesForGuild(guildId);
}

export async function listTournamentInstancesForGuild(
  guildId: string
): Promise<StoredTournamentInstance[]> {
  const instances = await prisma.tournamentInstance.findMany({
    where: { guildId },
    orderBy: [{ name: "asc" }],
  });

  return instances.map(normalizeInstance);
}

export async function getTournamentInstanceById(
  id: number
): Promise<StoredTournamentInstance | null> {
  const instance = await prisma.tournamentInstance.findUnique({
    where: { id },
  });

  return instance ? normalizeInstance(instance) : null;
}

export async function updateTournamentInstanceMetadata(
  tournamentInstanceId: number,
  input: {
    orgName?: string | null;
    displayName?: string | null;
    internalKey?: string | null;
    podNumber?: number | null;
    isLocked?: boolean;
  },
  actorDiscordUserId: string
): Promise<StoredTournamentInstance> {
  const updated = await prisma.tournamentInstance.update({
    where: { id: tournamentInstanceId },
    data: {
      ...(input.orgName !== undefined ? { orgName: input.orgName || null } : {}),
      ...(input.displayName !== undefined
        ? { displayName: input.displayName || null }
        : {}),
      ...(input.internalKey !== undefined
        ? { internalKey: input.internalKey || null }
        : {}),
      ...(input.podNumber !== undefined ? { podNumber: input.podNumber } : {}),
      ...(input.isLocked !== undefined ? { isLocked: input.isLocked } : {}),
      updatedAt: new Date(),
    },
  });

  await createAuditLog({
    guildId: updated.guildId,
    action: "tournament_instance_metadata_updated",
    entityType: "tournament_instance",
    entityId: `${updated.id}`,
    summary: `Updated metadata for ${getInstanceAuditLabel(updated)}.`,
    actorDiscordUserId,
  });

  return normalizeInstance(updated);
}

export async function createEmptyTournamentInstance(
  guildId: string,
  input: {
    orgName?: string | null;
    displayName?: string | null;
    internalKey?: string | null;
    podNumber?: number | null;
  },
  actorDiscordUserId: string
): Promise<StoredTournamentInstance> {
  const fallbackBase = input.displayName?.trim() || input.orgName?.trim() || "Tournament Instance";
  const internalKey = input.internalKey?.trim() || `${slugify(fallbackBase)}-${Date.now()}`;
  const name = input.displayName?.trim() || input.orgName?.trim() || `Instance ${Date.now()}`;

  const created = await prisma.tournamentInstance.create({
    data: {
      guildId,
      name,
      orgKey: input.orgName?.trim() || "manual",
      orgName: input.orgName?.trim() || null,
      displayName: input.displayName?.trim() || null,
      internalKey,
      podNumber: input.podNumber ?? null,
      status: TournamentInstanceStatus.REGISTRATION_READY,
      currentCycle: null,
      currentStage: TournamentStage.REGISTRATION,
      maxTeams: 4,
      isLocked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  await createAuditLog({
    guildId,
    action: "tournament_instance_created",
    entityType: "tournament_instance",
    entityId: `${created.id}`,
    summary: `Created empty tournament instance ${getInstanceAuditLabel(created)}.`,
    actorDiscordUserId,
  });

  return normalizeInstance(created);
}

export async function deleteEmptyTournamentInstance(
  tournamentInstanceId: number,
  actorDiscordUserId: string
): Promise<void> {
  const [instance, teamCount] = await Promise.all([
    prisma.tournamentInstance.findUnique({ where: { id: tournamentInstanceId } }),
    prisma.team.count({ where: { tournamentInstanceId } }),
  ]);

  if (!instance) {
    throw new Error("Tournament instance not found.");
  }

  if (teamCount > 0) {
    throw new Error("Only empty tournament instances can be deleted.");
  }

  await prisma.tournamentInstance.delete({
    where: { id: tournamentInstanceId },
  });

  await createAuditLog({
    guildId: instance.guildId,
    action: "tournament_instance_deleted",
    entityType: "tournament_instance",
    entityId: `${tournamentInstanceId}`,
    summary: `Deleted empty tournament instance ${getInstanceAuditLabel(instance)}.`,
    actorDiscordUserId,
  });
}

export async function countCheckedInTeamsForInstance(
  tournamentInstanceId: number
): Promise<number> {
  return prisma.team.count({
    where: {
      tournamentInstanceId,
      checkInStatus: "Checked In",
    },
  });
}

export async function openTournamentCheckIn(
  tournamentInstanceId: number,
  actorDiscordUserId: string
): Promise<StoredTournamentInstance> {
  const instance = await prisma.tournamentInstance.update({
    where: { id: tournamentInstanceId },
    data: {
      status: TournamentInstanceStatus.CHECKIN_OPEN,
      currentCycle: 1,
      currentStage: TournamentStage.CHECKIN,
      updatedAt: new Date(),
    },
  });

  await prisma.team.updateMany({
    where: { tournamentInstanceId },
    data: { checkInStatus: "Not Checked In" },
  });

  await createAuditLog({
    guildId: instance.guildId,
    action: "tournament_instance_checkin_opened",
    entityType: "tournament_instance",
    entityId: `${instance.id}`,
    summary: `Opened check-in for ${getInstanceAuditLabel(instance)}.`,
    actorDiscordUserId,
  });

  await pushTournamentWebhookUpdate({
    tournamentInstanceId,
    reason: "checkin_opened",
  });

  return normalizeInstance(instance);
}

export async function closeTournamentCheckIn(
  tournamentInstanceId: number,
  actorDiscordUserId: string
): Promise<StoredTournamentInstance> {
  const instance = await prisma.tournamentInstance.update({
    where: { id: tournamentInstanceId },
    data: {
      status: TournamentInstanceStatus.CHECKIN_LOCKED,
      currentStage: TournamentStage.CHECKIN,
      updatedAt: new Date(),
    },
  });

  await createAuditLog({
    guildId: instance.guildId,
    action: "tournament_instance_checkin_closed",
    entityType: "tournament_instance",
    entityId: `${instance.id}`,
    summary: `Closed check-in for ${getInstanceAuditLabel(instance)}.`,
    actorDiscordUserId,
  });

  await pushTournamentWebhookUpdate({
    tournamentInstanceId,
    reason: "checkin_closed",
  });

  return normalizeInstance(instance);
}

export async function handleTournamentLeaderCheckIn(
  tournamentInstanceId: number,
  teamId: number,
  actorDiscordUserId: string
): Promise<StoredTournamentInstance> {
  const instance = await prisma.tournamentInstance.findUnique({
    where: { id: tournamentInstanceId },
  });

  if (!instance) {
    throw new Error("Tournament instance not found.");
  }

  if (instance.status !== TournamentInstanceStatus.CHECKIN_OPEN) {
    throw new Error("Check-in is not open for this tournament instance.");
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
  });

  if (!team || team.tournamentInstanceId !== tournamentInstanceId) {
    throw new Error("Team does not belong to this tournament instance.");
  }

  if (team.checkInStatus === "Checked In") {
    throw new Error("This team has already checked in.");
  }

  const checkedInTeams = await countCheckedInTeamsForInstance(tournamentInstanceId);

  if (checkedInTeams >= instance.maxTeams) {
    throw new Error("This tournament instance already has 4 checked-in teams.");
  }

  await setTeamCheckInStatus(team.id, "Checked In", actorDiscordUserId);

  const updatedCount = checkedInTeams + 1;
  const nextStatus =
    updatedCount >= instance.maxTeams
      ? getCashoutReadyStatus(1)
      : TournamentInstanceStatus.CHECKIN_OPEN;
  const nextStage =
    updatedCount >= instance.maxTeams ? TournamentStage.CASHOUT : TournamentStage.CHECKIN;

  const updated = await prisma.tournamentInstance.update({
    where: { id: tournamentInstanceId },
    data: {
      status: nextStatus,
      currentCycle: 1,
      currentStage: nextStage,
      updatedAt: new Date(),
    },
  });

  if (nextStage === TournamentStage.CASHOUT) {
    await assignCashoutMapForCycleIfMissing(tournamentInstanceId, 1);
  }

  await pushTournamentWebhookUpdate({
    tournamentInstanceId,
    reason: "leader_checked_in",
  });

  return normalizeInstance(updated);
}

export async function startTournamentCycle(
  tournamentInstanceId: number,
  cycleNumber: number,
  actorDiscordUserId: string
): Promise<StoredTournamentInstance> {
  const instance = await prisma.tournamentInstance.findUnique({
    where: { id: tournamentInstanceId },
  });

  if (!instance) {
    throw new Error("Tournament instance not found.");
  }

  if (cycleNumber < 1 || cycleNumber > 3) {
    throw new Error("Only cycle 1, 2, and 3 are supported.");
  }

  const teams = await listImportedTeamsForTournamentInstance(tournamentInstanceId);
  const checkedInTeams = teams.filter((team) => team.checkInStatus === "Checked In");
  const missingBanTeams = teams.filter((team) => !normalizeMapBan(team.mapBan));

  if (teams.length !== instance.maxTeams) {
    throw new Error("This tournament instance must have exactly 4 teams assigned.");
  }

  if (cycleNumber === 1 && checkedInTeams.length < instance.maxTeams) {
    throw new Error("All 4 teams must check in before Cycle 1 starts.");
  }

  if (missingBanTeams.length > 0) {
    throw new Error(
      `Cannot start cycle. Missing/invalid map bans for: ${missingBanTeams
        .map((team) => team.teamName)
        .join(", ")}.`
    );
  }

  const updated = await prisma.tournamentInstance.update({
    where: { id: tournamentInstanceId },
    data: {
      status: getCashoutReadyStatus(cycleNumber),
      currentCycle: cycleNumber,
      currentStage: TournamentStage.CASHOUT,
      updatedAt: new Date(),
    },
  });

  await createAuditLog({
    guildId: updated.guildId,
    action: "tournament_instance_cycle_started",
    entityType: "tournament_instance",
    entityId: `${updated.id}`,
    summary: `Prepared ${getInstanceAuditLabel(updated)} for cycle ${cycleNumber} cashout.`,
    actorDiscordUserId,
  });

  const cashoutColumns = (await prisma.$queryRawUnsafe(
    `PRAGMA table_info("CashoutPlacement")`
  )) as Array<{ name: string }>;
  if (!cashoutColumns.some((column) => column.name === "isOfficial")) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "CashoutPlacement" ADD COLUMN "isOfficial" BOOLEAN NOT NULL DEFAULT 0`
    );
  }

  await prisma.cashoutPlacement.upsert({
    where: {
      tournamentInstanceId_cycleNumber: {
        tournamentInstanceId,
        cycleNumber,
      },
    },
    update: {
      isOfficial: false,
      updatedAt: new Date(),
    },
    create: {
      tournamentInstanceId,
      cycleNumber,
      isOfficial: false,
      firstPlaceTeamId: teams[0]!.id,
      secondPlaceTeamId: teams[1]!.id,
      thirdPlaceTeamId: teams[2]!.id,
      fourthPlaceTeamId: teams[3]!.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await assignCashoutMapForCycleIfMissing(tournamentInstanceId, cycleNumber);

  await pushTournamentWebhookUpdate({
    tournamentInstanceId,
    reason: `cycle_${cycleNumber}_started`,
  });

  return normalizeInstance(updated);
}

export async function setTournamentInstanceFinalRoundReady(
  tournamentInstanceId: number,
  cycleNumber: number,
  actorDiscordUserId: string
): Promise<StoredTournamentInstance> {
  const instance = await prisma.tournamentInstance.update({
    where: { id: tournamentInstanceId },
    data: {
      status: getFinalRoundReadyStatus(cycleNumber),
      currentCycle: cycleNumber,
      currentStage: TournamentStage.FINAL_ROUND,
      updatedAt: new Date(),
    },
  });

  await createAuditLog({
    guildId: instance.guildId,
    action: "tournament_instance_final_round_ready",
    entityType: "tournament_instance",
    entityId: `${instance.id}`,
    summary: `Final Round ready for ${getInstanceAuditLabel(instance)} cycle ${cycleNumber}.`,
    actorDiscordUserId,
  });

  await pushTournamentWebhookUpdate({
    tournamentInstanceId,
    reason: `cycle_${cycleNumber}_final_round_ready`,
  });

  return normalizeInstance(instance);
}

export async function finalizeTournamentCycle(
  tournamentInstanceId: number,
  actorDiscordUserId: string
): Promise<StoredTournamentInstance> {
  const instance = await prisma.tournamentInstance.findUnique({
    where: { id: tournamentInstanceId },
  });

  if (!instance || instance.currentCycle === null) {
    throw new Error("Tournament instance is not in an active cycle.");
  }

  const assignments = await prisma.matchAssignment.findMany({
    where: {
      tournamentInstanceId,
      cycleNumber: instance.currentCycle,
      stageName: TournamentStage.FINAL_ROUND,
    },
  });

  if (assignments.length !== 2) {
    throw new Error("Both Final Round match assignments must exist before finalizing.");
  }

  const officialResults = await prisma.officialMatchResult.findMany({
    where: {
      tournamentInstanceId,
      cycleNumber: instance.currentCycle,
      status: "active",
    },
  });

  if (officialResults.length !== 2) {
    throw new Error("Both official Final Round results must be entered before finalizing.");
  }

  const updated = await prisma.tournamentInstance.update({
    where: { id: tournamentInstanceId },
    data: {
      status: getCycleCompleteStatus(instance.currentCycle),
      currentStage: TournamentStage.COMPLETE,
      updatedAt: new Date(),
    },
  });

  await createAuditLog({
    guildId: updated.guildId,
    action: "tournament_instance_cycle_finalized",
    entityType: "tournament_instance",
    entityId: `${updated.id}`,
    summary: `Finalized cycle ${updated.currentCycle} for ${getInstanceAuditLabel(updated)}.`,
    actorDiscordUserId,
  });

  await pushTournamentWebhookUpdate({
    tournamentInstanceId,
    reason: "cycle_finalized",
  });

  return normalizeInstance(updated);
}

export async function finishTournamentInstance(
  tournamentInstanceId: number,
  actorDiscordUserId: string
): Promise<StoredTournamentInstance> {
  const instance = await prisma.tournamentInstance.findUnique({
    where: { id: tournamentInstanceId },
  });

  if (!instance) {
    throw new Error("Tournament instance not found.");
  }

  if (instance.currentCycle !== 3) {
    throw new Error("Finish Tournament is only available after cycle 3.");
  }

  const standings = await prisma.standing.findMany({
    where: { tournamentInstanceId },
    orderBy: [{ frp: "desc" }, { teamName: "asc" }],
  });

  if (standings.length === 0) {
    throw new Error("No standings are available for this tournament instance.");
  }

  const highestFrp = standings[0]?.frp ?? 0;
  const tiedTeams = standings.filter((standing: { frp: number }) => standing.frp === highestFrp);
  const status =
    tiedTeams.length > 1
      ? TournamentInstanceStatus.TIEBREAKER_READY
      : TournamentInstanceStatus.COMPLETED;
  const winningTeamId = tiedTeams.length === 1 ? tiedTeams[0].teamId : null;

  const updated = await prisma.tournamentInstance.update({
    where: { id: tournamentInstanceId },
    data: {
      status,
      currentStage:
        status === TournamentInstanceStatus.COMPLETED
          ? TournamentStage.COMPLETE
          : TournamentStage.FINAL_ROUND,
      winningTeamId,
      updatedAt: new Date(),
    },
  });

  await createAuditLog({
    guildId: updated.guildId,
    action: "tournament_instance_finished",
    entityType: "tournament_instance",
    entityId: `${updated.id}`,
    summary:
      status === TournamentInstanceStatus.TIEBREAKER_READY
        ? `${getInstanceAuditLabel(updated)} requires a tiebreaker.`
        : `${getInstanceAuditLabel(updated)} finished with winner team ${winningTeamId}.`,
    actorDiscordUserId,
  });

  await pushTournamentWebhookUpdate({
    tournamentInstanceId,
    reason:
      status === TournamentInstanceStatus.TIEBREAKER_READY
        ? "sudden_death_triggered"
        : "tournament_completed",
  });

  return normalizeInstance(updated);
}

export async function reopenTournamentCheckIn(
  tournamentInstanceId: number,
  actorDiscordUserId: string
): Promise<StoredTournamentInstance> {
  return openTournamentCheckIn(tournamentInstanceId, actorDiscordUserId);
}

export async function reopenTournamentCycle(
  tournamentInstanceId: number,
  cycleNumber: number,
  actorDiscordUserId: string
): Promise<StoredTournamentInstance> {
  const updated = await prisma.tournamentInstance.update({
    where: { id: tournamentInstanceId },
    data: {
      currentCycle: cycleNumber,
      currentStage: TournamentStage.FINAL_ROUND,
      status: getFinalRoundReadyStatus(cycleNumber),
      updatedAt: new Date(),
    },
  });

  await createAuditLog({
    guildId: updated.guildId,
    action: "tournament_instance_cycle_reopened",
    entityType: "tournament_instance",
    entityId: `${updated.id}`,
    summary: `Reopened ${getInstanceAuditLabel(updated)} cycle ${cycleNumber}.`,
    actorDiscordUserId,
  });

  await pushTournamentWebhookUpdate({
    tournamentInstanceId,
    reason: `cycle_${cycleNumber}_reopened`,
  });

  return normalizeInstance(updated);
}

export async function resetTournamentInstance(
  tournamentInstanceId: number,
  actorDiscordUserId: string
): Promise<StoredTournamentInstance> {
  const instance = await prisma.tournamentInstance.findUnique({
    where: { id: tournamentInstanceId },
  });

  if (!instance) {
    throw new Error("Tournament instance not found.");
  }

  await prisma.$transaction(async (tx: any) => {
    // 1. Clear stage report submissions (cashout + final round, all statuses)
    await tx.reportSubmission.deleteMany({
      where: { tournamentInstanceId },
    });

    // 2. Clear standings
    await tx.standing.deleteMany({
      where: { tournamentInstanceId },
    });

    // 3. Clear official results
    await tx.officialMatchResult.deleteMany({
      where: { tournamentInstanceId },
    });

    // 4. Clear match assignments (includes assigned maps for final round)
    await tx.matchAssignment.deleteMany({
      where: { tournamentInstanceId },
    });

    // 5. Clear cashout placements (includes assigned map for cashout)
    await tx.cashoutPlacement?.deleteMany?.({
      where: { tournamentInstanceId },
    }).catch(() => {});

    // 6. Unassign all teams + reset check-in
    await tx.team.updateMany({
      where: { tournamentInstanceId },
      data: {
        tournamentInstanceId: null,
        isPlacedInEvent: false,
        checkInStatus: "Not Checked In",
      },
    });

    // 7. Reset instance state
    await tx.tournamentInstance.update({
      where: { id: tournamentInstanceId },
      data: {
        status: "REGISTRATION_READY",
        currentCycle: null,
        currentStage: "REGISTRATION",
        winningTeamId: null,
        updatedAt: new Date(),
      },
    });
  });

  await createAuditLog({
    guildId: instance.guildId,
    action: "tournament_instance_reset",
    entityType: "tournament_instance",
    entityId: `${tournamentInstanceId}`,
    summary: `Reset ${getTournamentInstanceLabel(instance)}.`,
    actorDiscordUserId,
  });

  const updated = await prisma.tournamentInstance.findUnique({
    where: { id: tournamentInstanceId },
  });

  await pushTournamentWebhookUpdate({
    tournamentInstanceId,
    reason: "instance_reset",
  });

  return normalizeInstance(updated!);
}

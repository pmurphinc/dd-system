import { SavedPanelType } from "@prisma/client";
import { prisma } from "./prisma";

export interface ActivePanelMessageRecordInput {
  guildId: string;
  channelId: string;
  messageId: string;
  panelType: string;
  scopeKey: string;
  ownerDiscordUserId?: string;
  actorDiscordUserId?: string;
  tournamentInstanceId?: number;
  teamId?: number;
  matchAssignmentId?: number;
}

export async function registerActivePanelMessage(input: ActivePanelMessageRecordInput) {
  const now = new Date();
  const record = await prisma.activePanelMessage.upsert({
    where: { scopeKey: input.scopeKey },
    create: {
      guildId: input.guildId,
      channelId: input.channelId,
      messageId: input.messageId,
      panelType: input.panelType,
      scopeKey: input.scopeKey,
      ownerDiscordUserId: input.ownerDiscordUserId,
      actorDiscordUserId: input.actorDiscordUserId,
      tournamentInstanceId: input.tournamentInstanceId,
      teamId: input.teamId,
      matchAssignmentId: input.matchAssignmentId,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      guildId: input.guildId,
      channelId: input.channelId,
      messageId: input.messageId,
      panelType: input.panelType,
      ownerDiscordUserId: input.ownerDiscordUserId,
      actorDiscordUserId: input.actorDiscordUserId,
      tournamentInstanceId: input.tournamentInstanceId,
      teamId: input.teamId,
      matchAssignmentId: input.matchAssignmentId,
      invalidatedAt: null,
      updatedAt: now,
    },
  });

  return record;
}

export async function getActivePanelMessage(scopeKey: string) {
  return prisma.activePanelMessage.findUnique({ where: { scopeKey } });
}

export async function invalidatePanelMessage(scopeKey: string) {
  return prisma.activePanelMessage.updateMany({
    where: { scopeKey, invalidatedAt: null },
    data: { invalidatedAt: new Date(), updatedAt: new Date() },
  });
}

export async function findActivePanels(filters: {
  panelType?: string;
  guildId?: string;
  tournamentInstanceId?: number;
  teamId?: number;
  ownerDiscordUserId?: string;
}) {
  return prisma.activePanelMessage.findMany({
    where: {
      invalidatedAt: null,
      panelType: filters.panelType,
      guildId: filters.guildId,
      tournamentInstanceId: filters.tournamentInstanceId,
      teamId: filters.teamId,
      ownerDiscordUserId: filters.ownerDiscordUserId,
    },
  });
}

export async function removeActivePanelByMessage(channelId: string, messageId: string) {
  return prisma.activePanelMessage.deleteMany({
    where: { channelId, messageId },
  });
}

export async function getSavedPanelInstance(
  guildId: string,
  discordUserId: string,
  panelType: SavedPanelType
) {
  return prisma.savedPanelContext.findUnique({
    where: {
      guildId_discordUserId_panelType: {
        guildId,
        discordUserId,
        panelType,
      },
    },
  });
}

export async function setSavedPanelInstance(
  guildId: string,
  discordUserId: string,
  panelType: SavedPanelType,
  tournamentInstanceId: number
) {
  const now = new Date();
  return prisma.savedPanelContext.upsert({
    where: {
      guildId_discordUserId_panelType: {
        guildId,
        discordUserId,
        panelType,
      },
    },
    create: {
      guildId,
      discordUserId,
      panelType,
      tournamentInstanceId,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      tournamentInstanceId,
      updatedAt: now,
    },
  });
}

export async function clearSavedPanelInstance(
  guildId: string,
  discordUserId: string,
  panelType: SavedPanelType
) {
  return prisma.savedPanelContext.deleteMany({
    where: {
      guildId,
      discordUserId,
      panelType,
    },
  });
}

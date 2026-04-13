import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  InteractionReplyOptions,
  Message,
  MessageCreateOptions,
  StringSelectMenuInteraction,
} from "discord.js";
import { SavedPanelType } from "@prisma/client";
import {
  clearSavedPanelInstance,
  findActivePanels,
  getActivePanelMessage,
  getSavedPanelInstance,
  removeActivePanelByMessage,
  registerActivePanelMessage,
  setSavedPanelInstance,
} from "../storage/panelContext";
import { getTournamentInstanceById } from "../storage/tournamentInstances";

type InteractionWithMessage = ButtonInteraction | StringSelectMenuInteraction;
type QuietlyAckInteraction = InteractionWithMessage | ChatInputCommandInteraction;

export const STALE_PANEL_MESSAGE = "That panel is outdated. Please use the newest panel.";

function isMessageMissingError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Unknown Message|10008|Missing Access|50001|Cannot edit a message authored by another user/i.test(
      error.message
    )
  );
}

function toMessageCreateOptions(panel: InteractionReplyOptions): MessageCreateOptions {
  const sendablePanel: MessageCreateOptions = {
    ...(panel as unknown as MessageCreateOptions),
  };
  delete (sendablePanel as Record<string, unknown>).ephemeral;
  delete (sendablePanel as Record<string, unknown>).flags;
  return sendablePanel;
}

export function buildPanelScopeKey(
  panelType: string,
  guildId: string,
  discordUserId: string
): string {
  return `${panelType}:${guildId}:${discordUserId}`;
}

export async function isStalePanelInteraction(
  interaction: InteractionWithMessage,
  scopeKey: string
): Promise<boolean> {
  const active = await getActivePanelMessage(scopeKey);
  if (!active || active.invalidatedAt) {
    return false;
  }

  return active.messageId !== interaction.message.id;
}

export async function rejectStalePanelInteraction(
  interaction: InteractionWithMessage
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content: STALE_PANEL_MESSAGE, ephemeral: true });
    return;
  }

  await interaction.reply({ content: STALE_PANEL_MESSAGE, ephemeral: true });
}

export async function acknowledgeInteractionQuietly(
  interaction: QuietlyAckInteraction
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    return;
  }

  if (interaction.isChatInputCommand()) {
    await interaction.deferReply({ ephemeral: true });
    return;
  }

  await interaction.deferUpdate();
}

export async function deleteTrackedPanelMessage(params: {
  client: Client;
  channelId: string;
  messageId: string;
  scopeKey: string;
}): Promise<void> {
  const { client, channelId, messageId, scopeKey } = params;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      await removeActivePanelByMessage(channelId, messageId);
      return;
    }

    const message = await channel.messages.fetch(messageId);
    await message.delete().catch((error) => {
      if (!isMessageMissingError(error)) {
        throw error;
      }
    });
  } catch (error) {
    if (!isMessageMissingError(error)) {
      console.debug("[panel-lifecycle] tracked message delete failed softly", {
        scopeKey,
        channelId,
        messageId,
        error,
      });
    }
  } finally {
    await removeActivePanelByMessage(channelId, messageId);
  }
}

export async function cleanupDuplicateActiveScopeRecords(scopeKey: string) {
  const scoped = await findActivePanels({});
  const matching = scoped.filter((record) => record.scopeKey === scopeKey);
  if (matching.length <= 1) {
    return;
  }
  const ordered = [...matching].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const [, ...duplicates] = ordered;
  for (const duplicate of duplicates) {
    await removeActivePanelByMessage(duplicate.channelId, duplicate.messageId);
  }
  console.debug("[panel-lifecycle] duplicate active scope records cleaned up", {
    scopeKey,
    removed: duplicates.length,
  });
}

export async function invalidateOldScopeMessages(params: {
  client: Client;
  scopeKey: string;
  keepMessageId?: string;
}): Promise<void> {
  const { client, scopeKey, keepMessageId } = params;
  const records = await findActivePanels({});
  const stale = records.filter(
    (record) => record.scopeKey === scopeKey && record.messageId !== keepMessageId
  );

  for (const record of stale) {
    await deleteTrackedPanelMessage({
      client,
      channelId: record.channelId,
      messageId: record.messageId,
      scopeKey,
    });
  }
}

export async function repostPanelForScope(params: {
  client: Client;
  guildId: string;
  channelId: string;
  scopeKey: string;
  panelType: string;
  panel: InteractionReplyOptions;
  metadata: {
    ownerDiscordUserId?: string;
    actorDiscordUserId?: string;
    tournamentInstanceId?: number;
    teamId?: number;
    matchAssignmentId?: number;
  };
}): Promise<Message | null> {
  const { client, guildId, channelId, scopeKey, panelType, panel, metadata } = params;
  await cleanupDuplicateActiveScopeRecords(scopeKey);

  const oldActive = await getActivePanelMessage(scopeKey);
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    return null;
  }

  const posted = await channel.send(toMessageCreateOptions(panel));
  await registerActivePanelMessage({
    guildId,
    channelId: posted.channelId,
    messageId: posted.id,
    panelType,
    scopeKey,
    ...metadata,
  });

  if (oldActive && oldActive.messageId !== posted.id) {
    await deleteTrackedPanelMessage({
      client,
      channelId: oldActive.channelId,
      messageId: oldActive.messageId,
      scopeKey,
    });
  }

  await invalidateOldScopeMessages({ client, scopeKey, keepMessageId: posted.id });
  return posted;
}

export async function replaceTrackedPanelByRepost(params: {
  interaction: InteractionWithMessage;
  scopeKey: string;
  panelType: string;
  panel: InteractionReplyOptions;
  metadata: {
    ownerDiscordUserId?: string;
    actorDiscordUserId?: string;
    tournamentInstanceId?: number;
    teamId?: number;
    matchAssignmentId?: number;
  };
}) {
  const { interaction, scopeKey, panelType, panel, metadata } = params;
  const stale = await isStalePanelInteraction(interaction, scopeKey);
  if (stale) {
    console.debug("[panel-lifecycle] stale interaction rejected", { panelType, scopeKey });
    await rejectStalePanelInteraction(interaction);
    return null;
  }

  await acknowledgeInteractionQuietly(interaction);
  const reposted = await repostPanelForScope({
    client: interaction.client,
    guildId: interaction.guildId ?? "",
    channelId: interaction.channelId,
    scopeKey,
    panelType,
    panel,
    metadata,
  });
  return reposted;
}

export async function replaceOrEditPanelFromCommand(params: {
  interaction: ChatInputCommandInteraction;
  scopeKey: string;
  panelType: string;
  panel: InteractionReplyOptions;
  metadata: {
    ownerDiscordUserId?: string;
    actorDiscordUserId?: string;
    tournamentInstanceId?: number;
    teamId?: number;
    matchAssignmentId?: number;
  };
}) {
  const { interaction, scopeKey, panelType, panel, metadata } = params;
  await acknowledgeInteractionQuietly(interaction);
  const reposted = await repostPanelForScope({
    client: interaction.client,
    guildId: interaction.guildId ?? "",
    channelId: interaction.channelId,
    scopeKey,
    panelType,
    panel,
    metadata,
  });

  if (interaction.deferred || interaction.replied) {
    await interaction.deleteReply().catch(() => undefined);
  }

  return reposted;
}

export async function replaceOrEditPanelFromInteraction(params: {
  interaction: InteractionWithMessage;
  scopeKey: string;
  panelType: string;
  panel: InteractionReplyOptions;
  metadata: {
    ownerDiscordUserId?: string;
    actorDiscordUserId?: string;
    tournamentInstanceId?: number;
    teamId?: number;
    matchAssignmentId?: number;
  };
}) {
  return replaceTrackedPanelByRepost(params);
}

export async function replaceOrEditPanelByScopeFromSelector(params: {
  interaction: StringSelectMenuInteraction;
  scopeKey: string;
  panelType: string;
  panel: InteractionReplyOptions;
  metadata: {
    ownerDiscordUserId?: string;
    actorDiscordUserId?: string;
    tournamentInstanceId?: number;
    teamId?: number;
    matchAssignmentId?: number;
  };
}) {
  const { interaction, scopeKey, panelType, panel, metadata } = params;
  await acknowledgeInteractionQuietly(interaction);
  return repostPanelForScope({
    client: interaction.client,
    guildId: interaction.guildId ?? "",
    channelId: interaction.channelId,
    scopeKey,
    panelType,
    panel,
    metadata,
  });
}

export async function resolvePanelInstanceOrPrompt(params: {
  guildId: string;
  discordUserId: string;
  panelType: SavedPanelType;
  canAccessInstance: (instanceId: number) => Promise<boolean>;
}) {
  const saved = await getSavedPanelInstance(
    params.guildId,
    params.discordUserId,
    params.panelType
  );

  if (!saved) {
    return null;
  }

  console.debug("[panel-context] saved instance loaded", {
    guildId: params.guildId,
    discordUserId: params.discordUserId,
    panelType: params.panelType,
    tournamentInstanceId: saved.tournamentInstanceId,
  });

  const instance = await getTournamentInstanceById(saved.tournamentInstanceId);
  const canAccess =
    instance && instance.guildId === params.guildId
      ? await params.canAccessInstance(instance.id)
      : false;
  if (!instance || instance.guildId !== params.guildId || !canAccess) {
    await clearSavedPanelInstance(params.guildId, params.discordUserId, params.panelType);
    console.debug("[panel-context] saved instance cleared because invalid", {
      guildId: params.guildId,
      discordUserId: params.discordUserId,
      panelType: params.panelType,
      tournamentInstanceId: saved.tournamentInstanceId,
    });
    return null;
  }

  return saved.tournamentInstanceId;
}

export async function rememberPanelInstance(params: {
  guildId: string;
  discordUserId: string;
  panelType: SavedPanelType;
  tournamentInstanceId: number;
}) {
  await setSavedPanelInstance(
    params.guildId,
    params.discordUserId,
    params.panelType,
    params.tournamentInstanceId
  );
  console.debug("[panel-context] saved instance updated", params);
}

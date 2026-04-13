import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  InteractionReplyOptions,
  InteractionUpdateOptions,
  Message,
  MessageCreateOptions,
  MessageEditOptions,
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

export const STALE_PANEL_MESSAGE = "That panel is outdated. Please use the newest panel.";

function isMessageMissingError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Unknown Message|10008|Missing Access|50001|Cannot edit a message authored by another user/i.test(
      error.message
    )
  );
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

async function editExistingPanel(
  client: Client,
  channelId: string,
  messageId: string,
  panel: InteractionReplyOptions
) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    return null;
  }

  const message = await channel.messages.fetch(messageId);
  await message.edit(panel as MessageEditOptions);
  return message;
}

async function cleanupActiveScopeRecord(client: Client, scopeKey: string) {
  const active = await getActivePanelMessage(scopeKey);
  if (!active || active.invalidatedAt) {
    return null;
  }

  try {
    const channel = await client.channels.fetch(active.channelId);
    if (!channel || !channel.isTextBased()) {
      await removeActivePanelByMessage(active.channelId, active.messageId);
      console.debug("[panel-lifecycle] old tracked message missing and record invalidated", {
        scopeKey,
        channelId: active.channelId,
        messageId: active.messageId,
      });
      return null;
    }

    const message = await channel.messages.fetch(active.messageId);
    if (message.author.id !== client.user?.id) {
      await removeActivePanelByMessage(active.channelId, active.messageId);
      console.debug("[panel-lifecycle] old tracked message not editable and record invalidated", {
        scopeKey,
        channelId: active.channelId,
        messageId: active.messageId,
      });
      return null;
    }

    return { active, message };
  } catch (error) {
    if (isMessageMissingError(error)) {
      await removeActivePanelByMessage(active.channelId, active.messageId);
      console.debug("[panel-lifecycle] old tracked message missing and record invalidated", {
        scopeKey,
        channelId: active.channelId,
        messageId: active.messageId,
      });
      return null;
    }
    throw error;
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
  await cleanupDuplicateActiveScopeRecords(scopeKey);
  const existing = await cleanupActiveScopeRecord(interaction.client, scopeKey);

  if (existing) {
    try {
      const edited = await editExistingPanel(
        interaction.client,
        existing.active.channelId,
        existing.active.messageId,
        panel
      );
      if (edited) {
        console.debug("[panel-lifecycle] panel edited in place", { panelType, scopeKey });
        await registerActivePanelMessage({
          guildId: interaction.guildId ?? "",
          channelId: edited.channelId,
          messageId: edited.id,
          panelType,
          scopeKey,
          ...metadata,
        });
        await interaction.reply({
          content: "Reopened your existing panel.",
          ephemeral: true,
        });
        return edited;
      }
    } catch (error) {
      console.debug("[panel-lifecycle] panel edit failed, creating replacement", {
        panelType,
        scopeKey,
        error,
      });
    }
  }

  await interaction.reply(panel);
  const message = await interaction.fetchReply();
  if (existing && existing.active.messageId !== message.id) {
    await existing.message.delete().catch(() => undefined);
    console.debug("[panel-lifecycle] active panel replaced", {
      panelType,
      scopeKey,
      previousMessageId: existing.active.messageId,
      replacementMessageId: message.id,
    });
  }
  await registerActivePanelMessage({
    guildId: interaction.guildId ?? "",
    channelId: message.channelId,
    messageId: message.id,
    panelType,
    scopeKey,
    ...metadata,
  });
  console.debug("[panel-lifecycle] active panel registered", { panelType, scopeKey });
  return message;
}

export async function replaceOrEditPanelFromInteraction(params: {
  interaction: InteractionWithMessage;
  scopeKey: string;
  panelType: string;
  panel: InteractionUpdateOptions;
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

  await interaction.update(panel);
  const refreshedMessage = interaction.message;
  await registerActivePanelMessage({
    guildId: interaction.guildId ?? "",
    channelId: refreshedMessage.channelId,
    messageId: refreshedMessage.id,
    panelType,
    scopeKey,
    ...metadata,
  });
  return refreshedMessage;
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
  await cleanupDuplicateActiveScopeRecords(scopeKey);
  const existing = await cleanupActiveScopeRecord(interaction.client, scopeKey);

  if (existing) {
    await existing.message.edit(panel as MessageEditOptions);
    await registerActivePanelMessage({
      guildId: interaction.guildId ?? "",
      channelId: existing.message.channelId,
      messageId: existing.message.id,
      panelType,
      scopeKey,
      ...metadata,
    });
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ content: "Updated your active panel.", ephemeral: true });
    }
    return existing.message;
  }

  const channel = interaction.channel;
  if (!channel || !("send" in channel)) {
    await interaction.reply({ content: "Unable to post panel in this channel.", ephemeral: true });
    return null;
  }

  const sendablePanel: MessageCreateOptions = {
    ...(panel as unknown as MessageCreateOptions),
  };
  delete (sendablePanel as Record<string, unknown>).ephemeral;
  delete (sendablePanel as Record<string, unknown>).flags;
  const posted = (await channel.send(sendablePanel)) as Message;
  await registerActivePanelMessage({
    guildId: interaction.guildId ?? "",
    channelId: posted.channelId,
    messageId: posted.id,
    panelType,
    scopeKey,
    ...metadata,
  });
  console.debug("[panel-lifecycle] active panel replaced", {
    panelType,
    scopeKey,
    replacementMessageId: posted.id,
  });
  if (!interaction.deferred && !interaction.replied) {
    await interaction.reply({ content: "Opened panel in this channel.", ephemeral: true });
  }
  return posted;
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

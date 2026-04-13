import { ChannelType, Client, Message } from "discord.js";
import { buildAdminPanel } from "../helpers/adminPanel";
import { buildTeamPanel } from "../helpers/teamPanel";
import { buildTournamentPanel } from "../helpers/tournamentPanel";
import {
  findActivePanels,
  registerActivePanelMessage,
  removeActivePanelByMessage,
} from "../storage/panelContext";
import { onPanelDataChanged, PanelDataChangeEvent, PanelType } from "./panelRefreshBus";

interface TrackedPanelMessage {
  scopeKey: string;
  panelType: PanelType;
  guildId: string;
  channelId: string;
  messageId: string;
  userId?: string;
  teamId?: number;
  tournamentInstanceId?: number;
}

let botClient: Client | null = null;
let flushTimer: NodeJS.Timeout | null = null;
const pendingEvents: PanelDataChangeEvent[] = [];
const DEBOUNCE_MS = 750;
let hasLoggedPanelStorageFailure = false;

function isMessageMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /Unknown Message|10008|Missing Access|50001|Cannot edit a message authored by another user/i.test(
    error.message
  );
}

function shouldRefresh(entry: TrackedPanelMessage, event: PanelDataChangeEvent): boolean {
  if (event.panelTypes && !event.panelTypes.includes(entry.panelType)) {
    return false;
  }

  if (event.guildId && event.guildId !== entry.guildId) {
    return false;
  }

  if (
    event.tournamentInstanceId !== undefined &&
    entry.tournamentInstanceId !== event.tournamentInstanceId
  ) {
    return false;
  }

  if (event.teamId !== undefined && entry.panelType === "team" && entry.teamId !== event.teamId) {
    return false;
  }

  return true;
}

async function rebuildPanel(entry: TrackedPanelMessage) {
  if (entry.panelType === "admin") {
    return buildAdminPanel(entry.guildId, entry.tournamentInstanceId);
  }

  if (entry.panelType === "tournament") {
    return buildTournamentPanel(entry.tournamentInstanceId, entry.guildId);
  }

  if (!entry.userId) {
    throw new Error("Missing userId for team panel refresh.");
  }

  return buildTeamPanel(entry.userId, entry.guildId);
}

async function updateTrackedPanel(entry: TrackedPanelMessage): Promise<void> {
  if (!botClient) {
    return;
  }

  try {
    const channel = await botClient.channels.fetch(entry.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await removeActivePanelByMessage(entry.channelId, entry.messageId);
      return;
    }

    const message = await channel.messages.fetch(entry.messageId);
    const nextPanel = await rebuildPanel(entry);
    try {
      await message.edit(nextPanel);
    } catch (error) {
      if (isMessageMissingError(error)) {
        const replacement = await channel.send(nextPanel);
        await registerActivePanelMessage({
          guildId: entry.guildId,
          channelId: replacement.channelId,
          messageId: replacement.id,
          panelType: entry.panelType,
          scopeKey: entry.scopeKey,
          ownerDiscordUserId: entry.userId,
          actorDiscordUserId: entry.userId,
          tournamentInstanceId: entry.tournamentInstanceId,
          teamId: entry.teamId,
        });
        await message.delete().catch(() => undefined);
        console.debug("[panel-auto-update] panel replaced", {
          panelType: entry.panelType,
          scopeKey: entry.scopeKey,
          oldMessageId: entry.messageId,
          replacementMessageId: replacement.id,
        });
        return;
      }
      throw error;
    }
    console.debug("[panel-auto-update] panel edited in place", {
      panelType: entry.panelType,
      guildId: entry.guildId,
      messageId: entry.messageId,
    });
  } catch (error) {
    if (isMessageMissingError(error)) {
      await removeActivePanelByMessage(entry.channelId, entry.messageId);
      return;
    }

    console.error("[panel-auto-update] Failed to update panel", { entry, error });
  }
}

async function flushPendingEvents() {
  flushTimer = null;
  const events = pendingEvents.splice(0, pendingEvents.length);
  if (events.length === 0) {
    return;
  }
  try {
    const records = await findActivePanels({});
    hasLoggedPanelStorageFailure = false;
    const tracked: TrackedPanelMessage[] = records.map((record) => ({
      scopeKey: record.scopeKey,
      panelType: record.panelType as PanelType,
      guildId: record.guildId,
      channelId: record.channelId,
      messageId: record.messageId,
      userId: record.ownerDiscordUserId ?? undefined,
      teamId: record.teamId ?? undefined,
      tournamentInstanceId: record.tournamentInstanceId ?? undefined,
    }));
    const affected = tracked.filter((entry) => events.some((event) => shouldRefresh(entry, event)));

    await Promise.all(affected.map((entry) => updateTrackedPanel(entry)));
  } catch (error) {
    if (!hasLoggedPanelStorageFailure) {
      hasLoggedPanelStorageFailure = true;
      console.error(
        "[panel-auto-update] Panel lifecycle storage unavailable; skipping queued refreshes until storage is healthy.",
        error
      );
    }
  }
}

function queueRefresh(event: PanelDataChangeEvent): void {
  pendingEvents.push(event);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    void flushPendingEvents();
  }, DEBOUNCE_MS);
}

export function initializePanelAutoUpdateService(client: Client): void {
  botClient = client;
  onPanelDataChanged((event) => {
    console.debug("[panel-auto-update] cross-panel refresh triggered", event);
    queueRefresh(event);
  });
}

export function registerPanelMessage(
  message: Message,
  metadata: Omit<TrackedPanelMessage, "channelId" | "messageId">
): void {
  void registerActivePanelMessage({
    guildId: metadata.guildId,
    channelId: message.channelId,
    messageId: message.id,
    panelType: metadata.panelType,
    scopeKey: `${metadata.panelType}:${metadata.guildId}:${metadata.userId ?? "global"}`,
    ownerDiscordUserId: metadata.userId,
    actorDiscordUserId: metadata.userId,
    tournamentInstanceId: metadata.tournamentInstanceId,
    teamId: metadata.teamId,
  });
}

export function unregisterPanelMessage(channelId: string, messageId: string): void {
  void removeActivePanelByMessage(channelId, messageId);
}

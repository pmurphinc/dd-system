import { ChannelType, Client, Message } from "discord.js";
import { buildAdminPanel } from "../helpers/adminPanel";
import { buildTeamPanel } from "../helpers/teamPanel";
import { buildTournamentPanel } from "../helpers/tournamentPanel";
import {
  onPanelDataChanged,
  PanelDataChangeEvent,
  PanelType,
} from "./panelRefreshBus";

interface TrackedPanelMessage {
  panelType: PanelType;
  guildId: string;
  channelId: string;
  messageId: string;
  userId?: string;
  teamId?: number;
  tournamentInstanceId?: number;
}

const registry = new Map<string, TrackedPanelMessage>();
let botClient: Client | null = null;
let flushTimer: NodeJS.Timeout | null = null;
const pendingEvents: PanelDataChangeEvent[] = [];
const DEBOUNCE_MS = 750;

function registryKey(channelId: string, messageId: string): string {
  return `${channelId}:${messageId}`;
}

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

  if (event.tournamentInstanceId !== undefined) {
    if (entry.tournamentInstanceId !== event.tournamentInstanceId) {
      return false;
    }
  }

  if (event.teamId !== undefined && entry.panelType === "team") {
    if (entry.teamId !== event.teamId) {
      return false;
    }
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
      registry.delete(registryKey(entry.channelId, entry.messageId));
      return;
    }

    const message = await channel.messages.fetch(entry.messageId);
    const nextPanel = await rebuildPanel(entry);
    await message.edit(nextPanel);
  } catch (error) {
    if (isMessageMissingError(error)) {
      registry.delete(registryKey(entry.channelId, entry.messageId));
      return;
    }

    console.error("[panel-auto-update] Failed to update panel", {
      panelType: entry.panelType,
      channelId: entry.channelId,
      messageId: entry.messageId,
      tournamentInstanceId: entry.tournamentInstanceId,
      teamId: entry.teamId,
      error,
    });
  }
}

async function flushPendingEvents() {
  flushTimer = null;
  const events = pendingEvents.splice(0, pendingEvents.length);
  if (events.length === 0) {
    return;
  }

  const affected = new Map<string, TrackedPanelMessage>();
  for (const entry of registry.values()) {
    const matches = events.some((event) => shouldRefresh(entry, event));
    if (matches) {
      affected.set(registryKey(entry.channelId, entry.messageId), entry);
    }
  }

  await Promise.all(
    [...affected.values()].map(async (entry) => {
      await updateTrackedPanel(entry);
    })
  );
}

function queueRefresh(event: PanelDataChangeEvent): void {
  pendingEvents.push(event);

  if (flushTimer) {
    return;
  }

  flushTimer = setTimeout(() => {
    void flushPendingEvents();
  }, DEBOUNCE_MS);
}

export function initializePanelAutoUpdateService(client: Client): void {
  botClient = client;
  onPanelDataChanged((event) => {
    queueRefresh(event);
  });
}

export function registerPanelMessage(
  message: Message,
  metadata: Omit<TrackedPanelMessage, "channelId" | "messageId">
): void {
  registry.set(registryKey(message.channelId, message.id), {
    ...metadata,
    channelId: message.channelId,
    messageId: message.id,
  });
}

export function unregisterPanelMessage(channelId: string, messageId: string): void {
  registry.delete(registryKey(channelId, messageId));
}

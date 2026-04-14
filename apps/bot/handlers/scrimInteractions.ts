import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  MessageEditOptions,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { buildScrimPanel } from "../helpers/scrimPanel";
import { getTeamById, getTeamForUser } from "../storage/teams";
import {
  adminClearScrimLobbyCode,
  adminListActiveScrimMatches,
  adminListOpenScrimQueue,
  adminReassignScrimMap,
  cancelScrimSearch,
  getScrimStateForTeam,
  leaveOrCompleteScrim,
  markScrimReady,
  queueForScrim,
  setScrimLobbyCode,
} from "../storage/scrims";
import {
  buildPanelScopeKey,
  isStalePanelInteraction,
  rejectStalePanelInteraction,
  replaceOrEditPanelFromInteraction,
} from "../services/panelLifecycle";
import {
  getTeamLeaderAccessDebug,
  hasAdminInteractionAccess,
} from "../helpers/permissions";
import { createAuditLog } from "../storage/auditLog";
import { getActivePanelMessage } from "../storage/panelContext";

const DURATIONS = [30, 60, 120, 180, 240];

type ScrimInteraction = ButtonInteraction | ModalSubmitInteraction;

function toMessageEditOptions(panel: Awaited<ReturnType<typeof buildScrimPanel>>): MessageEditOptions {
  const editPayload: Record<string, unknown> = {
    ...(panel as unknown as Record<string, unknown>),
  };
  delete editPayload.ephemeral;
  delete editPayload.flags;
  return editPayload as MessageEditOptions;
}

async function sendEphemeral(interaction: ScrimInteraction, content: string): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    if (interaction.isModalSubmit()) {
      await interaction.editReply({ content });
      return;
    }
    await interaction.followUp({ content, ephemeral: true });
    return;
  }

  await interaction.reply({ content, ephemeral: true });
}

async function updateTrackedScrimPanelMessage(interaction: ScrimInteraction, teamId: number) {
  if (!interaction.inCachedGuild()) {
    return false;
  }
  const scopeKey = buildPanelScopeKey("scrim", interaction.guildId, interaction.user.id);
  const panel = await buildScrimPanel({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    memberRoles: interaction.member.roles,
    forcedTeamId: teamId,
    isAdminViewer: await hasAdminInteractionAccess(interaction),
  });

  const active = await getActivePanelMessage(scopeKey);
  if (!active) {
    return false;
  }

  try {
    const channel = await interaction.client.channels.fetch(active.channelId);
    if (!channel || !channel.isTextBased()) {
      return false;
    }
    const message = await channel.messages.fetch(active.messageId);
    await message.edit(toMessageEditOptions(panel));
    return true;
  } catch {
    return false;
  }
}

async function refreshScrimPanel(interaction: ScrimInteraction, teamId: number) {
  if (!interaction.inCachedGuild()) return;
  const scopeKey = buildPanelScopeKey("scrim", interaction.guildId, interaction.user.id);
  const panel = await buildScrimPanel({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    memberRoles: interaction.member.roles,
    forcedTeamId: teamId,
    isAdminViewer: await hasAdminInteractionAccess(interaction),
  });

  if (interaction.isButton()) {
    await replaceOrEditPanelFromInteraction({
      interaction,
      scopeKey,
      panelType: "scrim",
      panel,
      metadata: {
        ownerDiscordUserId: interaction.user.id,
        actorDiscordUserId: interaction.user.id,
        teamId,
      },
    });
    return;
  }

  const refreshedTrackedPanel = await updateTrackedScrimPanelMessage(interaction, teamId);
  if (!refreshedTrackedPanel) {
    console.debug("[scrim] failed to refresh tracked scrim panel after modal submit", {
      guildId: interaction.guildId,
      teamId,
      userId: interaction.user.id,
    });
  }
}

async function resolveManagedTeamId(
  interaction: ScrimInteraction,
  requestedTeamId: number
): Promise<number | null> {
  if (!interaction.inCachedGuild()) return null;

  const requestedTeam = await getTeamById(requestedTeamId);
  if (!requestedTeam) {
    await sendEphemeral(interaction, "Team not found.");
    return null;
  }

  if (await hasAdminInteractionAccess(interaction)) {
    return requestedTeamId;
  }

  const directAccess = await getTeamLeaderAccessDebug(
    interaction.guildId,
    interaction.member.roles,
    requestedTeam,
    interaction.user.id
  );
  if (directAccess.isLeader) {
    return requestedTeamId;
  }

  const actingTeam = await getTeamForUser(interaction.user.id, interaction.member.roles);
  if (!actingTeam) {
    await sendEphemeral(interaction, "Only team leaders can manage scrim actions.");
    return null;
  }

  const actingLeaderAccess = await getTeamLeaderAccessDebug(
    interaction.guildId,
    interaction.member.roles,
    actingTeam,
    interaction.user.id
  );
  if (!actingLeaderAccess.isLeader) {
    await sendEphemeral(interaction, "Only team leaders can manage scrim actions.");
    return null;
  }

  const requestedSnapshot = await getScrimStateForTeam(interaction.guildId, requestedTeamId);
  const activeMatch = requestedSnapshot.activeMatch;
  const actingTeamIsInSameMatch =
    activeMatch && (activeMatch.teamAId === actingTeam.id || activeMatch.teamBId === actingTeam.id);

  if (actingTeamIsInSameMatch) {
    return actingTeam.id;
  }

  await sendEphemeral(interaction, "You can only manage scrim actions for your own team.");
  return null;
}

export async function handleScrimButtonInteraction(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("scrim:")) return false;
  if (!interaction.inCachedGuild()) return true;

  const [, action, teamIdRaw] = interaction.customId.split(":");
  const teamId = Number(teamIdRaw);
  const scopeKey = buildPanelScopeKey("scrim", interaction.guildId, interaction.user.id);
  const staleSafeActions = new Set(["duration", "duration_cancel"]);
  if (
    !staleSafeActions.has(action) &&
    (await isStalePanelInteraction(interaction, scopeKey))
  ) {
    await rejectStalePanelInteraction(interaction);
    return true;
  }

  if (action === "refresh") {
    await refreshScrimPanel(interaction, teamId);
    return true;
  }

  if (action === "looking") {
    const managedTeamId = await resolveManagedTeamId(interaction, teamId);
    if (!managedTeamId) return true;
    const durationButtons = DURATIONS.map((minutes) =>
      new ButtonBuilder()
        .setCustomId(`scrim:duration:${minutes}:${managedTeamId}`)
        .setLabel(minutes === 60 ? "1h" : minutes < 60 ? `${minutes}m` : `${minutes / 60}h`)
        .setStyle(ButtonStyle.Primary)
    );
    await interaction.reply({
      content: "How long should your team stay in queue?",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(...durationButtons.slice(0, 3)),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          ...durationButtons.slice(3),
          new ButtonBuilder()
            .setCustomId(`scrim:duration_cancel:${managedTeamId}`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary)
        ),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (action === "duration_cancel") {
    const managedTeamId = await resolveManagedTeamId(interaction, teamId);
    if (!managedTeamId) return true;
    await interaction.update({
      content: "Scrim queue duration selection cancelled.",
      components: [],
    });
    return true;
  }

  if (action === "duration") {
    const minutes = Number(interaction.customId.split(":")[2]);
    const durationTeamId = Number(interaction.customId.split(":")[3]);
    if (Number.isNaN(minutes) || Number.isNaN(durationTeamId)) {
      await interaction.reply({ content: "Invalid scrim duration action.", ephemeral: true });
      return true;
    }
    const managedTeamId = await resolveManagedTeamId(interaction, durationTeamId);
    if (!managedTeamId) return true;
    try {
      await queueForScrim({
        guildId: interaction.guildId,
        teamId: managedTeamId,
        requestedByDiscordUserId: interaction.user.id,
        durationMinutes: minutes,
      });
      await refreshScrimPanel(interaction, managedTeamId);
    } catch (error) {
      await interaction.reply({ content: error instanceof Error ? error.message : "Failed to start scrim queue.", ephemeral: true });
    }
    return true;
  }

  if (action === "cancel") {
    const managedTeamId = await resolveManagedTeamId(interaction, teamId);
    if (!managedTeamId) return true;
    await cancelScrimSearch(interaction.guildId, managedTeamId, interaction.user.id);
    await refreshScrimPanel(interaction, managedTeamId);
    return true;
  }

  if (action === "set_code") {
    const managedTeamId = await resolveManagedTeamId(interaction, teamId);
    if (!managedTeamId) return true;
    const modal = new ModalBuilder().setCustomId(`scrim:set_code_modal:${managedTeamId}`).setTitle("Set Scrim Lobby Code");
    const codeInput = new TextInputBuilder()
      .setCustomId("lobby_code")
      .setLabel("Private lobby code")
      .setStyle(TextInputStyle.Short)
      .setMinLength(2)
      .setMaxLength(64)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(codeInput));
    await interaction.showModal(modal);
    return true;
  }

  if (action === "ready") {
    const managedTeamId = await resolveManagedTeamId(interaction, teamId);
    if (!managedTeamId) return true;
    await markScrimReady(interaction.guildId, managedTeamId);
    await refreshScrimPanel(interaction, managedTeamId);
    return true;
  }

  if (action === "leave") {
    const managedTeamId = await resolveManagedTeamId(interaction, teamId);
    if (!managedTeamId) return true;
    await leaveOrCompleteScrim(interaction.guildId, managedTeamId, false);
    await refreshScrimPanel(interaction, managedTeamId);
    return true;
  }

  if (action === "complete") {
    const managedTeamId = await resolveManagedTeamId(interaction, teamId);
    if (!managedTeamId) return true;
    await leaveOrCompleteScrim(interaction.guildId, managedTeamId, true);
    await refreshScrimPanel(interaction, managedTeamId);
    return true;
  }

  if (action === "requeue") {
    const managedTeamId = await resolveManagedTeamId(interaction, teamId);
    if (!managedTeamId) return true;
    await queueForScrim({ guildId: interaction.guildId, teamId: managedTeamId, requestedByDiscordUserId: interaction.user.id, durationMinutes: 60 });
    await refreshScrimPanel(interaction, managedTeamId);
    return true;
  }

  if (action === "rematch") {
    const managedTeamId = await resolveManagedTeamId(interaction, teamId);
    if (!managedTeamId) return true;
    const snapshot = await getScrimStateForTeam(interaction.guildId, managedTeamId);
    if (!snapshot.activeMatch) {
      await interaction.reply({ content: "No active match to reassign a map for.", ephemeral: true });
      return true;
    }
    await adminReassignScrimMap(snapshot.activeMatch.id);
    await createAuditLog({ guildId: interaction.guildId, action: "SCRIM_MAP_REASSIGNED", entityType: "ScrimMatch", entityId: `${snapshot.activeMatch.id}`, summary: "Leader requested new scrim map.", actorDiscordUserId: interaction.user.id });
    await refreshScrimPanel(interaction, managedTeamId);
    return true;
  }

  if (action === "admin_queue") {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({ content: "Admin only.", ephemeral: true });
      return true;
    }
    const queue = await adminListOpenScrimQueue(interaction.guildId);
    await interaction.reply({ content: queue.length === 0 ? "No active scrim queue entries." : queue.map((row) => `#${row.id} Team ${row.teamId} expires <t:${Math.floor(new Date(row.expiresAt).getTime()/1000)}:R>`).join("\n"), ephemeral: true });
    return true;
  }

  if (action === "admin_matches") {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({ content: "Admin only.", ephemeral: true });
      return true;
    }
    const matches = await adminListActiveScrimMatches(interaction.guildId);
    await interaction.reply({ content: matches.length === 0 ? "No active scrim matches." : matches.map((row) => `#${row.id} Team ${row.teamAId} vs Team ${row.teamBId} | ${row.status} | ${row.map ?? "No map"}`).join("\n"), ephemeral: true });
    return true;
  }

  if (action === "admin_clear_code") {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({ content: "Admin only.", ephemeral: true });
      return true;
    }
    const snapshot = await getScrimStateForTeam(interaction.guildId, teamId);
    if (!snapshot.activeMatch) {
      await interaction.reply({ content: "No active match for this team.", ephemeral: true });
      return true;
    }
    await adminClearScrimLobbyCode(snapshot.activeMatch.id);
    await refreshScrimPanel(interaction, teamId);
    return true;
  }

  return true;
}

export async function handleScrimModalInteraction(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("scrim:set_code_modal:")) return false;
  if (!interaction.inCachedGuild()) return true;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  const teamId = Number(interaction.customId.split(":")[2]);
  const managedTeamId = await resolveManagedTeamId(interaction, teamId);
  if (!managedTeamId) return true;

  try {
    const code = interaction.fields.getTextInputValue("lobby_code").trim();
    await setScrimLobbyCode(interaction.guildId, managedTeamId, code, interaction.user.id);
    await refreshScrimPanel(interaction, managedTeamId);
    await sendEphemeral(interaction, "Lobby code updated.");
  } catch (error) {
    await sendEphemeral(
      interaction,
      error instanceof Error ? error.message : "Failed to update lobby code."
    );
  }

  return true;
}

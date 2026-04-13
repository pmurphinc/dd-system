import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { buildScrimPanel } from "../helpers/scrimPanel";
import { getTeamById } from "../storage/teams";
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
  replaceOrEditPanelFromInteraction,
} from "../services/panelLifecycle";
import {
  getTeamLeaderAccessDebug,
  hasAdminInteractionAccess,
} from "../helpers/permissions";
import { createAuditLog } from "../storage/auditLog";

const DURATIONS = [30, 60, 120, 180, 240];

async function refreshScrimPanel(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction, teamId: number) {
  if (!interaction.inCachedGuild()) return;
  const panel = await buildScrimPanel({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    memberRoles: interaction.member.roles,
    forcedTeamId: teamId,
    isAdminViewer: await hasAdminInteractionAccess(interaction),
  });

  if (interaction.isModalSubmit()) {
    await interaction.reply({ ...panel, ephemeral: true });
    return;
  }

  await replaceOrEditPanelFromInteraction({
    interaction,
    scopeKey: buildPanelScopeKey("scrim", interaction.guildId, interaction.user.id),
    panelType: "scrim",
    panel,
    metadata: {
      ownerDiscordUserId: interaction.user.id,
      actorDiscordUserId: interaction.user.id,
      teamId,
    },
  });
}

async function ensureLeader(interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction, teamId: number): Promise<boolean> {
  if (!interaction.inCachedGuild()) return false;
  const team = await getTeamById(teamId);
  if (!team) {
    await interaction.reply({ content: "Team not found.", ephemeral: true });
    return false;
  }
  const isAdmin = await hasAdminInteractionAccess(interaction);
  if (isAdmin) return true;
  const access = await getTeamLeaderAccessDebug(interaction.guildId, interaction.member.roles, team, interaction.user.id);
  if (!access.isLeader) {
    await interaction.reply({ content: "Only team leaders can manage scrim actions.", ephemeral: true });
    return false;
  }
  return true;
}

export async function handleScrimButtonInteraction(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("scrim:")) return false;
  if (!interaction.inCachedGuild()) return true;

  const [, action, teamIdRaw] = interaction.customId.split(":");
  const teamId = Number(teamIdRaw);

  if (action === "refresh") {
    await refreshScrimPanel(interaction, teamId);
    return true;
  }

  if (action === "looking") {
    if (!(await ensureLeader(interaction, teamId))) return true;
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`scrim:select_duration:${teamId}`)
      .setPlaceholder("Choose queue duration")
      .addOptions(
        DURATIONS.map((minutes) => ({
          label: minutes === 60 ? "1 hour" : minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hours`,
          value: `${minutes}`,
        }))
      );
    await interaction.reply({
      content: "How long should your team stay in queue?",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      ephemeral: true,
    });
    return true;
  }

  if (action === "cancel") {
    if (!(await ensureLeader(interaction, teamId))) return true;
    await cancelScrimSearch(interaction.guildId, teamId, interaction.user.id);
    await refreshScrimPanel(interaction, teamId);
    return true;
  }

  if (action === "set_code") {
    if (!(await ensureLeader(interaction, teamId))) return true;
    const modal = new ModalBuilder().setCustomId(`scrim:set_code_modal:${teamId}`).setTitle("Set Scrim Lobby Code");
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
    if (!(await ensureLeader(interaction, teamId))) return true;
    await markScrimReady(interaction.guildId, teamId);
    await refreshScrimPanel(interaction, teamId);
    return true;
  }

  if (action === "leave") {
    if (!(await ensureLeader(interaction, teamId))) return true;
    await leaveOrCompleteScrim(interaction.guildId, teamId, false);
    await refreshScrimPanel(interaction, teamId);
    return true;
  }

  if (action === "complete") {
    if (!(await ensureLeader(interaction, teamId))) return true;
    await leaveOrCompleteScrim(interaction.guildId, teamId, true);
    await refreshScrimPanel(interaction, teamId);
    return true;
  }

  if (action === "requeue") {
    if (!(await ensureLeader(interaction, teamId))) return true;
    await queueForScrim({ guildId: interaction.guildId, teamId, requestedByDiscordUserId: interaction.user.id, durationMinutes: 60 });
    await refreshScrimPanel(interaction, teamId);
    return true;
  }

  if (action === "rematch") {
    const snapshot = await getScrimStateForTeam(interaction.guildId, teamId);
    if (!snapshot.activeMatch) {
      await interaction.reply({ content: "No active match to reassign a map for.", ephemeral: true });
      return true;
    }
    if (!(await ensureLeader(interaction, teamId))) return true;
    await adminReassignScrimMap(snapshot.activeMatch.id);
    await createAuditLog({ guildId: interaction.guildId, action: "SCRIM_MAP_REASSIGNED", entityType: "ScrimMatch", entityId: `${snapshot.activeMatch.id}`, summary: "Leader requested new scrim map.", actorDiscordUserId: interaction.user.id });
    await refreshScrimPanel(interaction, teamId);
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

export async function handleScrimSelectInteraction(interaction: StringSelectMenuInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("scrim:select_duration:")) return false;
  if (!interaction.inCachedGuild()) return true;

  const teamId = Number(interaction.customId.split(":")[2]);
  if (!(await ensureLeader(interaction, teamId))) return true;

  try {
    const minutes = Number(interaction.values[0]);
    await queueForScrim({
      guildId: interaction.guildId,
      teamId,
      requestedByDiscordUserId: interaction.user.id,
      durationMinutes: minutes,
    });
    await refreshScrimPanel(interaction, teamId);
  } catch (error) {
    await interaction.reply({ content: error instanceof Error ? error.message : "Failed to start scrim queue.", ephemeral: true });
  }
  return true;
}

export async function handleScrimModalInteraction(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("scrim:set_code_modal:")) return false;
  if (!interaction.inCachedGuild()) return true;

  const teamId = Number(interaction.customId.split(":")[2]);
  if (!(await ensureLeader(interaction, teamId))) return true;

  const code = interaction.fields.getTextInputValue("lobby_code").trim();
  await setScrimLobbyCode(interaction.guildId, teamId, code, interaction.user.id);
  await refreshScrimPanel(interaction, teamId);
  return true;
}

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { BotCommand } from "./types";
import { buildTeamPanel } from "../helpers/teamPanel";
import { evaluateTeamPanelChannelSafety } from "../helpers/teamPanelVisibility";
import {
  hasAdminCommandAccess,
  hasFounderCommandAccess,
} from "../helpers/permissions";
import { getTeamById, getTeamForUser } from "../storage/teams";
import {
  buildPanelScopeKey,
  repostPanelForScope,
} from "../services/panelLifecycle";

export const teamCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("team")
    .setDescription("Shows the team panel")
    .addIntegerOption((option) =>
      option
        .setName("team_id")
        .setDescription("Admin/founder only: inspect a specific team panel.")
        .setMinValue(1)
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "This command must be used inside the guild.",
        ephemeral: true,
      });
      return;
    }

    const isFounder = await hasFounderCommandAccess(interaction);
    const isAdmin = isFounder || (await hasAdminCommandAccess(interaction));
    const requestedTeamId = interaction.options.getInteger("team_id");

    const actorTeam = await getTeamForUser(
      interaction.user.id,
      interaction.inCachedGuild() ? interaction.member.roles : undefined
    );
    if (!actorTeam && !isAdmin) {
      await interaction.reply({
        content: "No linked team was found for your account.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (requestedTeamId && !isAdmin) {
      await interaction.reply({
        content: "Only founder/admin can request another team's panel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const team = requestedTeamId ? await getTeamById(requestedTeamId) : actorTeam;

    if (!team) {
      await interaction.reply({
        content: isAdmin
          ? "No default team is linked to your account. Use /team team_id:<id>."
          : "The requested team was not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!isAdmin) {
      if (!actorTeam || actorTeam.id !== team.id) {
        await interaction.reply({
          content: "You can only view your assigned team panel.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const teamPanel = await buildTeamPanel(
      isAdmin ? team.leaderDiscordUserId || interaction.user.id : interaction.user.id,
      interaction.guildId,
      interaction.inCachedGuild() ? interaction.member.roles : undefined,
      isAdmin
        ? {
            forcedTeamId: team.id,
            isAdminViewer: true,
          }
        : {
            forcedTeamId: team.id,
          }
    );

    const safety = await evaluateTeamPanelChannelSafety(interaction, team);
    if (safety.kind === "wrong_team_private_channel") {
      await interaction.reply({
        content: "This private team channel does not match your team.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      ...teamPanel,
      flags: MessageFlags.Ephemeral,
    });

    if (!isAdmin && safety.kind === "correct_team_private_channel") {
      const scopeKey = buildPanelScopeKey("team", interaction.guildId, `team-${team.id}`);
      await repostPanelForScope({
        client: interaction.client,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        scopeKey,
        panelType: "team",
        panel: teamPanel,
        metadata: {
          ownerDiscordUserId: interaction.user.id,
          actorDiscordUserId: interaction.user.id,
          teamId: team.id,
          tournamentInstanceId: team.tournamentInstanceId ?? undefined,
        },
      });
    }
  },
};

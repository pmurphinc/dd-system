import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { BotCommand } from "./types";
import { buildScrimPanel } from "../helpers/scrimPanel";
import { hasAdminCommandAccess } from "../helpers/permissions";
import { getTeamById, getTeamForUser } from "../storage/teams";
import { buildPanelScopeKey, replaceOrEditPanelFromCommand } from "../services/panelLifecycle";

export const scrimCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("scrim")
    .setDescription("Shows the scrim practice panel")
    .addIntegerOption((option) =>
      option.setName("team_id").setDescription("Admin: inspect a specific team").setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({ content: "This command must be used inside the guild.", ephemeral: true });
      return;
    }

    const teamIdOption = interaction.options.getInteger("team_id");
    const isAdmin = await hasAdminCommandAccess(interaction);

    if (teamIdOption && !isAdmin) {
      await interaction.reply({ content: "Only admins can inspect another team's scrim panel.", ephemeral: true });
      return;
    }

    const team = teamIdOption
      ? await getTeamById(teamIdOption)
      : await getTeamForUser(interaction.user.id, interaction.member.roles);

    if (!team) {
      await interaction.reply({ content: "No linked team was found for your account.", ephemeral: true });
      return;
    }

    const panel = await buildScrimPanel({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      memberRoles: interaction.member.roles,
      forcedTeamId: teamIdOption ?? undefined,
      isAdminViewer: isAdmin,
    });

    await replaceOrEditPanelFromCommand({
      interaction,
      scopeKey: buildPanelScopeKey("scrim", interaction.guildId, interaction.user.id),
      panelType: "scrim",
      panel,
      metadata: {
        ownerDiscordUserId: interaction.user.id,
        actorDiscordUserId: interaction.user.id,
        teamId: team.id,
      },
    });
  },
};

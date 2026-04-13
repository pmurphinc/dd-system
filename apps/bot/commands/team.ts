import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { BotCommand } from "./types";
import { buildTeamPanel } from "../helpers/teamPanel";
import { registerPanelMessage } from "../services/panelAutoUpdateService";
import { getTeamForUser } from "../storage/teams";

export const teamCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("team")
    .setDescription("Shows the team panel"),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "This command must be used inside the guild.",
        ephemeral: true,
      });
      return;
    }

    const teamPanel = await buildTeamPanel(
      interaction.user.id,
      interaction.guildId,
      interaction.inCachedGuild() ? interaction.member.roles : undefined
    );

    await interaction.reply(teamPanel);
    const message = await interaction.fetchReply();
    const team = await getTeamForUser(
      interaction.user.id,
      interaction.inCachedGuild() ? interaction.member.roles : undefined
    );

    registerPanelMessage(message, {
      panelType: "team",
      guildId: interaction.guildId,
      userId: interaction.user.id,
      teamId: team?.id,
      tournamentInstanceId: team?.tournamentInstanceId ?? undefined,
    });
  },
};

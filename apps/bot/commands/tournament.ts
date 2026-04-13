import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { BotCommand } from "./types";
import { buildTournamentInstancePicker, buildTournamentPanel } from "../helpers/tournamentPanel";
import { registerPanelMessage } from "../services/panelAutoUpdateService";

export const tournamentCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("tournament")
    .setDescription("Shows an instance-scoped tournament control panel")
    .addIntegerOption((option) =>
      option
        .setName("instance")
        .setDescription("Optional tournament instance ID")
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

    const instanceId = interaction.options.getInteger("instance");

    if (instanceId === null) {
      const picker = await buildTournamentInstancePicker(interaction.guildId);

      await interaction.reply({
        ...picker,
        ephemeral: true,
      });
      return;
    }

    const tournamentPanel = await buildTournamentPanel(
      instanceId,
      interaction.guildId
    );

    await interaction.reply(tournamentPanel);
    const message = await interaction.fetchReply();
    registerPanelMessage(message, {
      panelType: "tournament",
      guildId: interaction.guildId,
      tournamentInstanceId: instanceId,
      userId: interaction.user.id,
    });
  },
};

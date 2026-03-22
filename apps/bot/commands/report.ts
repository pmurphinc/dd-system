import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { BotCommand } from "./types";
import { buildReportPanel } from "../helpers/reportPanel";
import { isFinalRoundReportingOpen } from "../helpers/tournamentAccess";
import { getMockTournamentState } from "../mocks/tournamentState";

export const reportCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("report")
    .setDescription("Report a match result"),

  async execute(interaction: ChatInputCommandInteraction) {
    const tournamentState = await getMockTournamentState();

    if (!isFinalRoundReportingOpen(tournamentState)) {
      await interaction.reply({
        content: "Result reporting is only available during Final Round.",
        ephemeral: true,
      });
      return;
    }

    const reportPanel = await buildReportPanel(interaction.user.id);

    await interaction.reply({
      ...reportPanel,
      ephemeral: true,
    });
  },
};

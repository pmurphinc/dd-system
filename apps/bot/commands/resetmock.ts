import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { BotCommand } from "./types";
import { hasAdminCommandAccess } from "../helpers/permissions";
import { resetMockReviewData } from "../mocks/reviewData";
import { resetMockTournamentState } from "../mocks/tournamentState";

export const resetmockCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("resetmock")
    .setDescription("Resets mock tournament state (development)"),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!hasAdminCommandAccess(interaction)) {
      await interaction.reply({
        content: "You do not have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    await resetMockTournamentState();
    await resetMockReviewData();

    await interaction.reply({
      content: "Mock tournament state has been reset.",
      ephemeral: true,
    });
  },
};

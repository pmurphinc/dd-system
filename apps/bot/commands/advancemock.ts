import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { BotCommand } from "./types";
import { hasAdminCommandAccess } from "../helpers/permissions";
import { advanceMockTournamentState } from "../mocks/tournamentState";

export const advancemockCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("advancemock")
    .setDescription("Advance mock tournament state (development)"),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!hasAdminCommandAccess(interaction)) {
      await interaction.reply({
        content: "You do not have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    const tournamentState = await advanceMockTournamentState();

    await interaction.reply({
      content:
        `Mock tournament advanced.\n` +
        `Status: ${tournamentState.tournamentStatus}\n` +
        `Cycle: ${tournamentState.currentCycle ?? "-"}\n` +
        `Stage: ${tournamentState.currentStage}`,
      ephemeral: true,
    });
  },
};

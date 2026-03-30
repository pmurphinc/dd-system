import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { BotCommand } from "./types";
import { getRecentCycleResults } from "../storage/cycleResults";

export const cycleresultsCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("cycleresults")
    .setDescription("Shows recent recorded cycle results"),

  async execute(interaction: ChatInputCommandInteraction) {
    const cycleResults = await getRecentCycleResults(5);

    const embed = new EmbedBuilder()
      .setTitle("Development Division Cycle Results")
      .setDescription(
        cycleResults.length > 0
          ? cycleResults
              .map(
                (result, index) =>
                  `${index + 1}. Cycle ${result.cycleNumber} | Assignment ${result.matchAssignmentId}\n` +
                  `${result.teamName} vs ${result.opponentTeamName}\n` +
                  `Score: ${result.score}\n` +
                  `FRP: ${result.frpAwardedToTeam}-${result.frpAwardedToOpponent}\n` +
                  `Recorded: ${result.recordedAt.toISOString()}`
              )
              .join("\n\n")
          : "No cycle results recorded yet."
      );

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};

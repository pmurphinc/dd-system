import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { BotCommand } from "./types";
import { getRecentCycleResults } from "../storage/cycleResults";
import { getRecentCashoutFrpBonuses } from "../storage/cashoutFrpBonuses";

export const cycleresultsCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("cycleresults")
    .setDescription("Shows recent recorded FRP results and Cashout bonuses"),

  async execute(interaction: ChatInputCommandInteraction) {
    const [cycleResults, cashoutBonuses] = await Promise.all([
      getRecentCycleResults(5),
      getRecentCashoutFrpBonuses(5),
    ]);

    const embed = new EmbedBuilder()
      .setTitle("Development Division FRP Results")
      .addFields(
        {
          name: "Cashout Bonus FRP",
          value:
            cashoutBonuses.length > 0
              ? cashoutBonuses
                  .map(
                    (bonus, index) =>
                      `${index + 1}. Cycle ${bonus.cycleNumber} | ${bonus.teamName} | +${bonus.frpAwarded} FRP for Cashout 1st place\n` +
                      `Recorded: ${bonus.updatedAt.toISOString()}`
                  )
                  .join("\n\n")
                  .slice(0, 1024)
              : "No Cashout bonus FRP recorded yet.",
          inline: false,
        },
        {
          name: "Final Round FRP",
          value:
            cycleResults.length > 0
              ? cycleResults
                  .map(
                    (result, index) =>
                      `${index + 1}. Cycle ${result.cycleNumber} | Assignment ${result.matchAssignmentId}\n` +
                      `${result.teamName} vs ${result.opponentTeamName}\n` +
                      `Score: ${result.score.replace(/_/g, "-")}\n` +
                      `FRP: ${result.frpAwardedToTeam}-${result.frpAwardedToOpponent}\n` +
                      `Recorded: ${result.recordedAt.toISOString()}`
                  )
                  .join("\n\n")
                  .slice(0, 1024)
              : "No Final Round FRP recorded yet.",
          inline: false,
        }
      );

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};

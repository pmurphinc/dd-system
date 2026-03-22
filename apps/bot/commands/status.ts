import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { BotCommand } from "./types";
import { getTournamentProgressSummary } from "../helpers/tournamentProgress";
import { getMockReviewData } from "../mocks/reviewData";
import { getMockTournamentState } from "../mocks/tournamentState";
import { getStandings } from "../storage/standings";

export const statusCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Shows the current tournament status"),

  async execute(interaction: ChatInputCommandInteraction) {
    const tournamentState = await getMockTournamentState();
    const progressSummary = await getTournamentProgressSummary(tournamentState);
    const reviewData = await getMockReviewData();
    const standings = await getStandings();
    const standingsSummary = standings
      .slice(0, 4)
      .map((standing) => `${standing.teamName}: ${standing.frp}`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("Development Division Status")
      .addFields(
        {
          name: "Tournament Status",
          value: tournamentState.tournamentStatus,
          inline: true,
        },
        {
          name: "Current Cycle",
          value:
            tournamentState.currentCycle === null
              ? "-"
              : `${tournamentState.currentCycle}`,
          inline: true,
        },
        {
          name: "Checked In Teams",
          value: `${tournamentState.checkedInTeams}/${tournamentState.totalTeams}`,
          inline: true,
        },
        {
          name: "Current Stage",
          value: tournamentState.currentStage,
          inline: true,
        },
        {
          name: "Active Match",
          value: tournamentState.activeMatch,
          inline: false,
        },
        {
          name: "Current Cycle Complete",
          value: progressSummary.cycleCompletionLabel,
          inline: true,
        },
        {
          name: "Missing Final Round Assignments",
          value: progressSummary.missingAssignmentsLabel,
          inline: false,
        },
        {
          name: "Pending Reviews",
          value: `${reviewData.pendingTeamsCount}`,
          inline: true,
        },
        {
          name: "Approved Teams",
          value: `${reviewData.approvedTeamsCount}`,
          inline: true,
        },
        {
          name: "Denied Teams",
          value: `${reviewData.deniedTeamsCount}`,
          inline: true,
        },
        {
          name: "FRP Standings",
          value: standingsSummary || "No standings available.",
          inline: false,
        }
      )
      .setFooter({ text: "Mock tournament state for development" });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("status_refresh")
        .setLabel("Refresh Status")
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
  },
};

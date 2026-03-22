import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { getTournamentProgressSummary } from "./tournamentProgress";
import { getMockTournamentState } from "../mocks/tournamentState";

export async function buildTournamentPanel() {
  const tournamentState = await getMockTournamentState();
  const progressSummary = await getTournamentProgressSummary(tournamentState);

  const embed = new EmbedBuilder()
    .setTitle("Development Division Tournament Panel")
    .setDescription("Mock tournament control panel for development")
    .addFields(
      {
        name: "Tournament Status",
        value: tournamentState.tournamentStatus,
        inline: true,
      },
      {
        name: "Current Cycle",
        value: `${tournamentState.currentCycle ?? "-"}`,
        inline: true,
      },
      {
        name: "Current Stage",
        value: tournamentState.currentStage,
        inline: true,
      },
      {
        name: "Checked In Teams",
        value: `${tournamentState.checkedInTeams}/${tournamentState.totalTeams}`,
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
      }
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("tournament_advance")
      .setLabel("Advance State")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("tournament_reset")
      .setLabel("Reset Mock")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("tournament_refresh")
      .setLabel("Refresh Tournament")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

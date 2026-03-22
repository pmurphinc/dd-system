import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { isFinalRoundReportingOpen } from "./tournamentAccess";
import { getMockReportAssignment } from "../mocks/reportAssignment";
import { getMockTournamentState } from "../mocks/tournamentState";

export async function buildMatchPanel(userId: string) {
  const assignment = await getMockReportAssignment(userId);
  const tournamentState = await getMockTournamentState();

  const embed = new EmbedBuilder()
    .setTitle("Development Division Match Panel")
    .setDescription("Mock match panel for development")
    .addFields(
      { name: "Assigned Team", value: assignment.teamName, inline: true },
      { name: "Opponent", value: assignment.opponentTeamName, inline: true },
      { name: "Cycle", value: `${assignment.cycleNumber}`, inline: true },
      { name: "Stage", value: assignment.stageName, inline: true },
      {
        name: "Reporting Available",
        value: isFinalRoundReportingOpen(tournamentState) ? "Yes" : "No",
        inline: true,
      }
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("match_report")
      .setLabel("Report Result")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("match_refresh")
      .setLabel("Refresh Match")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

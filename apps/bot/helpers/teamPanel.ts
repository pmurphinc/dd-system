import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import {
  isCheckInOpen,
  isFinalRoundReportingOpen,
} from "./tournamentAccess";
import { getMockReportAssignment } from "../mocks/reportAssignment";
import { getMockTeamData } from "../mocks/teamData";
import { getMockTournamentState } from "../mocks/tournamentState";

export async function buildTeamPanel(userId: string) {
  const teamData = await getMockTeamData(userId);
  const assignment = await getMockReportAssignment(userId);
  const tournamentState = await getMockTournamentState();

  const embed = new EmbedBuilder()
    .setTitle("Development Division Team Panel")
    .setDescription("Mock team panel for development")
    .addFields(
      { name: "Team Name", value: teamData.teamName, inline: true },
      { name: "Captain", value: teamData.captainName, inline: true },
      {
        name: "Players",
        value: teamData.playerNames.join("\n"),
        inline: false,
      },
      { name: "Substitute", value: teamData.substituteName, inline: true },
      { name: "Approval Status", value: teamData.approvalStatus, inline: true },
      { name: "Check-In Status", value: teamData.checkInStatus, inline: true },
      {
        name: "Check-In Available",
        value: isCheckInOpen(tournamentState) ? "Yes" : "No",
        inline: true,
      },
      {
        name: "Result Reporting Available",
        value: isFinalRoundReportingOpen(tournamentState) ? "Yes" : "No",
        inline: true,
      },
      {
        name: "Assigned Opponent",
        value: assignment.opponentTeamName,
        inline: true,
      },
      { name: "Current Cycle", value: `${assignment.cycleNumber}`, inline: true },
      { name: "Current Stage", value: assignment.stageName, inline: true }
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("team_checkin")
      .setLabel("Check In Team")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("team_view_match")
      .setLabel("View Match")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("team_refresh")
      .setLabel("Refresh Team")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

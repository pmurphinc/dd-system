import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMemberRoleManager,
} from "discord.js";
import { isFinalRoundReportingOpen } from "./tournamentAccess";
import { getReportAssignment } from "../domain/reportAssignment";
import { getTournamentState } from "../domain/tournamentState";

export async function buildMatchPanel(
  userId: string,
  memberRoles?: GuildMemberRoleManager
) {
  const assignment = await getReportAssignment(userId, memberRoles);
  const tournamentState = await getTournamentState();

  const embed = new EmbedBuilder()
    .setTitle("Development Division Match Panel")
    .setDescription("Current assignment and reporting status for your team.")
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

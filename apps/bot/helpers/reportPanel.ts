import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { getMockReportAssignment } from "../mocks/reportAssignment";

export async function buildReportPanel(userId: string) {
  const assignment = await getMockReportAssignment(userId);

  const embed = new EmbedBuilder()
    .setTitle("Development Division Result Report")
    .setDescription("This is the placeholder result reporting panel.")
    .addFields(
      { name: "Assigned Team", value: assignment.teamName, inline: true },
      {
        name: "Opponent",
        value: assignment.opponentTeamName,
        inline: true,
      },
      { name: "Cycle", value: `${assignment.cycleNumber}`, inline: true },
      { name: "Stage", value: assignment.stageName, inline: true }
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("report_2_0")
      .setLabel("2-0")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("report_2_1")
      .setLabel("2-1")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("report_1_2")
      .setLabel("1-2")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("report_0_2")
      .setLabel("0-2")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

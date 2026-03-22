import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import {
  getPendingReportSubmissions,
  getReportSubmissionById,
} from "../storage/reportSubmissions";

export async function handleSelectMenuInteraction(
  interaction: StringSelectMenuInteraction
) {
  if (interaction.customId !== "reports_select_pending") {
    return;
  }

  const selectedReportId = Number(interaction.values[0]);
  const report = await getReportSubmissionById(selectedReportId);

  if (!report || report.status !== "pending") {
    await interaction.reply({
      content: "No pending reports available.",
      ephemeral: true,
    });
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`reports_approve_selected_${report.id}`)
      .setLabel("Approve Selected")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`reports_reject_selected_${report.id}`)
      .setLabel("Reject Selected")
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.reply({
    content:
      `Selected Report ${report.id}\n` +
      `Assignment ${report.matchAssignmentId} | ${report.teamName} vs ${report.opponentTeamName} | ${report.score}`,
    components: [row],
    ephemeral: true,
  });
}

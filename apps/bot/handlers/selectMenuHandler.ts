import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { hasAdminInteractionAccess } from "../helpers/permissions";
import { buildReviewPanel } from "../helpers/reviewPanel";
import { buildTournamentPanel } from "../helpers/tournamentPanel";
import { getMatchAssignmentById } from "../mocks/reportAssignment";
import { setTeamPlacement, setTeamCheckInStatus } from "../storage/teams";
import { getReportSubmissionById } from "../storage/reportSubmissions";
import { handleTournamentInstanceSelectMenu } from "./tournamentInstanceInteractions";
import { handleFounderAdminSelectMenu } from "./founderAdminInteractions";

export async function handleSelectMenuInteraction(
  interaction: StringSelectMenuInteraction
) {
  if (await handleFounderAdminSelectMenu(interaction)) {
    return;
  }

  if (await handleTournamentInstanceSelectMenu(interaction)) {
    return;
  }

  if (interaction.customId === "reports_select_pending") {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        ephemeral: true,
      });
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
        .setLabel("Mark Reviewed")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`reports_reject_selected_${report.id}`)
        .setLabel("Dismiss Selected")
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      content:
        `Selected Report ${report.id}\n` +
        `Assignment ${report.matchAssignmentId} | ${report.teamName} vs ${report.opponentTeamName} | ${report.score}`,
      components: [row],
      ephemeral: true,
    });
    return;
  }

  if (
    interaction.customId === "review_select_pending" ||
    interaction.customId === "review_select_approved" ||
    interaction.customId === "review_select_rejected"
  ) {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        ephemeral: true,
      });
      return;
    }

    const status = interaction.customId.replace("review_select_", "") as
      | "pending"
      | "approved"
      | "rejected";
    const reviewPanel = await buildReviewPanel(Number(interaction.values[0]), status);

    await interaction.reply({
      ...reviewPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "tournament_select_place_team") {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        ephemeral: true,
      });
      return;
    }

    const teamId = Number(interaction.values[0]);
    await setTeamPlacement(teamId, true, interaction.user.id);
    const tournamentPanel = await buildTournamentPanel();

    await interaction.reply({
      content: `Team ${teamId} placed into the event.`,
      ...tournamentPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "tournament_select_checkin_team") {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        ephemeral: true,
      });
      return;
    }

    const teamId = Number(interaction.values[0]);
    await setTeamCheckInStatus(teamId, "Checked In", interaction.user.id);
    const tournamentPanel = await buildTournamentPanel();

    await interaction.reply({
      content: `Team ${teamId} marked checked in.`,
      ...tournamentPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "tournament_select_result_assignment") {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        ephemeral: true,
      });
      return;
    }

    const assignmentId = Number(interaction.values[0]);
    const assignment = await getMatchAssignmentById(assignmentId);

    if (!assignment) {
      await interaction.reply({
        content: "Assignment not found.",
        ephemeral: true,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`tournament_record_result_modal_${assignment.id}`)
      .setTitle(`Result: ${assignment.teamName} vs ${assignment.opponentTeamName}`);

    const scoreInput = new TextInputBuilder()
      .setCustomId("result_score")
      .setLabel("Score (2-0, 2-1, 1-2, 0-2)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const notesInput = new TextInputBuilder()
      .setCustomId("result_notes")
      .setLabel("Notes")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(scoreInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
    );

    await interaction.showModal(modal);
  }
}

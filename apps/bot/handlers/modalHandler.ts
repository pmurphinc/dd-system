import { ModalSubmitInteraction } from "discord.js";
import { buildReviewPanel } from "../helpers/reviewPanel";
import { isFinalRoundReportingOpen } from "../helpers/tournamentAccess";
import { getMockReportAssignment } from "../mocks/reportAssignment";
import {
  approveCurrentPendingTeam,
  getMockReviewData,
} from "../mocks/reviewData";
import { getMockTournamentState } from "../mocks/tournamentState";
import {
  createReportSubmission,
  hasPendingReportSubmissionForAssignment,
} from "../storage/reportSubmissions";

export async function handleModalInteraction(
  interaction: ModalSubmitInteraction
) {
  if (interaction.customId === "review_approve_modal") {
    const reviewData = await getMockReviewData();
    const submittedNotes = interaction.fields
      .getTextInputValue("review_notes")
      .trim();

    if (!reviewData.currentPendingTeam) {
      const reviewPanel = await buildReviewPanel();

      await interaction.reply({
        content: "No pending team to approve.",
        ...reviewPanel,
        ephemeral: true,
      });
      return;
    }

    await approveCurrentPendingTeam(submittedNotes || "none");
    const reviewPanel = await buildReviewPanel();

    await interaction.reply({
      content: submittedNotes
        ? `Team approved. Notes: ${submittedNotes}`
        : "Team approved. Notes: none",
      ...reviewPanel,
      ephemeral: true,
    });
    return;
  }

  if (!interaction.customId.startsWith("report_modal_")) return;

  const tournamentState = await getMockTournamentState();

  if (!isFinalRoundReportingOpen(tournamentState)) {
    await interaction.reply({
      content: "Result reporting is only available during Final Round.",
      ephemeral: true,
    });
    return;
  }

  const selectedResult = interaction.customId.replace("report_modal_", "");
  const assignment = await getMockReportAssignment(interaction.user.id);
  const reportNotes = interaction.fields.getTextInputValue("report_notes").trim();
  const submittedByDisplayName =
    interaction.user.tag ??
    interaction.user.globalName ??
    interaction.user.username;
  const hasPendingReport = await hasPendingReportSubmissionForAssignment(
    assignment.id
  );

  if (hasPendingReport) {
    await interaction.reply({
      content: "A pending report already exists for this assignment.",
      ephemeral: true,
    });
    return;
  }

  await createReportSubmission({
    score: selectedResult,
    matchAssignmentId: assignment.id,
    submittedByDiscordUserId: interaction.user.id,
    submittedByDisplayName,
    teamName: assignment.teamName,
    opponentTeamName: assignment.opponentTeamName,
    cycleNumber: assignment.cycleNumber,
    stageName: assignment.stageName,
    notes: reportNotes || "none",
  });

  await interaction.reply({
    content:
      `Result submitted.\n` +
      `Score: ${selectedResult}\n` +
      `Team: ${assignment.teamName}\n` +
      `Opponent: ${assignment.opponentTeamName}\n` +
      `Cycle: ${assignment.cycleNumber}\n` +
      `Stage: ${assignment.stageName}\n` +
      `Notes: ${reportNotes || "none"}`,
    ephemeral: true,
  });
}

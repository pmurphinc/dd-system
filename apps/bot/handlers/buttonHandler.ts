import {
  ActionRowBuilder,
  ButtonInteraction,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { buildCheckinPanel } from "../helpers/checkinPanel";
import { buildMatchPanel } from "../helpers/matchPanel";
import { buildReportPanel } from "../helpers/reportPanel";
import { buildReportsPanel } from "../helpers/reportsPanel";
import { buildReviewPanel } from "../helpers/reviewPanel";
import { buildTeamPanel } from "../helpers/teamPanel";
import { buildTournamentPanel } from "../helpers/tournamentPanel";
import {
  isCheckInOpen,
  isFinalRoundReportingOpen,
} from "../helpers/tournamentAccess";
import { getMockReportAssignment } from "../mocks/reportAssignment";
import {
  advanceMockTournamentState,
  getMockTournamentState,
  incrementCheckedInTeams,
  resetMockTournamentState,
} from "../mocks/tournamentState";
import {
  denyCurrentPendingTeam,
  getMockReviewData,
  resetMockReviewData,
} from "../mocks/reviewData";
import {
  getPendingReportSubmissions,
  getReportSubmissionById,
  getLatestPendingReportSubmission,
  StoredReportSubmission,
  updateReportSubmissionStatus,
} from "../storage/reportSubmissions";
import { approveReportSubmission } from "../services/reportApproval";

export async function handleButtonInteraction(
  interaction: ButtonInteraction
) {
  if (interaction.customId === "tournament_refresh") {
    const tournamentPanel = await buildTournamentPanel();

    await interaction.reply({
      ...tournamentPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "tournament_advance") {
    await advanceMockTournamentState();
    const tournamentPanel = await buildTournamentPanel();

    await interaction.reply({
      ...tournamentPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "tournament_reset") {
    await resetMockTournamentState();
    await resetMockReviewData();
    const tournamentPanel = await buildTournamentPanel();

    await interaction.reply({
      ...tournamentPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "review_refresh") {
    const reviewPanel = await buildReviewPanel();

    await interaction.reply({
      ...reviewPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "reports_moderate") {
    const pendingReports = await getPendingReportSubmissions(25);

    if (pendingReports.length === 0) {
      await interaction.reply({
        content: "No pending reports available.",
        ephemeral: true,
      });
      return;
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("reports_select_pending")
      .setPlaceholder("Select a pending report")
      .addOptions(
        pendingReports.map((report) => ({
          label: `Assignment ${report.matchAssignmentId} | ${report.teamName} vs ${report.opponentTeamName}`.slice(
            0,
            100
          ),
          description: `Score ${report.score} | Cycle ${report.cycleNumber} | ${report.stageName}`.slice(
            0,
            100
          ),
          value: `${report.id}`,
        }))
      );

    const row =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.reply({
      content: "Select a pending report to moderate.",
      components: [row],
      ephemeral: true,
    });
    return;
  }

  if (
    interaction.customId === "reports_filter_all" ||
    interaction.customId === "reports_filter_pending" ||
    interaction.customId === "reports_filter_approved" ||
    interaction.customId === "reports_filter_rejected"
  ) {
    const statusFilter = interaction.customId.replace(
      "reports_filter_",
      ""
    ) as "all" | "pending" | "approved" | "rejected";
    const reportsPanel = await buildReportsPanel(statusFilter);

    await interaction.reply({
      ...reportsPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId.startsWith("reports_approve_selected_")) {
    const reportId = Number(
      interaction.customId.replace("reports_approve_selected_", "")
    );
    const selectedReport = await getReportSubmissionById(reportId);

    if (!selectedReport || selectedReport.status !== "pending") {
      await interaction.reply({
        content: "No pending reports available.",
        ephemeral: true,
      });
      return;
    }

    const approvalResult = await approveReportSubmission(selectedReport);
    console.log("[report-approval]", approvalResult);
    const reportsPanel = await buildReportsPanel();

    await interaction.reply({
      content: `Report ${selectedReport.id} approved.`,
      ...reportsPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId.startsWith("reports_reject_selected_")) {
    const reportId = Number(
      interaction.customId.replace("reports_reject_selected_", "")
    );
    const selectedReport = await getReportSubmissionById(reportId);

    if (!selectedReport || selectedReport.status !== "pending") {
      await interaction.reply({
        content: "No pending reports available.",
        ephemeral: true,
      });
      return;
    }

    await updateReportSubmissionStatus(selectedReport.id, "rejected");
    const reportsPanel = await buildReportsPanel();

    await interaction.reply({
      content: `Report ${selectedReport.id} rejected.`,
      ...reportsPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "reports_approve_latest") {
    const latestPendingReport = await getLatestPendingReportSubmission();

    if (!latestPendingReport) {
      await interaction.reply({
        content: "No pending reports available.",
        ephemeral: true,
      });
      return;
    }

    const approvalResult = await approveReportSubmission(latestPendingReport);
    console.log("[report-approval]", approvalResult);
    const reportsPanel = await buildReportsPanel();

    await interaction.reply({
      content: "Latest pending report approved.",
      ...reportsPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "reports_reject_latest") {
    const latestPendingReport = await getLatestPendingReportSubmission();

    if (!latestPendingReport) {
      await interaction.reply({
        content: "No pending reports available.",
        ephemeral: true,
      });
      return;
    }

    await updateReportSubmissionStatus(latestPendingReport.id, "rejected");
    const reportsPanel = await buildReportsPanel();

    await interaction.reply({
      content: "Latest pending report rejected.",
      ...reportsPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "team_refresh") {
    const teamPanel = await buildTeamPanel(interaction.user.id);

    await interaction.reply({
      ...teamPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "team_view_match") {
    const matchPanel = await buildMatchPanel(interaction.user.id);

    await interaction.reply({
      ...matchPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "team_checkin") {
    const tournamentState = await getMockTournamentState();

    if (!isCheckInOpen(tournamentState)) {
      await interaction.reply({
        content: "Check-in is not open right now.",
        ephemeral: true,
      });
      return;
    }

    const checkinPanel = await buildCheckinPanel();

    await interaction.reply({
      ...checkinPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "status_refresh") {
    const tournamentState = await getMockTournamentState();
    const reviewData = await getMockReviewData();

    await interaction.reply({
      content:
        `Status refreshed.\n` +
        `Tournament Status: ${tournamentState.tournamentStatus}\n` +
        `Current Cycle: ${tournamentState.currentCycle ?? "-"}\n` +
        `Current Stage: ${tournamentState.currentStage}\n` +
        `Checked-In Teams: ${tournamentState.checkedInTeams}/${tournamentState.totalTeams}\n` +
        `Pending Reviews: ${reviewData.pendingTeamsCount}\n` +
        `Approved Teams: ${reviewData.approvedTeamsCount}\n` +
        `Denied Teams: ${reviewData.deniedTeamsCount}`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "match_report") {
    const tournamentState = await getMockTournamentState();

    if (!isFinalRoundReportingOpen(tournamentState)) {
      await interaction.reply({
        content: "Result reporting is only available during Final Round.",
        ephemeral: true,
      });
      return;
    }

    const reportPanel = await buildReportPanel(interaction.user.id);

    await interaction.reply({
      ...reportPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "match_refresh") {
    const assignment = await getMockReportAssignment(interaction.user.id);
    const tournamentState = await getMockTournamentState();

    await interaction.reply({
      content:
        `Match refreshed.\n` +
        `Team: ${assignment.teamName}\n` +
        `Opponent: ${assignment.opponentTeamName}\n` +
        `Cycle: ${assignment.cycleNumber}\n` +
        `Stage: ${assignment.stageName}\n` +
        `Reporting Available: ${
          isFinalRoundReportingOpen(tournamentState) ? "Yes" : "No"
        }`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "checkin_team") {
    const tournamentState = await getMockTournamentState();

    if (!isCheckInOpen(tournamentState)) {
      await interaction.reply({
        content: "Check-in is not open right now.",
        ephemeral: true,
      });
      return;
    }

    if (tournamentState.checkedInTeams >= tournamentState.totalTeams) {
      await interaction.reply({
        content: "All teams are already checked in.",
        ephemeral: true,
      });
      return;
    }

    const updatedState = await incrementCheckedInTeams();

    await interaction.reply({
      content: `Team checked in. Current count: ${updatedState.checkedInTeams}/${updatedState.totalTeams}`,
      ephemeral: true,
    });
    return;
  }

  if (
    interaction.customId === "report_2_0" ||
    interaction.customId === "report_2_1" ||
    interaction.customId === "report_1_2" ||
    interaction.customId === "report_0_2"
  ) {
    const tournamentState = await getMockTournamentState();

    if (!isFinalRoundReportingOpen(tournamentState)) {
      await interaction.reply({
        content: "Result reporting is only available during Final Round.",
        ephemeral: true,
      });
      return;
    }

    const selectedResult = interaction.customId.replace("report_", "");

    const modal = new ModalBuilder()
      .setCustomId(`report_modal_${selectedResult}`)
      .setTitle("Report Match Result");

    const notesInput = new TextInputBuilder()
      .setCustomId("report_notes")
      .setLabel("Report Notes")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Optional notes")
      .setRequired(false);

    const notesRow =
      new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput);

    modal.addComponents(notesRow);
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === "review_approve") {
    const modal = new ModalBuilder()
      .setCustomId("review_approve_modal")
      .setTitle("Approve Team");

    const notesInput = new TextInputBuilder()
      .setCustomId("review_notes")
      .setLabel("Approval Notes")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Add review notes here...")
      .setRequired(false);

    const row =
      new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput);

    modal.addComponents(row);
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === "review_deny") {
    const reviewData = await getMockReviewData();

    if (!reviewData.currentPendingTeam) {
      const reviewPanel = await buildReviewPanel();

      await interaction.reply({
        content: "No pending team to deny.",
        ...reviewPanel,
        ephemeral: true,
      });
      return;
    }

    await denyCurrentPendingTeam();
    const reviewPanel = await buildReviewPanel();

    await interaction.reply({
      content: "Team denied.",
      ...reviewPanel,
      ephemeral: true,
    });
    return;
  }
}

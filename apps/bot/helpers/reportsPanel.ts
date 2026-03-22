import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ColorResolvable,
  EmbedBuilder,
} from "discord.js";
import {
  getRecentReportSubmissions,
  ReportSubmissionStatusFilter,
} from "../storage/reportSubmissions";

function getReportStatusColor(status: string): ColorResolvable {
  if (status === "approved") {
    return 0x57f287;
  }

  if (status === "rejected") {
    return 0xed4245;
  }

  return 0xfee75c;
}

export async function buildReportsPanel(
  statusFilter: ReportSubmissionStatusFilter = "all"
) {
  const reports = await getRecentReportSubmissions(5, statusFilter);

  const filterLabel =
    statusFilter === "all"
      ? "All"
      : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1);

  const summaryEmbed = new EmbedBuilder()
    .setTitle("Development Division Recent Reports")
    .setDescription(
      reports.length > 0
        ? `Latest stored match result submissions (${filterLabel})`
        : `No reports submitted yet for ${filterLabel}.`
    );

  const reportEmbeds = reports.map((report, index) =>
    new EmbedBuilder()
      .setColor(getReportStatusColor(report.status))
      .setTitle(`Report ${index + 1}`)
      .addFields(
        {
          name: "Assignment ID",
          value: `${report.matchAssignmentId}`,
          inline: true,
        },
        {
          name: "Submitted By",
          value: report.submittedByDisplayName,
          inline: true,
        },
        {
          name: "Status",
          value: report.status,
          inline: true,
        },
        {
          name: "Team",
          value: report.teamName,
          inline: true,
        },
        {
          name: "Opponent",
          value: report.opponentTeamName,
          inline: true,
        },
        {
          name: "Score",
          value: report.score,
          inline: true,
        },
        {
          name: "Cycle",
          value: `${report.cycleNumber}`,
          inline: true,
        },
        {
          name: "Stage",
          value: report.stageName,
          inline: true,
        },
        {
          name: "Submitted At",
          value: report.submittedAt.toISOString(),
          inline: true,
        },
        {
          name: "Notes",
          value: report.notes || "none",
          inline: false,
        }
      )
  );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("reports_moderate")
      .setLabel("Moderate Report")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("reports_approve_latest")
      .setLabel("Approve Latest")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("reports_reject_latest")
      .setLabel("Reject Latest")
      .setStyle(ButtonStyle.Danger)
  );

  const filterRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("reports_filter_all")
      .setLabel("All Reports")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("reports_filter_pending")
      .setLabel("Pending Reports")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("reports_filter_approved")
      .setLabel("Approved Reports")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("reports_filter_rejected")
      .setLabel("Rejected Reports")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [summaryEmbed, ...reportEmbeds],
    components: [row, filterRow],
  };
}

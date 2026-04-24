import {
  ActionRowBuilder,
  ButtonInteraction,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { buildCheckinPanel } from "../helpers/checkinPanel";
import { getCycleCompletionStatus } from "../helpers/cycleCompletion";
import { buildMatchPanel } from "../helpers/matchPanel";
import { hasAdminInteractionAccess } from "../helpers/permissions";
import { buildReportPanel } from "../helpers/reportPanel";
import { buildReportsPanel } from "../helpers/reportsPanel";
import {
  buildApprovedSetupRecoveryPanel,
  buildReviewPanel,
  buildReviewQueue,
} from "../helpers/reviewPanel";
import { buildTeamPanel } from "../helpers/teamPanel";
import { buildTournamentPanel } from "../helpers/tournamentPanel";
import {
  isCheckInOpen,
  isFinalRoundReportingOpen,
} from "../helpers/tournamentAccess";
import {
  ensureAssignmentsForStage,
  getMatchAssignmentsForCycle,
  getMatchAssignmentsForCurrentStage,
  getReportAssignment,
} from "../domain/reportAssignment";
import {
  getTournamentState,
  openCheckIn,
  resetTournamentState,
  setTournamentState,
  startTournamentCycle,
} from "../domain/tournamentState";
import {
  getRegistrationById,
  getRegistrationSummary,
  listRegistrationsByStatus,
  updateRegistrationStatus,
} from "../storage/registrations";
import {
  getPlacedTeams,
  getTeamBySubmissionId,
  getTeamForUser,
  importApprovedRegistrationToTeam,
  listImportedTeams,
  setTeamCheckInStatus,
} from "../storage/teams";
import {
  getLatestPendingReportSubmission,
  getPendingReportSubmissions,
  getReportSubmissionById,
  updateReportSubmissionStatus,
} from "../storage/reportSubmissions";
import { getCycleResultsForCycle } from "../storage/cycleResults";
import { approveReportSubmission } from "../services/reportApproval";
import { ensureDiscordTeamSetup } from "../services/discordTeamSetup";
import { createAuditLog } from "../storage/auditLog";
import { handleTournamentInstanceButton } from "./tournamentInstanceInteractions";
import { handleFounderAdminButton } from "./founderAdminInteractions";
import { handleScrimButtonInteraction } from "./scrimInteractions";
import {
  buildPanelScopeKey,
  replaceOrEditPanelFromInteraction,
} from "../services/panelLifecycle";

function parseIdSuffix(customId: string, prefix: string): number {
  return Number(customId.slice(prefix.length));
}

function parseReviewTarget(customId: string, prefix: string): {
  submissionId: number;
  statusFilter: "pending" | "approved" | "rejected";
} {
  const payload = customId.slice(prefix.length);
  const lastUnderscoreIndex = payload.lastIndexOf("_");
  const submissionId = Number(payload.slice(0, lastUnderscoreIndex));
  const statusFilter = payload.slice(lastUnderscoreIndex + 1) as
    | "pending"
    | "approved"
    | "rejected";

  return {
    submissionId,
    statusFilter,
  };
}

async function buildSubmissionPicker(status: "pending" | "approved" | "rejected") {
  const submissions = await listRegistrationsByStatus(status, 25);

  if (submissions.length === 0) {
    return null;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`review_select_${status}`)
    .setPlaceholder(`Select a ${status} submission`)
    .addOptions(
      submissions.map((submission) => ({
        label: `${submission.teamName} (#${submission.id})`.slice(0, 100),
        description: `${submission.reviewStatus} | ${submission.discordCommunity ?? "community unknown"}${submission.importedTeamId ? " | imported" : ""}`.slice(
          0,
          100
        ),
        value: `${submission.id}`,
      }))
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function formatTeamPlayers(players: string[]): string {
  return players.map((player) => `* ${player}`).join("\n");
}

async function runApprovalPipeline(
  submissionId: number,
  actorDiscordUserId: string,
  guild: ButtonInteraction["guild"]
) {
  const submission = await getRegistrationById(submissionId);

  if (!submission) {
    throw new Error("Submission not found.");
  }

  const approvedSubmission =
    submission.reviewStatus === "approved"
      ? submission
      : await updateRegistrationStatus(
          submissionId,
          "approved",
          submission.reviewerNotes,
          actorDiscordUserId
        );

  if (!approvedSubmission) {
    throw new Error("Failed to approve submission.");
  }

  const importedTeam =
    approvedSubmission.importedTeamId !== null
      ? await getTeamBySubmissionId(approvedSubmission.id)
      : await importApprovedRegistrationToTeam(approvedSubmission.id, actorDiscordUserId);

  if (!importedTeam) {
    throw new Error("Approved submission could not be loaded as a live team.");
  }

  if (!guild) {
    return {
      team: importedTeam,
      setup: null,
      setupError: "This action must be used inside the guild for Discord setup.",
    };
  }

  try {
    const setup = await ensureDiscordTeamSetup(guild, importedTeam, actorDiscordUserId);
    return {
      team: importedTeam,
      setup,
      roleName: setup.teamRole.name,
      setupError: null,
    };
  } catch (error) {
    const refreshedTeam = await getTeamBySubmissionId(approvedSubmission.id);
    const roleName =
      refreshedTeam?.discordRoleId && guild.roles.cache.has(refreshedTeam.discordRoleId)
        ? guild.roles.cache.get(refreshedTeam.discordRoleId)?.name ?? null
        : null;

    return {
      team: refreshedTeam ?? importedTeam,
      roleName,
      setup: null,
      setupError:
        error instanceof Error ? error.message : "Discord setup failed.",
    };
  }
}

function buildTeamPicker(
  customId: string,
  teams: Awaited<ReturnType<typeof listImportedTeams>>
) {
  if (teams.length === 0) {
    return null;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Select a team")
    .addOptions(
      teams.map((team) => ({
        label: team.teamName.slice(0, 100),
        description: `${team.isPlacedInEvent ? "placed" : "not placed"} | ${team.checkInStatus}`.slice(
          0,
          100
        ),
        value: `${team.id}`,
      }))
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function buildAssignmentPicker(
  customId: string,
  assignments: Awaited<ReturnType<typeof getMatchAssignmentsForCurrentStage>>
) {
  if (assignments.length === 0) {
    return null;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Select an assignment")
    .addOptions(
      assignments.map((assignment) => ({
        label: `#${assignment.id} ${assignment.teamName} vs ${assignment.opponentTeamName}`.slice(
          0,
          100
        ),
        description: `Cycle ${assignment.cycleNumber} | ${assignment.stageName}`.slice(
          0,
          100
        ),
        value: `${assignment.id}`,
      }))
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export async function handleButtonInteraction(
  interaction: ButtonInteraction
) {
  if (await handleScrimButtonInteraction(interaction)) {
    return;
  }

  if (await handleFounderAdminButton(interaction)) {
    return;
  }

  if (await handleTournamentInstanceButton(interaction)) {
    return;
  }

  if (interaction.customId === "tournament_refresh") {
    const tournamentPanel = await buildTournamentPanel();
    await replaceOrEditPanelFromInteraction({
      interaction,
      scopeKey: buildPanelScopeKey(
        "tournament",
        interaction.guildId ?? "",
        interaction.user.id
      ),
      panelType: "tournament",
      panel: tournamentPanel,
      metadata: {
        ownerDiscordUserId: interaction.user.id,
        actorDiscordUserId: interaction.user.id,
      },
    });
    return;
  }

  if (interaction.customId === "team_refresh") {
    const teamPanel = await buildTeamPanel(
      interaction.user.id,
      interaction.guildId ?? "",
      interaction.inCachedGuild() ? interaction.member.roles : undefined
    );

    await replaceOrEditPanelFromInteraction({
      interaction,
      scopeKey: buildPanelScopeKey("team", interaction.guildId ?? "", interaction.user.id),
      panelType: "team",
      panel: teamPanel,
      metadata: {
        ownerDiscordUserId: interaction.user.id,
        actorDiscordUserId: interaction.user.id,
      },
    });
    return;
  }

  if (interaction.customId === "team_view_match") {
    const matchPanel = await buildMatchPanel(
      interaction.user.id,
      interaction.inCachedGuild() ? interaction.member.roles : undefined
    );

    await interaction.reply({
      ...matchPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "team_checkin") {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "This action must be used inside the guild.",
        ephemeral: true,
      });
      return;
    }

    const teamPanel = await buildTeamPanel(
      interaction.user.id,
      interaction.guildId,
      interaction.member.roles
    );

    await interaction.reply({
      content: "Check-in moved to the instance-scoped `/team` panel. Use the controls below.",
      ...teamPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "status_refresh") {
    const tournamentState = await getTournamentState();
    const reviewData = await getRegistrationSummary();

    await interaction.reply({
      content:
        `Status refreshed.\n` +
        `Tournament Status: ${tournamentState.tournamentStatus}\n` +
        `Current Cycle: ${tournamentState.currentCycle ?? "-"}\n` +
        `Current Stage: ${tournamentState.currentStage}\n` +
        `Checked-In Teams: ${tournamentState.checkedInTeams}/${tournamentState.totalTeams}\n` +
        `Pending Reviews: ${reviewData.pendingCount}\n` +
        `Approved Teams: ${reviewData.approvedCount}\n` +
        `Rejected Teams: ${reviewData.rejectedCount}`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "match_report") {
    const tournamentState = await getTournamentState();

    if (!isFinalRoundReportingOpen(tournamentState)) {
      await interaction.reply({
        content: "Result reporting is only available during Final Round.",
        ephemeral: true,
      });
      return;
    }

    const reportPanel = await buildReportPanel(
      interaction.user.id,
      interaction.guildId ?? "",
      interaction.inCachedGuild() ? interaction.member.roles : undefined
    );

    await interaction.reply({
      ...reportPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "match_refresh") {
    const assignment = await getReportAssignment(
      interaction.user.id,
      interaction.inCachedGuild() ? interaction.member.roles : undefined
    );
    const tournamentState = await getTournamentState();

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
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "This action must be used inside the guild.",
        ephemeral: true,
      });
      return;
    }

    const teamPanel = await buildTeamPanel(
      interaction.user.id,
      interaction.guildId,
      interaction.member.roles
    );

    await interaction.reply({
      content: "This older check-in button now routes through `/team`. Use the instance-scoped panel below.",
      ...teamPanel,
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
    const tournamentState = await getTournamentState();

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

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
    );
    await interaction.showModal(modal);
    return;
  }

  const isAdminAction =
    interaction.customId.startsWith("review_") ||
    interaction.customId.startsWith("reports_") ||
    interaction.customId.startsWith("tournament_");

  if (isAdminAction && !(await hasAdminInteractionAccess(interaction))) {
    await interaction.reply({
      content: "You do not have permission to use this action.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "review_create") {
    const modal = new ModalBuilder()
      .setCustomId("review_create_modal")
      .setTitle("Create Registration Submission");

    const teamName = new TextInputBuilder()
      .setCustomId("team_name")
      .setLabel("Team Name")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const leaderId = new TextInputBuilder()
      .setCustomId("leader_discord")
      .setLabel("Leader Discord ID or Mention")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const players = new TextInputBuilder()
      .setCustomId("player_rows")
      .setLabel("Players: Name | Discord ID(optional) | Embark ID")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);
    const screenshots = new TextInputBuilder()
      .setCustomId("screenshot_rows")
      .setLabel("Screenshot links in the same player order")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);
    const notes = new TextInputBuilder()
      .setCustomId("submission_notes")
      .setLabel("Optional reviewer intake notes")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(teamName),
      new ActionRowBuilder<TextInputBuilder>().addComponents(leaderId),
      new ActionRowBuilder<TextInputBuilder>().addComponents(players),
      new ActionRowBuilder<TextInputBuilder>().addComponents(screenshots),
      new ActionRowBuilder<TextInputBuilder>().addComponents(notes)
    );

    await interaction.showModal(modal);
    return;
  }

  if (
    interaction.customId === "review_list_pending" ||
    interaction.customId === "review_list_approved" ||
    interaction.customId === "review_list_rejected"
  ) {
    const status = interaction.customId.replace("review_list_", "") as
      | "pending"
      | "approved"
      | "rejected";
    const picker = await buildSubmissionPicker(status);

    if (!picker) {
      await interaction.reply({
        content: `No ${status} submissions found.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: `Select a ${status} submission.`,
      components: [picker],
      ephemeral: true,
    });
    return;
  }

  if (
    interaction.customId === "review_queue_pending" ||
    interaction.customId === "review_queue_approved" ||
    interaction.customId === "review_queue_rejected"
  ) {
    const status = interaction.customId.replace("review_queue_", "") as
      | "pending"
      | "approved"
      | "rejected";
    const reviewQueue = await buildReviewQueue(status);

    await interaction.reply({
      ...reviewQueue,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId.startsWith("review_back_queue_")) {
    const status = interaction.customId.replace("review_back_queue_", "") as
      | "pending"
      | "approved"
      | "rejected";
    const reviewQueue = await buildReviewQueue(status);

    await interaction.reply({
      ...reviewQueue,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId.startsWith("review_refresh_")) {
    const { submissionId, statusFilter } = parseReviewTarget(
      interaction.customId,
      "review_refresh_"
    );
    const reviewPanel = await buildReviewPanel(
      submissionId || undefined,
      statusFilter
    );

    await interaction.reply({
      ...reviewPanel,
      ephemeral: true,
    });
    return;
  }

  if (
    interaction.customId.startsWith("review_prev_") ||
    interaction.customId.startsWith("review_next_")
  ) {
    const prefix = interaction.customId.startsWith("review_prev_")
      ? "review_prev_"
      : "review_next_";
    const { submissionId, statusFilter } = parseReviewTarget(
      interaction.customId,
      prefix
    );
    const reviewPanel = await buildReviewPanel(submissionId, statusFilter);

    await interaction.reply({
      ...reviewPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId.startsWith("review_notes_")) {
    const { submissionId, statusFilter } = parseReviewTarget(
      interaction.customId,
      "review_notes_"
    );
    const submission = await getRegistrationById(submissionId);

    if (!submission) {
      await interaction.reply({
        content: "Submission not found.",
        ephemeral: true,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`review_notes_modal_${submission.id}_${statusFilter}`)
      .setTitle(`Reviewer Notes: ${submission.teamName}`);
    const notesInput = new TextInputBuilder()
      .setCustomId("review_notes")
      .setLabel("Reviewer Notes")
      .setStyle(TextInputStyle.Paragraph)
      .setValue(submission.reviewerNotes)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
    );

    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId.startsWith("review_approve_")) {
    const { submissionId, statusFilter } = parseReviewTarget(
      interaction.customId,
      "review_approve_"
    );
    const submission = await getRegistrationById(submissionId);

    if (!submission) {
      await interaction.reply({
        content: "Submission not found.",
        ephemeral: true,
      });
      return;
    }

    const result = await runApprovalPipeline(
      submissionId,
      interaction.user.id,
      interaction.guild
    );
    const reviewPanel = await buildReviewPanel(
      statusFilter === "pending" ? undefined : submissionId,
      statusFilter === "pending" ? "pending" : statusFilter
    );

    const content = result.setup
      ? `Approved and Setup Complete\n\n` +
        `Team: ${result.team.teamName}\n\n` +
        `${result.team.discordCommunity ? `Discord Community: ${result.team.discordCommunity}\n\n` : ""}` +
        `Players:\n${formatTeamPlayers(result.setup.players)}\n\n` +
        `Role: ${result.setup.teamRole.name}\n` +
        `Voice: ${result.setup.voiceChannel.name}`
      : `Approved with Setup Issue\n\n` +
        `Team imported successfully.\n` +
        `Team: ${result.team.teamName}\n` +
        `${result.team.discordCommunity ? `Discord Community: ${result.team.discordCommunity}\n` : ""}` +
        `${result.roleName ? `Role created/reused: ${result.roleName}\n` : ""}` +
        `Voice setup failed: ${result.setupError}`;

    await interaction.reply({
      content,
      ...reviewPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId.startsWith("review_reject_")) {
    const { submissionId, statusFilter } = parseReviewTarget(
      interaction.customId,
      "review_reject_"
    );
    const submission = await getRegistrationById(submissionId);

    if (!submission) {
      await interaction.reply({
        content: "Submission not found.",
        ephemeral: true,
      });
      return;
    }

    if (submission.reviewStatus === "rejected") {
      await interaction.reply({
        content: "Submission is already rejected.",
        ephemeral: true,
      });
      return;
    }

    const updated = await updateRegistrationStatus(
      submissionId,
      "rejected",
      submission.reviewerNotes,
      interaction.user.id
    );
    const reviewPanel = await buildReviewPanel(
      statusFilter === "pending" ? undefined : updated?.id,
      statusFilter === "pending" ? "pending" : statusFilter
    );

    await interaction.reply({
      content: `${submission.teamName} rejected.${submission.discordCommunity ? ` Community: ${submission.discordCommunity}.` : ""}`,
      ...reviewPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId.startsWith("review_pending_")) {
    const { submissionId } = parseReviewTarget(
      interaction.customId,
      "review_pending_"
    );
    const submission = await getRegistrationById(submissionId);

    if (!submission) {
      await interaction.reply({
        content: "Submission not found.",
        ephemeral: true,
      });
      return;
    }

    if (submission.reviewStatus === "pending") {
      await interaction.reply({
        content: "Submission is already pending.",
        ephemeral: true,
      });
      return;
    }

    const updated = await updateRegistrationStatus(
      submissionId,
      "pending",
      submission.reviewerNotes,
      interaction.user.id
    );
    const reviewPanel = await buildReviewPanel(updated?.id, "pending");

    await interaction.reply({
      content: `${submission.teamName} returned to pending.${submission.discordCommunity ? ` Community: ${submission.discordCommunity}.` : ""}`,
      ...reviewPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId.startsWith("review_import_")) {
    const { submissionId, statusFilter } = parseReviewTarget(
      interaction.customId,
      "review_import_"
    );
    const submission = await getRegistrationById(submissionId);

    if (!submission) {
      await interaction.reply({
        content: "Submission not found.",
        ephemeral: true,
      });
      return;
    }

    if (submission.reviewStatus !== "approved") {
      await interaction.reply({
        content: "Only approved submissions can be imported.",
        ephemeral: true,
      });
      return;
    }

    if (submission.importedTeamId) {
      await interaction.reply({
        content: "Submission is already imported.",
        ephemeral: true,
      });
      return;
    }

    const team = await importApprovedRegistrationToTeam(
      submissionId,
      interaction.user.id
    );
    const reviewPanel = await buildReviewPanel(submissionId, statusFilter);

    await interaction.reply({
      content: `${team.teamName} imported into live teams as Team #${team.id}.`,
      ...reviewPanel,
      ephemeral: true,
    });
    return;
  }

  if (
    interaction.customId.startsWith("review_setup_") &&
    interaction.customId !== "review_setup_approved_open"
  ) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "This action must be used inside the guild.",
        ephemeral: true,
      });
      return;
    }

    const { submissionId } = parseReviewTarget(
      interaction.customId,
      "review_setup_"
    );
    const team = await getTeamBySubmissionId(submissionId);

    if (!team) {
      await interaction.reply({
        content: "Import the approved submission before running Discord setup.",
        ephemeral: true,
      });
      return;
    }

    try {
      const setup = await ensureDiscordTeamSetup(
        interaction.guild,
        team,
        interaction.user.id
      );

      await interaction.reply({
        content:
          `Setup Complete\n\n` +
          `Team: ${team.teamName}\n\n` +
          `Players:\n` +
          `${setup.players.map((player) => `* ${player}`).join("\n")}\n\n` +
          `Role: ${setup.teamRole.name}\n` +
          `Voice: ${setup.voiceChannel.name}`,
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error
            ? error.message
            : "Discord setup failed.",
        ephemeral: true,
      });
    }
    return;
  }

  if (interaction.customId === "review_setup_approved_open") {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This action must be used inside the guild.",
        ephemeral: true,
      });
      return;
    }

    const recoveryPanel = await buildApprovedSetupRecoveryPanel({
      guildId: interaction.guildId,
    });

    await interaction.reply({
      ...recoveryPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId.startsWith("review_force_setup_")) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "This action must be used inside the guild.",
        ephemeral: true,
      });
      return;
    }

    const submissionId = parseIdSuffix(interaction.customId, "review_force_setup_");
    const submission = await getRegistrationById(submissionId);

    if (!submission || submission.reviewStatus !== "approved") {
      await interaction.reply({
        content: "Approved submission not found for setup recovery.",
        ephemeral: true,
      });
      return;
    }

    const team = await getTeamBySubmissionId(submissionId);

    if (!team) {
      await interaction.reply({
        content: "Approved submission is not imported as a live team yet.",
        ephemeral: true,
      });
      return;
    }

    try {
      const setup = await ensureDiscordTeamSetup(
        interaction.guild,
        team,
        interaction.user.id
      );

      const assigned = setup.memberAssignments.assigned;
      const skipped = setup.memberAssignments.skipped;
      const missingLinks = setup.memberAssignments.missingDiscordLinks;

      await createAuditLog({
        guildId: interaction.guildId,
        action: "team_setup_forced_from_review",
        entityType: "team",
        entityId: `${team.id}`,
        summary: `${interaction.user.id} forced setup for ${team.teamName}.`,
        details:
          `Submission ${submission.id}. ` +
          `Role ${setup.teamRole.id} (${setup.roleAction}). ` +
          `Channel ${setup.voiceChannel.id} (${setup.voiceAction}). ` +
          `Assigned: ${assigned.length > 0 ? assigned.join(", ") : "none"}. ` +
          `Skipped: ${
            skipped.length > 0
              ? skipped.map((entry) => `${entry.displayName} (${entry.reason})`).join(", ")
              : "none"
          }. ` +
          `Missing links: ${missingLinks.length > 0 ? missingLinks.join(", ") : "none"}.`,
        actorDiscordUserId: interaction.user.id,
      });

      await interaction.reply({
        content:
          `Force Discord Setup Complete\n\n` +
          `Team: ${team.teamName}\n` +
          `Role: <@&${setup.teamRole.id}> (${setup.roleAction})\n` +
          `Channel: <#${setup.voiceChannel.id}> (${setup.voiceAction})\n\n` +
          `Members assigned (${assigned.length}): ${
            assigned.length > 0 ? assigned.join(", ") : "none"
          }\n` +
          `Members skipped (${skipped.length}): ${
            skipped.length > 0
              ? skipped.map((entry) => `${entry.displayName} (${entry.reason})`).join(", ")
              : "none"
          }\n` +
          `Missing Discord links (${missingLinks.length}): ${
            missingLinks.length > 0 ? missingLinks.join(", ") : "none"
          }`,
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error
            ? `Force Discord setup failed: ${error.message}`
            : "Force Discord setup failed.",
        ephemeral: true,
      });
    }
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

    await interaction.reply({
      content: "Select a pending report to moderate.",
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
      ],
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
    const rawFilter = interaction.customId.replace("reports_filter_", "");
    const statusFilter =
      rawFilter === "approved"
        ? "reviewed"
        : rawFilter === "rejected"
          ? "dismissed"
          : (rawFilter as "all" | "pending" | "reviewed" | "dismissed");
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
      content: `Report ${selectedReport.id} marked reviewed.`,
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

    await updateReportSubmissionStatus(selectedReport.id, "dismissed");
    const reportsPanel = await buildReportsPanel();

    await interaction.reply({
      content: `Report ${selectedReport.id} dismissed.`,
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
      content: "Latest pending report marked reviewed.",
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

    await updateReportSubmissionStatus(latestPendingReport.id, "dismissed");
    const reportsPanel = await buildReportsPanel();

    await interaction.reply({
      content: "Latest pending report dismissed.",
      ...reportsPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "tournament_pending_reports") {
    const reportsPanel = await buildReportsPanel("pending");
    await interaction.reply({
      ...reportsPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "tournament_place_team") {
    const importedTeams = await listImportedTeams();
    const eligible = importedTeams.filter((team) => !team.isPlacedInEvent);
    const currentlyPlaced = importedTeams.filter((team) => team.isPlacedInEvent);

    if (currentlyPlaced.length >= 4) {
      await interaction.reply({
        content: "This event already has 4 placed teams.",
        ephemeral: true,
      });
      return;
    }

    const picker = buildTeamPicker("tournament_select_place_team", eligible);

    if (!picker) {
      await interaction.reply({
        content: "No imported teams are available to place.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: "Select an imported team to place into the event.",
      components: [picker],
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "tournament_checkin_team") {
    const placedTeams = await getPlacedTeams();
    const eligible = placedTeams.filter(
      (team) => team.checkInStatus !== "Checked In"
    );
    const picker = buildTeamPicker("tournament_select_checkin_team", eligible);

    if (!picker) {
      await interaction.reply({
        content: "No placed teams are waiting on check-in.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: "Select a placed team to mark checked in.",
      components: [picker],
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "tournament_start_cycle") {
    try {
      const current = await getTournamentState();

      if (current.tournamentStatus === "Live") {
        await interaction.reply({
          content: "The tournament is already live.",
          ephemeral: true,
        });
        return;
      }

      if (current.tournamentStatus === "Registration Open") {
        await openCheckIn(interaction.user.id);
      }

      const nextState = await startTournamentCycle(interaction.user.id);
      const tournamentPanel = await buildTournamentPanel();

      await interaction.reply({
        content: `Cycle ${nextState.currentCycle} started in ${nextState.currentStage}.`,
        ...tournamentPanel,
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error
            ? error.message
            : "Failed to start the cycle.",
        ephemeral: true,
      });
    }
    return;
  }

  if (interaction.customId === "tournament_assign_matchups") {
    const tournamentState = await getTournamentState();

    if (tournamentState.tournamentStatus !== "Live" || !tournamentState.currentCycle) {
      await interaction.reply({
        content: "Start the event before assigning matchups.",
        ephemeral: true,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(
        `tournament_assign_matchups_modal_${tournamentState.currentCycle}_${tournamentState.currentStage.replace(
          / /g,
          "-"
        )}`
      )
      .setTitle(`Matchups: Cycle ${tournamentState.currentCycle} ${tournamentState.currentStage}`);

    const inputOne = new TextInputBuilder()
      .setCustomId("matchup_one")
      .setLabel("Matchup 1: Team A vs Team B")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const inputTwo = new TextInputBuilder()
      .setCustomId("matchup_two")
      .setLabel("Matchup 2: Team C vs Team D")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(inputOne),
      new ActionRowBuilder<TextInputBuilder>().addComponents(inputTwo)
    );

    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === "tournament_record_result") {
    const assignments = await getMatchAssignmentsForCurrentStage();
    const picker = buildAssignmentPicker(
      "tournament_select_result_assignment",
      assignments
    );

    if (!picker) {
      await interaction.reply({
        content: "No assignments are available for the current stage.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: "Select an assignment to enter an approved result.",
      components: [picker],
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "tournament_advance_stage") {
    const state = await getTournamentState();

    if (state.tournamentStatus !== "Live" || state.currentCycle === null) {
      await interaction.reply({
        content: "The tournament is not live.",
        ephemeral: true,
      });
      return;
    }

    if (state.currentStage === "Cashout") {
      const placedTeams = await getPlacedTeams();
      const pairs = [
        [placedTeams[0]?.teamName ?? "", placedTeams[1]?.teamName ?? ""],
        [placedTeams[2]?.teamName ?? "", placedTeams[3]?.teamName ?? ""],
      ].filter(
        (pair): pair is [string, string] => Boolean(pair[0] && pair[1])
      );

      await ensureAssignmentsForStage(state.currentCycle, "Final Round", pairs);
      const nextState = await setTournamentState({
        ...state,
        currentStage: "Final Round",
      });

      await createAuditLog({
        action: "tournament_stage_advanced",
        entityType: "tournament_state",
        entityId: "1",
        summary: `Advanced to ${nextState.currentStage}.`,
        actorDiscordUserId: interaction.user.id,
      });

      const tournamentPanel = await buildTournamentPanel();
      await interaction.reply({
        content: `Advanced to ${nextState.currentStage}.`,
        ...tournamentPanel,
        ephemeral: true,
      });
      return;
    }

    if (state.currentStage === "Final Round") {
      const pendingReports = await getPendingReportSubmissions(100);
      const pendingForStage = pendingReports.filter(
        (report) =>
          report.cycleNumber === state.currentCycle &&
          report.stageName === state.currentStage
      );

      if (pendingForStage.length > 0) {
        await interaction.reply({
          content: "Approve or reject pending reports before advancing.",
          ephemeral: true,
        });
        return;
      }

      const [cycleAssignments, cycleResults] = await Promise.all([
        getMatchAssignmentsForCycle(state.currentCycle),
        getCycleResultsForCycle(state.currentCycle),
      ]);
      const completion = getCycleCompletionStatus(
        state.currentCycle,
        cycleAssignments,
        cycleResults
      );

      if (!completion.isComplete) {
        await interaction.reply({
          content:
            completion.requiredAssignmentIds.length === 0
              ? "Create Final Round assignments before advancing."
              : `Final Round is incomplete. Missing assignments: ${
                  completion.missingAssignmentIds.join(", ") || "none"
                }.`,
          ephemeral: true,
        });
        return;
      }

      if (state.currentCycle >= 3) {
        const completed = await setTournamentState({
          ...state,
          tournamentStatus: "Completed",
          currentStage: "Complete",
          activeMatch: "No active match",
        });
        const tournamentPanel = await buildTournamentPanel();

        await interaction.reply({
          content: `Tournament completed at cycle ${completed.currentCycle}.`,
          ...tournamentPanel,
          ephemeral: true,
        });
        return;
      }

      const nextCycle = state.currentCycle + 1;
      const placedTeams = await getPlacedTeams();
      const pairs = [
        [placedTeams[0]?.teamName ?? "", placedTeams[1]?.teamName ?? ""],
        [placedTeams[2]?.teamName ?? "", placedTeams[3]?.teamName ?? ""],
      ].filter(
        (pair): pair is [string, string] => Boolean(pair[0] && pair[1])
      );

      await ensureAssignmentsForStage(nextCycle, "Cashout", pairs);
      const nextState = await setTournamentState({
        ...state,
        currentCycle: nextCycle,
        currentStage: "Cashout",
      });
      const tournamentPanel = await buildTournamentPanel();

      await interaction.reply({
        content: `Advanced to cycle ${nextCycle} ${nextState.currentStage}.`,
        ...tournamentPanel,
        ephemeral: true,
      });
      return;
    }
  }

  if (interaction.customId === "tournament_reset") {
    await resetTournamentState();
    const tournamentPanel = await buildTournamentPanel();

    await interaction.reply({
      ...tournamentPanel,
      ephemeral: true,
    });
    return;
  }
}

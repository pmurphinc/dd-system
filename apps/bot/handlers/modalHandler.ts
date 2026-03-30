import { ModalSubmitInteraction } from "discord.js";
import { buildReviewPanel } from "../helpers/reviewPanel";
import { hasAdminInteractionAccess } from "../helpers/permissions";
import { buildTournamentPanel } from "../helpers/tournamentPanel";
import { isFinalRoundReportingOpen } from "../helpers/tournamentAccess";
import {
  getMatchAssignmentById,
  getReportAssignment,
  replaceAssignmentsForStage,
} from "../mocks/reportAssignment";
import { getTournamentState } from "../mocks/tournamentState";
import {
  createRegistrationSubmission,
  getRegistrationById,
  updateRegistrationReviewerNotes,
} from "../storage/registrations";
import {
  createReportSubmission,
  hasPendingReportSubmissionForAssignment,
} from "../storage/reportSubmissions";
import { approveReportSubmission } from "../services/reportApproval";
import { getPlacedTeams } from "../storage/teams";
import { handleTournamentInstanceModal } from "./tournamentInstanceInteractions";
import { handleFounderAdminModal } from "./founderAdminInteractions";

function normalizeDiscordUserId(input: string): string {
  return input.replace(/[<@!>]/g, "").trim();
}

function parsePlayerRows(playerRows: string, screenshotRows: string) {
  const playerLines = playerRows
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const screenshotLines = screenshotRows
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (playerLines.length === 0 || playerLines.length > 4) {
    throw new Error("Enter between 1 and 4 player lines.");
  }

  if (playerLines.length !== screenshotLines.length) {
    throw new Error("Player rows and screenshot rows must have the same count.");
  }

  return playerLines.map((line, index) => {
    const [displayNameRaw, discordIdRaw = "", embarkIdRaw = ""] = line
      .split("|")
      .map((part) => part.trim());

    if (!displayNameRaw || !embarkIdRaw) {
      throw new Error(
        "Each player row must be formatted as Name | Discord ID(optional) | Embark ID."
      );
    }

    return {
      displayName: displayNameRaw,
      discordUserId: discordIdRaw ? normalizeDiscordUserId(discordIdRaw) : undefined,
      embarkId: embarkIdRaw,
      screenshotLink: screenshotLines[index],
      isLeader: index === 0,
      sortOrder: index,
    };
  });
}

function parseMatchup(input: string): [string, string] {
  const normalized = input.trim();
  const separator = normalized.includes(" vs ")
    ? " vs "
    : normalized.includes(" VS ")
      ? " VS "
      : " vs. ";
  const [teamName, opponentName] = normalized.split(separator).map((part) => part.trim());

  if (!teamName || !opponentName) {
    throw new Error("Matchups must be entered as Team A vs Team B.");
  }

  return [teamName, opponentName];
}

function normalizeScore(score: string): string {
  const normalized = score.replace("-", "_").trim();

  if (!["2_0", "2_1", "1_2", "0_2"].includes(normalized)) {
    throw new Error("Score must be one of 2-0, 2-1, 1-2, or 0-2.");
  }

  return normalized;
}

export async function handleModalInteraction(
  interaction: ModalSubmitInteraction
) {
  if (await handleFounderAdminModal(interaction)) {
    return;
  }

  if (await handleTournamentInstanceModal(interaction)) {
    return;
  }

  if (interaction.customId === "review_create_modal") {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        ephemeral: true,
      });
      return;
    }

    try {
      const teamName = interaction.fields.getTextInputValue("team_name").trim();
      const leaderDiscordUserId = normalizeDiscordUserId(
        interaction.fields.getTextInputValue("leader_discord")
      );
      const players = parsePlayerRows(
        interaction.fields.getTextInputValue("player_rows"),
        interaction.fields.getTextInputValue("screenshot_rows")
      );
      const notes = interaction.fields.getTextInputValue("submission_notes").trim();
      const created = await createRegistrationSubmission({
        teamName,
        leaderDiscordUserId,
        leaderDisplayName: players[0].displayName,
        submittedNotes: notes,
        createdByDiscordUserId: interaction.user.id,
        createdByDisplayName:
          interaction.user.tag ??
          interaction.user.globalName ??
          interaction.user.username,
        players,
      });
      const reviewPanel = await buildReviewPanel(created.id, "pending");

      await interaction.reply({
        content: `Created submission #${created.id} for ${created.teamName}.`,
        ...reviewPanel,
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error ? error.message : "Failed to create submission.",
        ephemeral: true,
      });
    }
    return;
  }

  if (interaction.customId.startsWith("review_notes_modal_")) {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        ephemeral: true,
      });
      return;
    }

    const payload = interaction.customId.replace("review_notes_modal_", "");
    const lastUnderscoreIndex = payload.lastIndexOf("_");
    const submissionId = Number(payload.slice(0, lastUnderscoreIndex));
    const statusFilter = payload.slice(lastUnderscoreIndex + 1) as
      | "pending"
      | "approved"
      | "rejected";
    const notes = interaction.fields.getTextInputValue("review_notes").trim();
    const updated = await updateRegistrationReviewerNotes(
      submissionId,
      notes,
      interaction.user.id
    );

    if (!updated) {
      await interaction.reply({
        content: "Submission not found.",
        ephemeral: true,
      });
      return;
    }

    const reviewPanel = await buildReviewPanel(updated.id, statusFilter);

    await interaction.reply({
      content: `Reviewer notes updated for ${updated.teamName}.`,
      ...reviewPanel,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId.startsWith("tournament_assign_matchups_modal_")) {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        ephemeral: true,
      });
      return;
    }

    try {
      const [, , , , cycleRaw, stageRaw] = interaction.customId.split("_");
      const cycleNumber = Number(cycleRaw);
      const stageName = stageRaw.replace(/-/g, " ");
      const placedTeams = await getPlacedTeams();
      const teamNames = new Set(placedTeams.map((team) => team.teamName));
      const matchups = [
        parseMatchup(interaction.fields.getTextInputValue("matchup_one")),
        parseMatchup(interaction.fields.getTextInputValue("matchup_two")),
      ];

      for (const [teamName, opponentName] of matchups) {
        if (!teamNames.has(teamName) || !teamNames.has(opponentName)) {
          throw new Error("All matchup teams must already be placed into the event.");
        }
      }

      await replaceAssignmentsForStage(cycleNumber, stageName, matchups);
      const tournamentPanel = await buildTournamentPanel();

      await interaction.reply({
        content: `Updated cycle ${cycleNumber} ${stageName} matchups.`,
        ...tournamentPanel,
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error ? error.message : "Failed to assign matchups.",
        ephemeral: true,
      });
    }
    return;
  }

  if (interaction.customId.startsWith("tournament_record_result_modal_")) {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        ephemeral: true,
      });
      return;
    }

    try {
      const assignmentId = Number(
        interaction.customId.replace("tournament_record_result_modal_", "")
      );
      const assignment = await getMatchAssignmentById(assignmentId);

      if (!assignment) {
        await interaction.reply({
          content: "Assignment not found.",
          ephemeral: true,
        });
        return;
      }

      const score = normalizeScore(
        interaction.fields.getTextInputValue("result_score")
      );
      const notes = interaction.fields.getTextInputValue("result_notes").trim();
      const pendingExists = await hasPendingReportSubmissionForAssignment(
        assignment.id
      );

      if (pendingExists) {
        await interaction.reply({
          content: "A pending report already exists for this assignment.",
          ephemeral: true,
        });
        return;
      }

      const report = await createReportSubmission({
        tournamentInstanceId: 0,
        teamId: 0,
        score,
        matchAssignmentId: assignment.id,
        submittedByDiscordUserId: interaction.user.id,
        submittedByDisplayName:
          interaction.user.tag ??
          interaction.user.globalName ??
          interaction.user.username,
        teamName: assignment.teamName,
        opponentTeamName: assignment.opponentTeamName,
        cycleNumber: assignment.cycleNumber,
        stageName: assignment.stageName,
        notes: notes || "admin entered",
      });

      await approveReportSubmission(report);
      const tournamentPanel = await buildTournamentPanel();

      await interaction.reply({
        content: `Approved result ${score.replace("_", "-")} for ${assignment.teamName} vs ${assignment.opponentTeamName}.`,
        ...tournamentPanel,
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error ? error.message : "Failed to record result.",
        ephemeral: true,
      });
    }
    return;
  }

  if (!interaction.customId.startsWith("report_modal_")) return;

  const tournamentState = await getTournamentState();

  if (!isFinalRoundReportingOpen(tournamentState)) {
    await interaction.reply({
      content: "Result reporting is only available during Final Round.",
      ephemeral: true,
    });
    return;
  }

  const selectedResult = interaction.customId.replace("report_modal_", "");
  const assignment = await getReportAssignment(
    interaction.user.id,
    interaction.inCachedGuild() ? interaction.member.roles : undefined
  );
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
    tournamentInstanceId: 0,
    teamId: 0,
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

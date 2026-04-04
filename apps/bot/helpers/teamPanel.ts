import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMemberRoleManager,
} from "discord.js";
import { TournamentStage } from "@prisma/client";
import { getOfficialResultByMatchAssignmentId } from "../storage/officialMatchResults";
import { getCurrentFinalRoundAssignmentForTeam } from "../storage/matchAssignments";
import {
  getCurrentTeamStageSubmission,
  getTeamStageSubmissionType,
  getTeamStageSubmissionStatusLabel,
} from "../storage/reportSubmissions";
import { getStandingsForTournamentInstance } from "../storage/standings";
import { getTeamForUser } from "../storage/teams";
import {
  getTournamentInstanceById,
  syncTournamentInstancesForGuild,
} from "../storage/tournamentInstances";
import { getAssignedMapForTeamCurrentStage } from "../storage/tournamentMaps";
import { isCheckInOpen } from "./tournamentAccess";
import { getTeamLeaderAccessDebug } from "./permissions";

function getStageLabel(stage?: string | null): string {
  switch (stage) {
    case "CHECKIN":
      return "Check-In";
    case "CASHOUT":
      return "Cashout";
    case "FINAL_ROUND":
      return "Final Round";
    case "COMPLETED":
      return "Complete";
    default:
      return "Registration";
  }
}

function normalizeCheckInStatus(checkInStatus?: string | null): string {
  return String(checkInStatus).trim().toUpperCase().replace(/\s+/g, "_");
}

function isTeamCheckedIn(checkInStatus?: string | null): boolean {
  return normalizeCheckInStatus(checkInStatus) === "CHECKED_IN";
}

function getCheckInLabel(checkInStatus?: string | null): string {
  return isTeamCheckedIn(checkInStatus)
    ? "✅ Checked In"
    : "❌ Not Checked In";
}

function getFinalScoreLabel(score?: string | null): string {
  if (!score) {
    return "0-0";
  }

  return score.replace(/_/g, "-");
}

export async function buildTeamPanel(
  userId: string,
  guildId: string,
  memberRoles?: GuildMemberRoleManager
) {
  await syncTournamentInstancesForGuild(guildId);

  const team = await getTeamForUser(userId, memberRoles);

  if (!team) {
    const embed = new EmbedBuilder()
      .setTitle("Development Division Team Panel")
      .setDescription("No linked team was found for your account.");

    return {
      embeds: [embed],
      components: [],
    };
  }

  const instance =
    team.tournamentInstanceId !== null
      ? await getTournamentInstanceById(team.tournamentInstanceId)
      : null;

  const assignment =
    instance && team.tournamentInstanceId !== null
      ? await getCurrentFinalRoundAssignmentForTeam(
          team.tournamentInstanceId,
          team.id,
          instance.currentCycle
        )
      : null;

  const officialResult = assignment
    ? await getOfficialResultByMatchAssignmentId(assignment.id)
    : null;

  const standings =
    instance && team.tournamentInstanceId !== null
      ? await getStandingsForTournamentInstance(team.tournamentInstanceId)
      : [];

  const standing = standings.find((row) => row.teamName === team.teamName);
  const teamFrp = standing?.frp ?? 0;

  const leaderAccess =
    memberRoles && instance
      ? await getTeamLeaderAccessDebug(guildId, memberRoles, team, userId)
      : {
          hasTeamRole: false,
          hasBaseTeamLeaderRole: false,
          matchesStoredLeaderId: false,
          matchesLeaderMemberId: false,
          isRoleBasedLeader: false,
          isLeader: false,
          note: "Leader access can only be evaluated inside the guild.",
        };

  const currentStage = instance?.currentStage ?? null;
  const currentCycle = instance?.currentCycle ?? null;
  const currentSubmission =
    instance && currentCycle && (currentStage === TournamentStage.CASHOUT || currentStage === TournamentStage.FINAL_ROUND)
      ? await getCurrentTeamStageSubmission(instance.id, team.id, currentCycle, currentStage)
      : null;
  const currentSubmissionType = currentSubmission
    ? getTeamStageSubmissionType(currentSubmission)
    : null;
  const assignedMap =
    instance && currentCycle && currentStage
      ? await getAssignedMapForTeamCurrentStage(instance.id, team.id, currentCycle, currentStage)
      : null;

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: "Team Name",
      value: team.teamName,
      inline: true,
    },
    {
      name: "Check-In",
      value: getCheckInLabel(team.checkInStatus),
      inline: true,
    },
    {
      name: "Current Stage",
      value: getStageLabel(currentStage),
      inline: true,
    },
    {
      name: "Current Team FRP",
      value: `${teamFrp}`,
      inline: true,
    },
    {
      name: "Submitted Result Status",
      value: getTeamStageSubmissionStatusLabel(currentSubmission),
      inline: true,
    },
    {
      name: "Banned Map (Registration)",
      value: team.mapBan ?? "Missing",
      inline: true,
    },
    {
      name: "Assigned Map",
      value: assignedMap ?? "Not assigned",
      inline: true,
    },
  ];

  console.log(`[team-panel-map] team=${team.teamName} mapBan=${team.mapBan ?? "<null>"}`);

  if (currentStage === TournamentStage.CASHOUT) {
    fields.push({
      name: "Submitted Cashout Placement",
      value: currentSubmission ? `${currentSubmission.score}` : "none",
      inline: true,
    });
  }

  if (currentStage === TournamentStage.FINAL_ROUND) {
    fields.push(
      {
        name: "Opponent",
        value: assignment?.opponentTeamName ?? "Not assigned",
        inline: true,
      },
      {
        name: "Official Match Score",
        value: getFinalScoreLabel(officialResult?.score),
        inline: true,
      },
      {
        name: "Submitted Final Round FRP",
        value: currentSubmission ? `${currentSubmission.score}` : "none",
        inline: true,
      }
    );
  }

  const embed = new EmbedBuilder()
    .setTitle("Development Division Team Panel")
    .setDescription(`Live status for ${team.teamName}.`)
    .addFields(fields);

  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];

  const refreshRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`team:refresh:${team.id}`)
      .setLabel("Refresh Team")
      .setStyle(ButtonStyle.Secondary)
  );
  rows.push(refreshRow);

  if (leaderAccess.isLeader && instance) {
    const canEditSubmission =
      currentSubmission !== null && currentSubmission.status !== "reviewed";
    const canSubmitCashout =
      currentStage === TournamentStage.CASHOUT && currentCycle !== null;
    const canSubmitFinalRound =
      currentStage === TournamentStage.FINAL_ROUND && currentCycle !== null && !!assignment;

    const leaderRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`team:checkin:${instance.id}:${team.id}`)
        .setLabel("Check In")
        .setStyle(ButtonStyle.Success)
        .setDisabled(
          !isCheckInOpen(instance) || isTeamCheckedIn(team.checkInStatus)
        ),
      new ButtonBuilder()
        .setCustomId(`team:submit_cashout:${instance.id}:${team.id}`)
        .setLabel("Submit Cashout Placement")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!canSubmitCashout),
      new ButtonBuilder()
        .setCustomId(`team:submit_final_round:${instance.id}:${team.id}`)
        .setLabel("Submit Final Round Score")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!canSubmitFinalRound),
      new ButtonBuilder()
        .setCustomId(
          currentSubmissionType === "CASHOUT_PLACEMENT"
            ? `team:edit_cashout:${instance.id}:${team.id}`
            : `team:edit_final_round:${instance.id}:${team.id}`
        )
        .setLabel("Edit Submitted Result")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!canEditSubmission)
    );

    rows.unshift(leaderRow);
  }

  return {
    embeds: [embed],
    components: rows,
  };
}

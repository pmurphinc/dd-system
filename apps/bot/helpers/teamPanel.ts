import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMemberRoleManager,
} from "discord.js";
import { getOfficialResultByMatchAssignmentId } from "../storage/officialMatchResults";
import { getCurrentFinalRoundAssignmentForTeam } from "../storage/matchAssignments";
import { getStandingsForTournamentInstance } from "../storage/standings";
import { getTeamForUser } from "../storage/teams";
import {
  getTournamentInstanceById,
  syncTournamentInstancesForGuild,
} from "../storage/tournamentInstances";
import {
  canLeaderSubmitInformationalReport,
  isCheckInOpen,
} from "./tournamentAccess";
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
      name: "Stage",
      value: getStageLabel(currentStage),
      inline: true,
    },
    {
      name: "FRP",
      value: `${teamFrp}`,
      inline: true,
    },
  ];

  if (currentStage === "CASHOUT") {
    fields.push({
      name: "Status",
      value: "Awaiting Cashout results.",
      inline: false,
    });
  }

  if (currentStage === "FINAL_ROUND") {
    fields.push(
      {
        name: "Opponent",
        value: assignment?.opponentTeamName ?? "Not assigned",
        inline: true,
      },
      {
        name: "Current Score",
        value: getFinalScoreLabel(officialResult?.score),
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
    const leaderRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`team:checkin:${instance.id}:${team.id}`)
        .setLabel("Check In")
        .setStyle(ButtonStyle.Success)
        .setDisabled(
          !isCheckInOpen(instance) || isTeamCheckedIn(team.checkInStatus)
        ),
      new ButtonBuilder()
        .setCustomId(`team:report:${instance.id}:${team.id}`)
        .setLabel("Submit Final Report")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(
          !canLeaderSubmitInformationalReport(instance) || !assignment
        )
    );

    rows.unshift(leaderRow);
  }

  return {
    embeds: [embed],
    components: rows,
  };
}
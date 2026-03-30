import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { getCashoutPlacementForCycle } from "../storage/cashoutPlacements";
import { listMatchAssignmentsForTournamentInstance } from "../storage/matchAssignments";
import { listOfficialResultsForTournamentInstance } from "../storage/officialMatchResults";
import { getPendingReportSubmissions } from "../storage/reportSubmissions";
import { getStandingsForTournamentInstance } from "../storage/standings";
import {
  countCheckedInTeamsForInstance,
  getTournamentInstanceById,
  getTournamentInstanceLabel,
  listTournamentInstancesForGuild,
  syncTournamentInstancesForGuild,
} from "../storage/tournamentInstances";
import { listImportedTeamsForTournamentInstance } from "../storage/teams";

function formatEnumLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCycleLabel(cycle: number | null | undefined): string {
  return cycle ? `Cycle ${cycle}` : "Cycle -";
}

export async function buildTournamentInstancePicker(guildId: string) {
  const instances = await syncTournamentInstancesForGuild(guildId);

  if (instances.length === 0) {
    return {
      content: "No tournament instances are available yet. Import approved teams first.",
      components: [],
    };
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId("tournament:select_instance")
    .setPlaceholder("Select a tournament instance")
    .addOptions(
      instances.map((instance) => ({
        label: getTournamentInstanceLabel(instance).slice(0, 100),
        description: `${formatEnumLabel(instance.status)} | ${formatCycleLabel(
          instance.currentCycle
        )}`.slice(0, 100),
        value: `${instance.id}`,
      }))
    );

  return {
    content: "Select the tournament instance to manage.",
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    ],
  };
}

export async function buildTournamentPanel(
  tournamentInstanceId?: number,
  guildId?: string
) {
  if (guildId) {
    await syncTournamentInstancesForGuild(guildId);
  }

  const resolvedInstanceId =
    tournamentInstanceId ??
    (guildId ? (await listTournamentInstancesForGuild(guildId))[0]?.id : undefined);

  if (resolvedInstanceId === undefined) {
    return {
      content: "No tournament instance is available.",
      components: [],
    };
  }

  const instance = await getTournamentInstanceById(resolvedInstanceId);

  if (!instance) {
    return {
      content: "Tournament instance not found.",
      components: [],
    };
  }

  const [
    teams,
    checkedInCount,
    standings,
    placements,
    assignments,
    officialResults,
    pendingReports,
  ] = await Promise.all([
    listImportedTeamsForTournamentInstance(instance.id),
    countCheckedInTeamsForInstance(instance.id),
    getStandingsForTournamentInstance(instance.id),
    instance.currentCycle
      ? getCashoutPlacementForCycle(instance.id, instance.currentCycle)
      : Promise.resolve(null),
    listMatchAssignmentsForTournamentInstance(
      instance.id,
      instance.currentCycle ?? undefined
    ),
    listOfficialResultsForTournamentInstance(
      instance.id,
      instance.currentCycle ?? undefined
    ),
    getPendingReportSubmissions(10, instance.id),
  ]);

  const getTeamNameById = (teamId?: number | null) => {
    if (!teamId) return "Not set";
    return teams.find((team) => team.id === teamId)?.teamName ?? `Unknown Team (${teamId})`;
  };

  // ✅ CLEAN TEAM DISPLAY (FIXED)
    const teamLabel =
    teams.length > 0
      ? teams
          .map((team) => {
            const normalizedStatus = String(team.checkInStatus)
              .trim()
              .toUpperCase()
              .replace(/\s+/g, "_");

            const isCheckedIn = normalizedStatus === "CHECKED_IN";
            const statusIcon = isCheckedIn ? "✅" : "❌";
            const statusText = isCheckedIn ? "Checked In" : "Not Checked In";

            return `${statusIcon} ${team.teamName} — ${statusText}`;
          })
          .join("\n")
      : "No teams assigned.";
  const assignmentLabel =
    assignments.length > 0
      ? assignments
          .map(
            (assignment) =>
              `${formatCycleLabel(assignment.cycleNumber)} ${formatEnumLabel(
                assignment.stageName
              )}: ${assignment.teamName} vs ${assignment.opponentTeamName}`
          )
          .join("\n")
      : "No match assignments yet.";

  const officialLabel =
    officialResults.length > 0
      ? officialResults
          .map(
            (result) =>
              `Cycle ${result.cycleNumber}: ${result.score.replace(/_/g, "-")}`
          )
          .join("\n")
      : "No official results entered.";

  const standingsLabel =
    standings.length > 0
      ? standings
          .map(
            (standing) =>
              `${standing.teamName}: ${standing.frp} FRP`
          )
          .join("\n")
      : "No standings yet.";

  const placementLabel = placements
    ? [
        `1st - ${getTeamNameById(placements.firstPlaceTeamId)}`,
        `2nd - ${getTeamNameById(placements.secondPlaceTeamId)}`,
        `3rd - ${getTeamNameById(placements.thirdPlaceTeamId)}`,
        `4th - ${getTeamNameById(placements.fourthPlaceTeamId)}`,
      ].join("\n")
    : "Not entered";

  const embed = new EmbedBuilder()
    .setTitle(`Tournament Panel: ${getTournamentInstanceLabel(instance)}`)
    .setDescription("Instance-scoped control panel for a 4-team tournament.")
    .addFields(
      { name: "Status", value: formatEnumLabel(instance.status), inline: true },
      { name: "Current Cycle", value: `${instance.currentCycle ?? "-"}`, inline: true },
      {
        name: "Current Stage",
        value: formatEnumLabel(instance.currentStage),
        inline: true,
      },
      {
        name: "Checked In Teams",
        value: `${checkedInCount}/${instance.maxTeams}`,
        inline: true,
      },
      { name: "Pending Results", value: `${pendingReports.length}`, inline: true },
      {
        name: "Winning Team",
        value: instance.winningTeamId
          ? getTeamNameById(instance.winningTeamId)
          : "-",
        inline: true,
      },
      { name: "Teams", value: teamLabel.slice(0, 1024), inline: false },
      {
        name: "Cashout Placements",
        value: placementLabel.slice(0, 1024),
        inline: false,
      },
      {
        name: "Final Round Matchups",
        value: assignmentLabel.slice(0, 1024),
        inline: false,
      },
      {
        name: "Official Results",
        value: officialLabel.slice(0, 1024),
        inline: false,
      },
      { name: "Standings", value: standingsLabel.slice(0, 1024), inline: false }
    );

  const showCheckInButtons = instance.currentCycle === null;

  const rowOneButtons: ButtonBuilder[] = [];

  if (showCheckInButtons) {
    rowOneButtons.push(
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:open_checkin`)
        .setLabel("Open Check-In")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:close_checkin`)
        .setLabel("Close Check-In")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  rowOneButtons.push(
    new ButtonBuilder()
      .setCustomId(`tournament:${instance.id}:start_cycle_1`)
      .setLabel("Start Cycle 1")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`tournament:${instance.id}:enter_cashout`)
      .setLabel("Enter Cashout Placements")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`tournament:${instance.id}:enter_score`)
      .setLabel("Enter Final Round Score")
      .setStyle(ButtonStyle.Primary)
  );

  const rowOne = new ActionRowBuilder<ButtonBuilder>().addComponents(rowOneButtons);

  const rowTwo = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tournament:${instance.id}:review_pending_results`)
      .setLabel("Review Pending Results")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`tournament:${instance.id}:finalize_cycle`)
      .setLabel("Finalize Cycle")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`tournament:${instance.id}:start_cycle_2`)
      .setLabel("Start Cycle 2")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`tournament:${instance.id}:start_cycle_3`)
      .setLabel("Start Cycle 3")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`tournament:${instance.id}:finish`)
      .setLabel("Finish Tournament")
      .setStyle(ButtonStyle.Success)
  );

  const rowThree = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tournament:${instance.id}:refresh`)
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("tournament:change_instance")
      .setLabel("Change Instance")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [rowOne, rowTwo, rowThree],
  };
}

export async function getTournamentInstanceOptions(guildId: string) {
  const instances = await listTournamentInstancesForGuild(guildId);
  return instances.map((instance) => ({
    label: getTournamentInstanceLabel(instance),
    value: `${instance.id}`,
  }));
}
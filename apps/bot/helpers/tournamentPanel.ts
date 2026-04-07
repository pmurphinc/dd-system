import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { TournamentStage } from "@prisma/client";
import { getCashoutPlacementForCycle } from "../storage/cashoutPlacements";
import { listMatchAssignmentsForTournamentInstance } from "../storage/matchAssignments";
import { listOfficialResultsForTournamentInstance } from "../storage/officialMatchResults";
import { listCurrentStageTeamSubmissions } from "../storage/reportSubmissions";
import { getStandingsForTournamentInstance } from "../storage/standings";
import {
  countCheckedInTeamsForInstance,
  getTournamentInstanceById,
  getTournamentInstanceLabel,
  listTournamentInstancesForGuild,
  syncTournamentInstancesForGuild,
} from "../storage/tournamentInstances";
import { listImportedTeamsForTournamentInstance } from "../storage/teams";
import {
  ensureStageMapAssigned,
  getCashoutAssignedMapForCycle,
  normalizeMapBan,
} from "../storage/tournamentMaps";
import { isCheckInOpen } from "./tournamentAccess";
import { getAvailableTournamentPanelActions } from "./tournamentActionVisibility";

function formatEnumLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCycleLabel(cycle: number | null | undefined): string {
  return cycle ? `Cycle ${cycle}` : "Cycle -";
}

function formatSubmissionStatus(status: string): string {
  if (status === "reviewed") return "approved";
  if (status === "pending") return "pending";
  return "rejected";
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

  const currentCycle = instance.currentCycle ?? undefined;

  const [
    teams,
    checkedInCount,
    standings,
    placements,
    assignments,
    officialResults,
    stageSubmissions,
  ] = await Promise.all([
    listImportedTeamsForTournamentInstance(instance.id),
    countCheckedInTeamsForInstance(instance.id),
    getStandingsForTournamentInstance(instance.id),
    instance.currentCycle
      ? getCashoutPlacementForCycle(instance.id, instance.currentCycle)
      : Promise.resolve(null),
    listMatchAssignmentsForTournamentInstance(instance.id, currentCycle),
    listOfficialResultsForTournamentInstance(instance.id, currentCycle),
    instance.currentCycle &&
    (instance.currentStage === TournamentStage.CASHOUT ||
      instance.currentStage === TournamentStage.FINAL_ROUND)
      ? listCurrentStageTeamSubmissions(
          instance.id,
          instance.currentCycle,
          instance.currentStage
        )
      : Promise.resolve([]),
  ]);

  const pendingCount = stageSubmissions.filter((row: { status: string }) => row.status === "pending").length;
  const approvedCount = stageSubmissions.filter((row: { status: string }) => row.status === "reviewed").length;
  const cashoutMapEnsureResult =
    instance.currentCycle !== null && instance.currentStage === TournamentStage.CASHOUT
      ? await ensureStageMapAssigned({
      tournamentInstanceId: instance.id,
      cycleNumber: instance.currentCycle,
      stage: TournamentStage.CASHOUT,
        })
      : null;
  if (cashoutMapEnsureResult) {
    console.log(
      `[tournament-panel-map] instance=${instance.id} cycle=${instance.currentCycle} ensureStatus=${cashoutMapEnsureResult.status} map=${cashoutMapEnsureResult.assignedMap ?? "<none>"}`
    );
  }
  const cashoutAssignedMap =
    instance.currentCycle !== null
      ? await getCashoutAssignedMapForCycle(instance.id, instance.currentCycle)
      : null;
  const cashoutAssignedMapLabel =
    cashoutAssignedMap ??
    (cashoutMapEnsureResult?.status === "no_legal_maps"
      ? "No legal maps remain (check bans)"
      : "Not assigned");

  const getTeamNameById = (teamId?: number | null) => {
    if (!teamId) return "Not set";
    return teams.find((team: { id: number; teamName: string }) => team.id === teamId)?.teamName ?? `Unknown Team (${teamId})`;
  };

  const teamLabel =
    teams.length > 0
      ? teams
          .map((team: { checkInStatus: string; mapBan: string | null; teamName: string }) => {
            console.log(
              `[tournament-panel-map] team=${team.teamName} mapBan=${team.mapBan ?? "<null>"}`
            );
            const normalizedStatus = String(team.checkInStatus)
              .trim()
              .toUpperCase()
              .replace(/\s+/g, "_");

            const isCheckedIn = normalizedStatus === "CHECKED_IN";
            const statusIcon = isCheckedIn ? "✅" : "❌";
            const statusText = isCheckedIn ? "Checked In" : "Not Checked In";

            const teamBan = normalizeMapBan(team.mapBan);
            return `${statusIcon} ${team.teamName} — ${statusText} | Ban: ${teamBan ?? "Missing"}`;
          })
          .join("\n")
      : "No teams assigned.";

  const assignmentLabel =
    assignments.length > 0
      ? assignments
          .map(
            (assignment: { cycleNumber: number; stageName: string; teamName: string; opponentTeamName: string; assignedMap: string | null }) =>
              `${formatCycleLabel(assignment.cycleNumber)} ${formatEnumLabel(
                assignment.stageName
              )}: ${assignment.teamName} vs ${assignment.opponentTeamName} | Map: ${assignment.assignedMap ?? "Not assigned"}`
          )
          .join("\n")
      : "No match assignments yet.";

  const officialLabel =
    officialResults.length > 0
      ? officialResults
          .map(
            (result: { cycleNumber: number; score: string }) =>
              `Cycle ${result.cycleNumber}: ${result.score.replace(/_/g, "-")}`
          )
          .join("\n")
      : "No official results entered.";

  const standingsLabel =
    standings.length > 0
      ? standings.map((standing: { teamName: string; frp: number }) => `${standing.teamName}: ${standing.frp} FRP`).join("\n")
      : "No standings yet.";

  const placementLabel = placements
    ? [
        `1st - ${getTeamNameById(placements.firstPlaceTeamId)}`,
        `2nd - ${getTeamNameById(placements.secondPlaceTeamId)}`,
        `3rd - ${getTeamNameById(placements.thirdPlaceTeamId)}`,
        `4th - ${getTeamNameById(placements.fourthPlaceTeamId)}`,
      ].join("\n")
    : "Not entered";

  const stageSubmissionsLabel =
    instance.currentStage === TournamentStage.FINAL_ROUND
      ? assignments.length > 0
        ? assignments
            .map((assignment: {
              id: number;
              teamId: number | null;
              opponentTeamId: number | null;
              teamName: string;
              opponentTeamName: string;
            }) => {
              const teamSub = stageSubmissions.find(
                (submission: { teamId: number | null }) =>
                  submission.teamId === assignment.teamId
              );
              const opponentSub = stageSubmissions.find(
                (submission: { teamId: number | null }) =>
                  submission.teamId === assignment.opponentTeamId
              );
              const teamFrp = teamSub
                ? `${teamSub.score} FRP (${formatSubmissionStatus(teamSub.status)})`
                : "none";
              const opponentFrp = opponentSub
                ? `${opponentSub.score} FRP (${formatSubmissionStatus(opponentSub.status)})`
                : "none";
              const hasOfficial = officialResults.some(
                (result: { matchAssignmentId: number }) =>
                  result.matchAssignmentId === assignment.id
              );

              return [
                `${assignment.teamName}: ${teamFrp}`,
                `${assignment.opponentTeamName}: ${opponentFrp}`,
                `Status: ${hasOfficial ? "already approved / official result exists" : "review in Final Round panel"}`,
              ].join("\n");
            })
            .join("\n\n")
        : "No Final Round matchups for current cycle."
      : stageSubmissions.length > 0
        ? stageSubmissions
            .map(
              (submission: { teamName: string; score: string; status: string }) =>
                `${submission.teamName}: ${submission.score} (${submission.status})`
            )
            .join("\n")
        : "No team submissions for current stage.";
  const missingBanTeams = teams.filter((team: { mapBan: string | null }) => !normalizeMapBan(team.mapBan));

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
      {
        name: "Pending Team Submissions",
        value: `${pendingCount}`,
        inline: true,
      },
      {
        name: "Approved Team Submissions",
        value: `${approvedCount}`,
        inline: true,
      },
      {
        name: "Cashout Assigned Map",
        value: cashoutAssignedMapLabel,
        inline: true,
      },
      {
        name: "Map Ban Issues",
        value:
          missingBanTeams.length > 0
            ? missingBanTeams.map((team: { teamName: string }) => team.teamName).join(", ").slice(0, 1024)
            : "None",
        inline: false,
      },
      {
        name: "Winning Team",
        value: instance.winningTeamId
          ? getTeamNameById(instance.winningTeamId)
          : "-",
        inline: true,
      },
      { name: "Teams", value: teamLabel.slice(0, 1024), inline: false },
      {
        name: "Approved Cashout Placements",
        value: placementLabel.slice(0, 1024),
        inline: false,
      },
      {
        name: "Final Round Matchups",
        value: assignmentLabel.slice(0, 1024),
        inline: false,
      },
      {
        name: "Current Stage Team Submissions",
        value: stageSubmissionsLabel.slice(0, 1024),
        inline: false,
      },
      {
        name: "Official Results",
        value: officialLabel.slice(0, 1024),
        inline: false,
      },
      { name: "Standings", value: standingsLabel.slice(0, 1024), inline: false }
    );

  const reviewedStageSubmissions = stageSubmissions.filter(
    (row: { status: string }) => row.status === "reviewed"
  );
  const hasCashoutAdvancementData =
    instance.currentStage === TournamentStage.CASHOUT &&
    reviewedStageSubmissions.length === 4 &&
    Boolean(placements);

  const availableActions = getAvailableTournamentPanelActions({
    status: instance.status,
    currentStage: instance.currentStage,
    currentCycle: instance.currentCycle,
    isCheckInOpen: isCheckInOpen(instance),
    checkedInCount,
    maxTeams: instance.maxTeams,
    hasUncheckedTeams: checkedInCount < instance.maxTeams,
    hasCashoutAdvancementData,
    finalRoundOfficialResultsCount: officialResults.filter(
      (result: { status?: string }) => (result.status ?? "active") === "active"
    ).length,
  });

  const adminButtons: ButtonBuilder[] = [];

  if (availableActions.canOpenCheckIn) {
    adminButtons.push(
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:open_checkin`)
        .setLabel("Open Check-In")
        .setStyle(ButtonStyle.Success)
    );
  }

  if (availableActions.canCloseCheckIn) {
    adminButtons.push(
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:close_checkin`)
        .setLabel("Close Check-In")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (availableActions.canForceCheckIn) {
    adminButtons.push(
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:force_checkin`)
        .setLabel("Force Check-In")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (availableActions.canStartCycle1) {
    adminButtons.push(
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:start_cycle_1`)
        .setLabel("Start Cycle 1")
        .setStyle(ButtonStyle.Primary)
    );
  }

  if (availableActions.canReviewTeamSubmissions) {
    adminButtons.push(
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:review_team_submissions`)
        .setLabel("Review Team Submissions")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (availableActions.canStartFinalRound) {
    adminButtons.push(
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:start_final_round`)
        .setLabel("Start Final Round")
        .setStyle(ButtonStyle.Primary)
    );
  }

  if (availableActions.canApproveFinalRoundStage) {
    adminButtons.push(
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:approve_final_round_stage`)
        .setLabel("Approve Final Round Stage")
        .setStyle(ButtonStyle.Primary)
    );
  }

  if (availableActions.canFinalizeCycle) {
    adminButtons.push(
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:finalize_cycle`)
        .setLabel("Finalize Cycle")
        .setStyle(ButtonStyle.Primary)
    );
  }

  if (availableActions.canStartCycle2) {
    adminButtons.push(
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:start_cycle_2`)
        .setLabel("Start Cycle 2")
        .setStyle(ButtonStyle.Primary)
    );
  }

  if (availableActions.canStartCycle3) {
    adminButtons.push(
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:start_cycle_3`)
        .setLabel("Start Cycle 3")
        .setStyle(ButtonStyle.Primary)
    );
  }

  if (availableActions.canFinishTournament) {
    adminButtons.push(
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:finish`)
        .setLabel("Finish Tournament")
        .setStyle(ButtonStyle.Success)
    );
  }

  if (availableActions.canRestartTournament) {
    adminButtons.push(
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:restart_tournament`)
        .setLabel("Restart Tournament")
        .setStyle(ButtonStyle.Danger)
    );
  }

  if (availableActions.canRefresh) {
    adminButtons.push(
      new ButtonBuilder()
        .setCustomId(`tournament:${instance.id}:refresh`)
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  if (availableActions.canChangeInstance) {
    adminButtons.push(
      new ButtonBuilder()
        .setCustomId("tournament:change_instance")
        .setLabel("Change Instance")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  const components: Array<ActionRowBuilder<ButtonBuilder>> = [];
  for (let index = 0; index < adminButtons.length; index += 5) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(adminButtons.slice(index, index + 5))
    );
  }

  return {
    embeds: [embed],
    components,
  };
}

export async function getTournamentInstanceOptions(guildId: string) {
  const instances = await listTournamentInstancesForGuild(guildId);
  return instances.map((instance) => ({
    label: getTournamentInstanceLabel(instance),
    value: `${instance.id}`,
  }));
}

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { SavedPanelType, TournamentStage } from "@prisma/client";
import { buildTeamPanel } from "../helpers/teamPanel";
import {
  getAvailableTeamPanelActions,
  getAvailableTournamentPanelActions,
} from "../helpers/tournamentActionVisibility";
import { isCheckInOpen } from "../helpers/tournamentAccess";
import {
  buildTournamentInstancePicker,
  buildTournamentPanel,
} from "../helpers/tournamentPanel";
import {
  getTeamLeaderAccessDebug,
  hasAdminInteractionAccess,
} from "../helpers/permissions";
import {
  getCashoutPlacementForCycle,
  upsertCashoutPlacement,
} from "../storage/cashoutPlacements";
import {
  getMatchAssignmentById,
  listMatchAssignmentsForTournamentInstance,
} from "../storage/matchAssignments";
import {
  getOfficialResultByMatchAssignmentId,
  listOfficialResultsForTournamentInstance,
  recordOfficialMatchResult,
  voidOfficialMatchResult,
} from "../storage/officialMatchResults";
import {
  approveTeamStageSubmission,
  computeReservedCashoutPlacements,
  createOrUpdateTeamStageSubmission,
  getCurrentTeamStageSubmission,
  getReportSubmissionById,
  getTeamStageSubmissionType,
  listCurrentStageTeamSubmissions,
  reconcileFinalRoundFrpPair,
  rejectTeamStageSubmission,
} from "../storage/reportSubmissions";
import {
  assignFinalRoundMapsIfMissing,
} from "../storage/tournamentMaps";
import {
  closeTournamentCheckIn,
  countCheckedInTeamsForInstance,
  finalizeTournamentCycle,
  finishTournamentInstance,
  getTournamentInstanceById,
  handleTournamentLeaderCheckIn,
  openTournamentCheckIn,
  reopenTournamentCheckIn,
  reopenTournamentCycle,
  restartTournamentInstance,
  setTournamentInstanceFinalRoundReady,
  startTournamentCycle,
} from "../storage/tournamentInstances";
import {
  getTeamById,
  getTeamByTournamentInstanceAndName,
  listImportedTeamsForTournamentInstance,
  setTeamCheckInStatus,
} from "../storage/teams";
import {
  createAdminChildFlowContext,
  deleteAdminChildFlowContext,
  getAdminChildFlowContext,
} from "../storage/adminFlowContext";
import { pushTournamentWebhookUpdate } from "../services/tournamentWebhook";
import {
  buildPanelScopeKey,
  isStalePanelInteraction,
  rejectStalePanelInteraction,
  rememberPanelInstance,
  replaceOrEditPanelByScopeFromSelector,
  replaceOrEditPanelFromInteraction,
} from "../services/panelLifecycle";

type TeamButtonAction =
  | "checkin"
  | "submit_cashout"
  | "edit_cashout"
  | "submit_final_round"
  | "edit_final_round";

type TournamentPanelAction =
  | "open_checkin"
  | "close_checkin"
  | "start_cycle_1"
  | "force_checkin"
  | "review_team_submissions"
  | "finalize_cycle"
  | "start_final_round"
  | "start_cycle_2"
  | "start_cycle_3"
  | "finish"
  | "restart_tournament"
  | "approve_final_round_stage"
  | "refresh";

const STALE_ACTION_MESSAGE =
  "This action is no longer available for the current tournament stage. Refresh the panel and try again.";


function parseTournamentButton(customId: string) {
  const [, instanceIdRaw, action] = customId.split(":");
  return {
    instanceId: Number(instanceIdRaw),
    action,
  };
}

function parseTeamButton(customId: string): {
  action: TeamButtonAction;
  instanceId: number;
  teamId: number;
} {
  const [, action, instanceIdRaw, teamIdRaw] = customId.split(":");
  return {
    action: action as TeamButtonAction,
    instanceId: Number(instanceIdRaw),
    teamId: Number(teamIdRaw),
  };
}

function parseFiniteNumber(raw: string | undefined): number | null {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function getTournamentActionAvailabilityKey(
  action: TournamentPanelAction
): keyof ReturnType<typeof getAvailableTournamentPanelActions> | null {
  if (action === "open_checkin") return "canOpenCheckIn";
  if (action === "close_checkin") return "canCloseCheckIn";
  if (action === "force_checkin") return "canForceCheckIn";
  if (action === "start_cycle_1") return "canStartCycle1";
  if (action === "start_cycle_2") return "canStartCycle2";
  if (action === "start_cycle_3") return "canStartCycle3";
  if (action === "review_team_submissions") return "canReviewTeamSubmissions";
  if (action === "start_final_round") return "canStartFinalRound";
  if (action === "approve_final_round_stage") return "canApproveFinalRoundStage";
  if (action === "finalize_cycle") return "canFinalizeCycle";
  if (action === "finish") return "canFinishTournament";
  if (action === "restart_tournament") return "canRestartTournament";
  if (action === "refresh") return "canRefresh";
  return null;
}

function getTeamActionAvailabilityKey(
  action: TeamButtonAction
): keyof ReturnType<typeof getAvailableTeamPanelActions> | null {
  if (action === "checkin") return "canCheckIn";
  if (action === "submit_cashout") return "canSubmitCashout";
  if (action === "edit_cashout") return "canEditCashout";
  if (action === "submit_final_round") return "canSubmitFinalRound";
  if (action === "edit_final_round") return "canEditFinalRound";
  return null;
}


function evaluateExactTeamMembership(
  userId: string,
  team: NonNullable<Awaited<ReturnType<typeof getTeamById>>>,
  roleIds: Set<string>
) {
  const matchesStoredLeaderId =
    Boolean(team.leaderDiscordUserId) && team.leaderDiscordUserId === userId;
  const matchesRosterMemberId = team.members.some(
    (member) => member.discordUserId === userId
  );
  const hasTeamRole = team.discordRoleId ? roleIds.has(team.discordRoleId) : false;
  const isMemberOfExactTeam =
    matchesStoredLeaderId || matchesRosterMemberId || hasTeamRole;

  return {
    matchesStoredLeaderId,
    matchesRosterMemberId,
    hasTeamRole,
    isMemberOfExactTeam,
  };
}

function logTeamAccessFailure(params: {
  reason: string;
  userId: string;
  instanceId: number;
  buttonTeamId: number;
  targetTeamId: number | null;
  targetTeamName: string | null;
  isMemberOfExactTeam: boolean;
  isLeader: boolean;
}) {
  console.warn("[team-button-access-denied]", params);
}

function formatStageSubmissionStatus(status: string): string {
  if (status === "pending") return "pending";
  if (status === "reviewed") return "approved";
  return "rejected";
}

function truncateButtonLabel(label: string, maxLength = 80): string {
  if (label.length <= maxLength) {
    return label;
  }

  return `${label.slice(0, maxLength - 1)}…`;
}

async function buildForceCheckInReply(params: {
  instanceId: number;
  guildId: string;
  actorDiscordUserId: string;
  sourcePanelScopeKey: string;
}) {
  const { instanceId, guildId, actorDiscordUserId, sourcePanelScopeKey } = params;
  const teams = await listImportedTeamsForTournamentInstance(instanceId);
  const uncheckedTeams = teams.filter((team) => team.checkInStatus !== "Checked In");

  if (uncheckedTeams.length === 0) {
    return null;
  }

  const flow = createAdminChildFlowContext({
    type: "force_checkin",
    guildId,
    actorDiscordUserId,
    tournamentInstanceId: instanceId,
    sourcePanelScopeKey,
  });
  console.debug("[force-checkin-flow] created", {
    flowId: flow.id,
    guildId,
    actorDiscordUserId,
    tournamentInstanceId: instanceId,
    sourcePanelScopeKey,
    expiresAt: flow.expiresAt.toISOString(),
    teamCount: uncheckedTeams.length,
  });

  const rows = uncheckedTeams.map((team) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`tournament:force_checkin_flow:${flow.id}:${team.id}`)
        .setLabel(truncateButtonLabel(team.teamName))
        .setStyle(ButtonStyle.Primary)
    )
  );

  return {
    content: "Select a team to force check in.",
    components: rows,
  };
}

async function buildCashoutTeamSelectReply(
  instanceId: number,
  teamId: number,
  editing: boolean
) {
  const instance = await getTournamentInstanceById(instanceId);

  if (!instance || instance.currentCycle === null) {
    throw new Error("This tournament instance is not in an active cycle.");
  }

  if (instance.currentStage !== TournamentStage.CASHOUT) {
    throw new Error("Cashout submissions are only available during CASHOUT.");
  }

  const existing = await getCurrentTeamStageSubmission(
    instanceId,
    teamId,
    instance.currentCycle,
    TournamentStage.CASHOUT
  );

  if (existing?.status === "reviewed") {
    throw new Error("Your approved cashout placement is locked.");
  }

  if (editing && !existing) {
    throw new Error("No editable cashout submission exists for your team.");
  }

  const reservedPlacements = await computeReservedCashoutPlacements(
    instanceId,
    instance.currentCycle,
    teamId
  );

  const currentPlacement = existing ? Number(existing.score) : null;
  const options = [1, 2, 3, 4]
    .filter((placement) => !reservedPlacements.includes(placement) || placement === currentPlacement)
    .map((placement) => ({
      label: `${placement}${placement === 1 ? "st" : placement === 2 ? "nd" : placement === 3 ? "rd" : "th"}`,
      value: `${placement}`,
      default: currentPlacement === placement,
    }));

  if (options.length === 0) {
    throw new Error("No placements are available. Ask an admin to review/reopen submissions.");
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`team:cashout_select:${instanceId}:${teamId}`)
    .setPlaceholder("Select your team cashout placement")
    .addOptions(options);

  return {
    content: editing
      ? "Edit your pending/rejected cashout placement."
      : "Submit your team cashout placement.",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  };
}

async function buildFinalRoundTeamSelectReply(
  instanceId: number,
  teamId: number,
  editing: boolean
) {
  const instance = await getTournamentInstanceById(instanceId);

  if (!instance || instance.currentCycle === null) {
    throw new Error("This tournament instance is not in an active cycle.");
  }

  if (instance.currentStage !== TournamentStage.FINAL_ROUND) {
    throw new Error("Final Round submissions are only available during FINAL_ROUND.");
  }

  const assignment = (
    await listMatchAssignmentsForTournamentInstance(
      instanceId,
      instance.currentCycle,
      TournamentStage.FINAL_ROUND
    )
  ).find((row) => row.teamId === teamId || row.opponentTeamId === teamId);

  if (!assignment) {
    throw new Error("No Final Round assignment is available for your team.");
  }

  const existing = await getCurrentTeamStageSubmission(
    instanceId,
    teamId,
    instance.currentCycle,
    TournamentStage.FINAL_ROUND
  );

  if (existing?.status === "reviewed") {
    throw new Error("Your approved Final Round submission is locked.");
  }

  if (editing && !existing) {
    throw new Error("No editable Final Round submission exists for your team.");
  }

  const currentFrp = existing ? Number(existing.score) : null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`team:final_round_select:${instanceId}:${teamId}`)
    .setPlaceholder("Select your team Final Round FRP")
    .addOptions(
      [0, 1, 2].map((frp) => ({
        label: `${frp} FRP`,
        value: `${frp}`,
        default: currentFrp === frp,
      }))
    );

  return {
    content: editing
      ? "Edit your pending/rejected Final Round FRP submission."
      : "Submit your team Final Round FRP.",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  };
}

async function maybeAutoFinalizeCashoutStage(
  instanceId: number,
  actorDiscordUserId: string
): Promise<{ finalized: boolean }> {
  const instance = await getTournamentInstanceById(instanceId);

  if (!instance || instance.currentCycle === null) {
    return { finalized: false };
  }

  if (instance.currentStage !== TournamentStage.CASHOUT) {
    return { finalized: false };
  }

  const submissions = await listCurrentStageTeamSubmissions(
    instanceId,
    instance.currentCycle,
    TournamentStage.CASHOUT
  );

  const approved = submissions.filter((row) => row.status === "reviewed");
  if (approved.length !== 4) {
    return { finalized: false };
  }

  const values = approved.map((row) => Number(row.score));
  const uniqueValues = new Set(values);
  if (uniqueValues.size !== 4 || values.some((value) => ![1, 2, 3, 4].includes(value))) {
    return { finalized: false };
  }

  const sortedPlacements = [...values].sort((a, b) => a - b);
  if (sortedPlacements.join(",") !== "1,2,3,4") {
    return { finalized: false };
  }

  const byPlacement = new Map<number, number>();
  for (const submission of approved) {
    if (submission.teamId === null) {
      return { finalized: false };
    }

    byPlacement.set(Number(submission.score), submission.teamId);
  }

  await upsertCashoutPlacement({
    tournamentInstanceId: instanceId,
    cycleNumber: instance.currentCycle,
    firstPlaceTeamId: byPlacement.get(1)!,
    secondPlaceTeamId: byPlacement.get(2)!,
    thirdPlaceTeamId: byPlacement.get(3)!,
    fourthPlaceTeamId: byPlacement.get(4)!,
    actorDiscordUserId,
  });

  return { finalized: true };
}

function buildOfficialInputFromFrpPair(
  assignment: Awaited<ReturnType<typeof getMatchAssignmentById>>,
  teamFrp: number,
  opponentFrp: number,
  actorDiscordUserId: string
) {
  if (!assignment || assignment.teamId === null || assignment.opponentTeamId === null) {
    throw new Error("Final Round assignment is missing required team linkage.");
  }

  const reconciliation = reconcileFinalRoundFrpPair(teamFrp, opponentFrp);
  const winnerTeamId = reconciliation.winnerFromTeamSide
    ? assignment.teamId
    : assignment.opponentTeamId;

  return {
    tournamentInstanceId: assignment.tournamentInstanceId!,
    matchAssignmentId: assignment.id,
    round1WinnerTeamId: winnerTeamId,
    round2WinnerTeamId: winnerTeamId,
    round3Played: reconciliation.score === "2_1",
    round3WinnerTeamId:
      reconciliation.score === "2_1" ? winnerTeamId : undefined,
    enteredByDiscordUserId: actorDiscordUserId,
  };
}

async function approveFinalRoundStage(instanceId: number, actorDiscordUserId: string) {
  const instance = await getTournamentInstanceById(instanceId);

  if (!instance || instance.currentCycle === null) {
    throw new Error("This tournament instance is not in an active cycle.");
  }

  if (instance.currentStage !== TournamentStage.FINAL_ROUND) {
    throw new Error("Approve Final Round Stage is only available during FINAL_ROUND.");
  }

  const assignments = await listMatchAssignmentsForTournamentInstance(
    instanceId,
    instance.currentCycle,
    TournamentStage.FINAL_ROUND
  );

  if (assignments.length !== 2) {
    throw new Error("Both Final Round matchups must exist before approval.");
  }

  const submissions = await listCurrentStageTeamSubmissions(
    instanceId,
    instance.currentCycle,
    TournamentStage.FINAL_ROUND
  );

  for (const assignment of assignments) {
    if (assignment.teamId === null || assignment.opponentTeamId === null) {
      throw new Error("Final Round assignment has missing team linkage.");
    }

    const teamSub = submissions.find(
      (row) => row.teamId === assignment.teamId && row.status === "reviewed"
    );
    const opponentSub = submissions.find(
      (row) => row.teamId === assignment.opponentTeamId && row.status === "reviewed"
    );

    if (!teamSub || !opponentSub) {
      throw new Error(
        `Both teams in ${assignment.teamName} vs ${assignment.opponentTeamName} require approved submissions.`
      );
    }

    const existing = await getOfficialResultByMatchAssignmentId(assignment.id);
    if (existing?.status === "active") {
      continue;
    }

    await recordOfficialMatchResult(
      buildOfficialInputFromFrpPair(
        assignment,
        Number(teamSub.score),
        Number(opponentSub.score),
        actorDiscordUserId
      )
    );
  }
}

type FinalRoundMatchupReviewState =
  | "waiting_on_both_teams"
  | "invalid_pair"
  | "ready_to_approve"
  | "already_approved";

interface FinalRoundMatchupReview {
  assignmentId: number;
  teamAName: string;
  teamBName: string;
  teamASubmission: Awaited<
    ReturnType<typeof listCurrentStageTeamSubmissions>
  >[number] | null;
  teamBSubmission: Awaited<
    ReturnType<typeof listCurrentStageTeamSubmissions>
  >[number] | null;
  officialResultExists: boolean;
  validationStatus: FinalRoundMatchupReviewState;
}

function getLatestFinalRoundSubmission(
  submissions: Awaited<ReturnType<typeof listCurrentStageTeamSubmissions>>,
  teamId: number
) {
  const relevant = submissions
    .filter((row) => row.teamId === teamId)
    .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());

  const latest = relevant[0];
  if (!latest) {
    return null;
  }

  return latest.status === "dismissed" ? null : latest;
}

function getValidationStatusLabel(state: FinalRoundMatchupReviewState): string {
  if (state === "waiting_on_both_teams") return "waiting on both teams";
  if (state === "invalid_pair") return "invalid pair";
  if (state === "ready_to_approve") return "ready to approve";
  return "already approved / official result exists";
}

function formatSubmissionDisplay(
  submission: Awaited<ReturnType<typeof listCurrentStageTeamSubmissions>>[number] | null
): string {
  if (!submission) {
    return "none";
  }

  return `${submission.score} FRP (${formatStageSubmissionStatus(submission.status)})`;
}

function getMatchupValidationStatus(params: {
  teamSub: Awaited<ReturnType<typeof listCurrentStageTeamSubmissions>>[number] | null;
  opponentSub: Awaited<ReturnType<typeof listCurrentStageTeamSubmissions>>[number] | null;
  officialResultExists: boolean;
}): FinalRoundMatchupReviewState {
  const { teamSub, opponentSub, officialResultExists } = params;
  if (officialResultExists) {
    return "already_approved";
  }

  if (!teamSub || !opponentSub) {
    return "waiting_on_both_teams";
  }

  try {
    reconcileFinalRoundFrpPair(Number(teamSub.score), Number(opponentSub.score));
    return "ready_to_approve";
  } catch {
    return "invalid_pair";
  }
}

async function buildFinalRoundMatchupReviews(
  instanceId: number,
  cycleNumber: number
): Promise<FinalRoundMatchupReview[]> {
  const assignments = await listMatchAssignmentsForTournamentInstance(
    instanceId,
    cycleNumber,
    TournamentStage.FINAL_ROUND
  );
  const submissions = await listCurrentStageTeamSubmissions(
    instanceId,
    cycleNumber,
    TournamentStage.FINAL_ROUND
  );

  return Promise.all(
    assignments.map(async (assignment) => {
      if (assignment.teamId === null || assignment.opponentTeamId === null) {
        throw new Error("Final Round assignment has missing team linkage.");
      }

      const teamSub = getLatestFinalRoundSubmission(submissions, assignment.teamId);
      const opponentSub = getLatestFinalRoundSubmission(
        submissions,
        assignment.opponentTeamId
      );
      const official = await getOfficialResultByMatchAssignmentId(assignment.id);
      const officialResultExists = official?.status === "active";
      const validationStatus = getMatchupValidationStatus({
        teamSub,
        opponentSub,
        officialResultExists,
      });

      return {
        assignmentId: assignment.id,
        teamAName: assignment.teamName,
        teamBName: assignment.opponentTeamName,
        teamASubmission: teamSub,
        teamBSubmission: opponentSub,
        officialResultExists,
        validationStatus,
      };
    })
  );
}

function buildFinalRoundMatchupActionRow(
  instanceId: number,
  matchup: FinalRoundMatchupReview
) {
  const approvalDisabled = matchup.validationStatus !== "ready_to_approve";
  const rejectionDisabled = matchup.validationStatus === "already_approved";

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tournament:approve_matchup:${instanceId}:${matchup.assignmentId}`)
      .setLabel(`Approve ${matchup.teamAName} vs ${matchup.teamBName}`.slice(0, 80))
      .setStyle(ButtonStyle.Success)
      .setDisabled(approvalDisabled),
    new ButtonBuilder()
      .setCustomId(`tournament:reject_matchup:${instanceId}:${matchup.assignmentId}`)
      .setLabel("Reject Matchup")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(rejectionDisabled),
    new ButtonBuilder()
      .setCustomId(`tournament:${instanceId}:review_team_submissions`)
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function approveFinalRoundMatchup(
  instanceId: number,
  assignmentId: number,
  actorDiscordUserId: string
) {
  const instance = await getTournamentInstanceById(instanceId);

  if (!instance || instance.currentCycle === null) {
    throw new Error("This tournament instance is not in an active cycle.");
  }

  if (instance.currentStage !== TournamentStage.FINAL_ROUND) {
    throw new Error("Matchup approval is only available during FINAL_ROUND.");
  }

  const assignment = await getMatchAssignmentById(assignmentId);
  if (
    !assignment ||
    assignment.tournamentInstanceId !== instanceId ||
    assignment.stageName !== TournamentStage.FINAL_ROUND
  ) {
    throw new Error("Final Round matchup not found.");
  }

  if (assignment.teamId === null || assignment.opponentTeamId === null) {
    throw new Error("Final Round assignment has missing team linkage.");
  }

  const submissions = await listCurrentStageTeamSubmissions(
    instanceId,
    instance.currentCycle,
    TournamentStage.FINAL_ROUND
  );
  const teamSub = getLatestFinalRoundSubmission(submissions, assignment.teamId);
  const opponentSub = getLatestFinalRoundSubmission(
    submissions,
    assignment.opponentTeamId
  );

  if (!teamSub || !opponentSub) {
    throw new Error("Both teams must submit Final Round FRP before approving this matchup.");
  }

  try {
    reconcileFinalRoundFrpPair(Number(teamSub.score), Number(opponentSub.score));
  } catch {
    throw new Error(
      `Invalid Final Round FRP combination ${teamSub.score}-${opponentSub.score} for ${assignment.teamName} vs ${assignment.opponentTeamName}.`
    );
  }

  const existing = await getOfficialResultByMatchAssignmentId(assignment.id);
  if (existing?.status === "active") {
    throw new Error("This matchup already has an official result.");
  }

  await approveTeamStageSubmission(teamSub.id, actorDiscordUserId);
  await approveTeamStageSubmission(opponentSub.id, actorDiscordUserId);

  await recordOfficialMatchResult(
    buildOfficialInputFromFrpPair(
      assignment,
      Number(teamSub.score),
      Number(opponentSub.score),
      actorDiscordUserId
    )
  );
}

async function rejectFinalRoundMatchup(
  instanceId: number,
  assignmentId: number,
  actorDiscordUserId: string,
  reason: string
) {
  const instance = await getTournamentInstanceById(instanceId);

  if (!instance || instance.currentCycle === null) {
    throw new Error("This tournament instance is not in an active cycle.");
  }

  if (instance.currentStage !== TournamentStage.FINAL_ROUND) {
    throw new Error("Matchup rejection is only available during FINAL_ROUND.");
  }

  const assignment = await getMatchAssignmentById(assignmentId);
  if (!assignment || assignment.tournamentInstanceId !== instanceId) {
    throw new Error("Final Round matchup not found.");
  }

  if (assignment.teamId === null || assignment.opponentTeamId === null) {
    throw new Error("Final Round assignment has missing team linkage.");
  }

  const existing = await getOfficialResultByMatchAssignmentId(assignment.id);
  if (existing?.status === "active") {
    throw new Error("Cannot reject a matchup with an active official result.");
  }

  const submissions = await listCurrentStageTeamSubmissions(
    instanceId,
    instance.currentCycle,
    TournamentStage.FINAL_ROUND
  );
  const targetSubmissions = [assignment.teamId, assignment.opponentTeamId]
    .map((teamId) => getLatestFinalRoundSubmission(submissions, teamId))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (targetSubmissions.length === 0) {
    throw new Error("No current submissions were found for this matchup.");
  }

  for (const submission of targetSubmissions) {
    await rejectTeamStageSubmission(
      submission.id,
      actorDiscordUserId,
      reason || "Rejected in matchup review."
    );
  }
}

async function buildTeamSubmissionReviewReply(instanceId: number) {
  const instance = await getTournamentInstanceById(instanceId);

  if (!instance || instance.currentCycle === null) {
    throw new Error("This tournament instance is not in an active cycle.");
  }

  if (
    instance.currentStage !== TournamentStage.CASHOUT &&
    instance.currentStage !== TournamentStage.FINAL_ROUND
  ) {
    throw new Error("Review is available only in CASHOUT or FINAL_ROUND stages.");
  }

  if (instance.currentStage === TournamentStage.FINAL_ROUND) {
    const matchups = await buildFinalRoundMatchupReviews(instanceId, instance.currentCycle);

    if (matchups.length === 0) {
      return {
        embeds: [
          new EmbedBuilder()
            .setTitle("Final Round Matchup Review")
            .setDescription("No Final Round matchups found for current cycle."),
        ],
        components: [],
      };
    }

    const description = matchups
      .map((matchup, index) =>
        [
          `**Matchup ${index + 1}: ${matchup.teamAName} vs ${matchup.teamBName}**`,
          `• ${matchup.teamAName}: ${formatSubmissionDisplay(matchup.teamASubmission)}`,
          `• ${matchup.teamBName}: ${formatSubmissionDisplay(matchup.teamBSubmission)}`,
          `• Status: ${getValidationStatusLabel(matchup.validationStatus)}`,
        ].join("\n")
      )
      .join("\n\n");

    return {
      embeds: [
        new EmbedBuilder()
          .setTitle("Final Round Matchup Review")
          .setDescription(description),
      ],
      components: matchups.map((matchup) =>
        buildFinalRoundMatchupActionRow(instanceId, matchup)
      ),
    };
  }

  const submissions = await listCurrentStageTeamSubmissions(
    instanceId,
    instance.currentCycle,
    instance.currentStage
  );

  if (submissions.length === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle("Team Submissions")
          .setDescription("No team submissions found for current stage."),
      ],
      components: [],
    };
  }

  const submissionRows = submissions.map((submission) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`tournament:open_submission:${instanceId}:${submission.id}`)
        .setLabel(
          truncateButtonLabel(`${submission.teamName} (${submission.score})`)
        )
        .setStyle(ButtonStyle.Secondary)
    )
  );

  const components = [...submissionRows];

  if (instance.currentStage === TournamentStage.CASHOUT) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`tournament:approve_all_cashout_submissions:${instanceId}`)
          .setLabel("Approve All Submissions")
          .setStyle(ButtonStyle.Success)
      )
    );
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("Team Submissions")
        .setDescription(
          submissions
            .map(
              (submission) =>
                `${submission.teamName}: ${submission.score} (${formatStageSubmissionStatus(
                  submission.status
                )})`
            )
            .join("\n")
        ),
    ],
    components,
  };
}

function validateCashoutBulkApproval(
  submissions: Awaited<ReturnType<typeof listCurrentStageTeamSubmissions>>
) {
  if (submissions.length !== 4) {
    throw new Error(
      `Approve All Submissions requires 4 cashout submissions, found ${submissions.length}.`
    );
  }

  const nonApprovable = submissions.filter((submission) => submission.status !== "pending");
  if (nonApprovable.length > 0) {
    const details = nonApprovable
      .map((submission) => `${submission.teamName} (${formatStageSubmissionStatus(submission.status)})`)
      .join(", ");
    throw new Error(
      `Approve All Submissions only works when all 4 submissions are pending. Non-approvable submissions: ${details}.`
    );
  }

  const placements = submissions.map((submission) => Number(submission.score));
  const invalidPlacements = placements.filter((placement) => ![1, 2, 3, 4].includes(placement));
  if (invalidPlacements.length > 0) {
    throw new Error(
      `Approve All Submissions requires placement values 1, 2, 3, and 4. Invalid values: ${invalidPlacements.join(", ")}.`
    );
  }

  if (new Set(placements).size !== 4) {
    throw new Error(
      `Approve All Submissions requires unique placements 1, 2, 3, and 4. Received: ${placements.join(", ")}.`
    );
  }

  const sortedPlacements = [...placements].sort((a, b) => a - b);
  if (sortedPlacements.join(",") !== "1,2,3,4") {
    throw new Error(
      `Approve All Submissions requires the exact placement set 1, 2, 3, and 4. Received: ${sortedPlacements.join(", ")}.`
    );
  }
}

async function approveAllCashoutSubmissions(instanceId: number, actorDiscordUserId: string) {
  const instance = await getTournamentInstanceById(instanceId);

  if (!instance || instance.currentCycle === null) {
    throw new Error("This tournament instance is not in an active cycle.");
  }

  if (instance.currentStage !== TournamentStage.CASHOUT) {
    throw new Error("Approve All Submissions is only available during CASHOUT.");
  }

  const submissions = await listCurrentStageTeamSubmissions(
    instanceId,
    instance.currentCycle,
    TournamentStage.CASHOUT
  );

  validateCashoutBulkApproval(submissions);

  for (const submission of submissions) {
    await approveTeamStageSubmission(submission.id, actorDiscordUserId);
  }

  const { finalized } = await maybeAutoFinalizeCashoutStage(
    instanceId,
    actorDiscordUserId
  );
  if (!finalized) {
    throw new Error(
      "Cashout submissions were approved but automatic Cashout finalization did not complete."
    );
  }
}

function buildSubmissionActionRow(instanceId: number, submissionId: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tournament:approve_submission:${instanceId}:${submissionId}`)
      .setLabel("Approve Submission")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`tournament:reject_submission:${instanceId}:${submissionId}`)
      .setLabel("Reject Submission")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`tournament:${instanceId}:refresh`)
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildSubmissionReviewEmbed(
  submission: Awaited<ReturnType<typeof getReportSubmissionById>>
) {
  if (!submission) {
    return null;
  }

  const type = getTeamStageSubmissionType(submission) ?? "UNKNOWN";

  return new EmbedBuilder()
    .setTitle(`Submission #${submission.id}`)
    .setDescription(
      [
        `Team: ${submission.teamName}`,
        `Stage: ${submission.stageName}`,
        `Type: ${type}`,
        `Value: ${submission.score}`,
        `Status: ${formatStageSubmissionStatus(submission.status)}`,
        `Submitted by: ${submission.submittedByDisplayName}`,
      ].join("\n")
    );
}

export async function handleTournamentInstanceButton(
  interaction: ButtonInteraction
): Promise<boolean> {
  const deferEphemeralResponse = async () => {
    if (interaction.deferred || interaction.replied) {
      return;
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
  };

  if (interaction.customId === "tournament:change_instance") {
    if (!interaction.inCachedGuild()) {
      return true;
    }
    const tournamentScopeKey = buildPanelScopeKey(
      "tournament",
      interaction.guildId,
      interaction.user.id
    );
    if (await isStalePanelInteraction(interaction, tournamentScopeKey)) {
      await rejectStalePanelInteraction(interaction);
      return true;
    }

    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const picker = await buildTournamentInstancePicker(
      interaction.guildId,
      "tournament:select_instance"
    );
    await interaction.reply({
      ...picker,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (interaction.customId.startsWith("tournament:force_checkin_flow:")) {
    console.debug("[force-checkin-flow] selector clicked", {
      customId: interaction.customId,
      guildId: interaction.guildId,
      actorDiscordUserId: interaction.user.id,
    });
    console.debug("[force-checkin-flow] route matched before stale guard", {
      customId: interaction.customId,
    });
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    const [, , flowId, teamIdRaw] = interaction.customId.split(":");
    const teamId = parseFiniteNumber(teamIdRaw);

    if (!flowId || teamId === null) {
      await interaction.reply({
        content: "Invalid force check-in payload.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const flow = getAdminChildFlowContext(flowId);
    console.debug("[force-checkin-flow] token lookup", {
      flowId,
      found: Boolean(flow),
    });
    if (!flow || flow.type !== "force_checkin") {
      console.debug("[force-checkin-flow] validation failed", {
        flowId,
        reason: "missing_or_wrong_type",
      });
      await interaction.reply({
        content: "This force check-in selection expired. Please reopen it from the panel.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (
      flow.guildId !== interaction.guildId ||
      flow.actorDiscordUserId !== interaction.user.id
    ) {
      console.debug("[force-checkin-flow] validation failed", {
        flowId,
        reason: "guild_or_actor_mismatch",
        expectedGuildId: flow.guildId,
        actualGuildId: interaction.guildId,
        expectedActorDiscordUserId: flow.actorDiscordUserId,
        actualActorDiscordUserId: interaction.user.id,
      });
      await interaction.reply({
        content: "You cannot use this force check-in selection.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    console.debug("[force-checkin-flow] stale guard skipped for child-flow route", {
      flowId,
      sourcePanelScopeKey: flow.sourcePanelScopeKey,
    });

    const instanceId = flow.tournamentInstanceId;
    const instance = await getTournamentInstanceById(instanceId);
    if (!instance) {
      await interaction.reply({
        content: "Tournament instance not found.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const checkedInCount = await countCheckedInTeamsForInstance(instanceId);
    const availableActions = getAvailableTournamentPanelActions({
      status: instance.status,
      currentStage: instance.currentStage,
      currentCycle: instance.currentCycle,
      isCheckInOpen: isCheckInOpen(instance),
      checkedInCount,
      maxTeams: instance.maxTeams,
      hasUncheckedTeams: checkedInCount < instance.maxTeams,
      hasCashoutAdvancementData: false,
      finalRoundOfficialResultsCount: 0,
    });
    if (!availableActions.canForceCheckIn) {
      await interaction.reply({
        content: STALE_ACTION_MESSAGE,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    console.debug("[force-checkin-flow] validation passed", {
      flowId,
      tournamentInstanceId: instanceId,
      teamId,
    });

    try {
      await deferEphemeralResponse();
      await handleTournamentLeaderCheckIn(instanceId, teamId, interaction.user.id);
      deleteAdminChildFlowContext(flowId);
      console.debug("[force-checkin-flow] executed", {
        flowId,
        tournamentInstanceId: instanceId,
        teamId,
      });
      const panel = await buildTournamentPanel(instanceId);
      await interaction.editReply({
        content: "Team force checked in successfully.",
        ...panel,
      });
    } catch (error) {
      if (!interaction.deferred && !interaction.replied) {
        await deferEphemeralResponse();
      }
      await interaction.editReply({
        content: error instanceof Error ? error.message : "Force check-in failed.",
      });
    }

    return true;
  }

  if (
    interaction.customId.startsWith("tournament:") &&
    interaction.guildId &&
    !interaction.message.flags.has(MessageFlags.Ephemeral)
  ) {
    const tournamentScopeKey = buildPanelScopeKey(
      "tournament",
      interaction.guildId,
      interaction.user.id
    );
    if (await isStalePanelInteraction(interaction, tournamentScopeKey)) {
      await rejectStalePanelInteraction(interaction);
      return true;
    }
  }

  if (interaction.customId.startsWith("team:") && interaction.guildId) {
    const teamScopeKey = buildPanelScopeKey("team", interaction.guildId, interaction.user.id);
    if (await isStalePanelInteraction(interaction, teamScopeKey)) {
      await rejectStalePanelInteraction(interaction);
      return true;
    }
  }

  if (interaction.customId.startsWith("team:refresh:")) {
    if (!interaction.inCachedGuild()) {
      return true;
    }

    const teamId = parseFiniteNumber(interaction.customId.split(":")[2]);
    if (teamId === null) {
      await interaction.reply({
        content: "Invalid team refresh payload. Please refresh /team and try again.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const team = await getTeamById(teamId);

    if (!team) {
      await interaction.reply({
        content: "Team not found.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const panel = await buildTeamPanel(
      interaction.user.id,
      interaction.guildId,
      interaction.member.roles
    );
    await replaceOrEditPanelFromInteraction({
      interaction,
      scopeKey: buildPanelScopeKey("team", interaction.guildId, interaction.user.id),
      panelType: "team",
      panel,
      metadata: {
        ownerDiscordUserId: interaction.user.id,
        actorDiscordUserId: interaction.user.id,
        teamId: team.id,
        tournamentInstanceId: team.tournamentInstanceId ?? undefined,
      },
    });
    return true;
  }

  if (interaction.customId.startsWith("team:")) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "This action must be used inside the guild.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const { action, instanceId, teamId } = parseTeamButton(interaction.customId);
    if (!Number.isFinite(instanceId) || !Number.isFinite(teamId)) {
      await interaction.reply({
        content: "Invalid team action payload. Please refresh /team and try again.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const team = await getTeamById(teamId);

    if (!team || team.tournamentInstanceId !== instanceId) {
      logTeamAccessFailure({
        reason: !team ? "team_not_found" : "team_not_in_instance",
        userId: interaction.user.id,
        instanceId,
        buttonTeamId: teamId,
        targetTeamId: team?.id ?? null,
        targetTeamName: team?.teamName ?? null,
        isMemberOfExactTeam: false,
        isLeader: false,
      });
      await interaction.reply({
        content: "This team action is no longer valid. Please refresh /team and try again.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const membership = evaluateExactTeamMembership(
      interaction.user.id,
      team,
      new Set(interaction.member.roles.cache.keys())
    );
    if (!membership.isMemberOfExactTeam) {
      logTeamAccessFailure({
        reason: "not_member_of_exact_team",
        userId: interaction.user.id,
        instanceId,
        buttonTeamId: teamId,
        targetTeamId: team.id,
        targetTeamName: team.teamName,
        isMemberOfExactTeam: membership.isMemberOfExactTeam,
        isLeader: false,
      });
      await interaction.reply({
        content: "You do not belong to this tournament team.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const leaderAccess = await getTeamLeaderAccessDebug(
      interaction.guildId,
      interaction.member.roles,
      team,
      interaction.user.id
    );

    if (!leaderAccess.isLeader) {
      logTeamAccessFailure({
        reason: "not_leader_of_exact_team",
        userId: interaction.user.id,
        instanceId,
        buttonTeamId: teamId,
        targetTeamId: team.id,
        targetTeamName: team.teamName,
        isMemberOfExactTeam: membership.isMemberOfExactTeam,
        isLeader: leaderAccess.isLeader,
      });
      await interaction.reply({
        content: `Only the team leader can use this action. ${leaderAccess.note ?? ""}`.trim(),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const instance = await getTournamentInstanceById(instanceId);
    const currentStage = instance?.currentStage ?? null;
    const currentCycle = instance?.currentCycle ?? null;
    const currentSubmission =
      instance &&
      currentCycle &&
      (currentStage === TournamentStage.CASHOUT ||
        currentStage === TournamentStage.FINAL_ROUND)
        ? await getCurrentTeamStageSubmission(instance.id, team.id, currentCycle, currentStage)
        : null;
    const currentSubmissionType = currentSubmission
      ? getTeamStageSubmissionType(currentSubmission)
      : null;
    const finalRoundAssignments =
      instance && currentCycle && currentStage === TournamentStage.FINAL_ROUND
        ? await listMatchAssignmentsForTournamentInstance(
            instance.id,
            currentCycle,
            TournamentStage.FINAL_ROUND
          )
        : [];
    const hasCurrentStageAssignment = finalRoundAssignments.some(
      (row) => row.teamId === team.id || row.opponentTeamId === team.id
    );
    const availableTeamActions = getAvailableTeamPanelActions({
      isLeader: leaderAccess.isLeader,
      hasInstance: Boolean(instance),
      teamBelongsToInstance: team.tournamentInstanceId === instanceId,
      isCheckInOpen: isCheckInOpen(instance),
      isTeamCheckedIn: team.checkInStatus === "Checked In",
      currentStage,
      currentCycle,
      hasCurrentStageAssignment,
      hasCurrentStageSubmission: currentSubmission !== null,
      isCurrentStageSubmissionEditable:
        currentSubmission !== null && currentSubmission.status !== "reviewed",
      currentSubmissionType:
        currentSubmissionType === "CASHOUT_PLACEMENT" ||
        currentSubmissionType === "FINAL_ROUND_SCORE"
          ? currentSubmissionType
          : null,
    });
    const teamAvailabilityKey = getTeamActionAvailabilityKey(action);
    if (teamAvailabilityKey && !availableTeamActions[teamAvailabilityKey]) {
      await interaction.reply({
        content: STALE_ACTION_MESSAGE,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (action === "checkin") {
      try {
        console.log(
          `[checkin-path] type=normal instance=${instanceId} team=${team.id} user=${interaction.user.id}`
        );
        await deferEphemeralResponse();
        await handleTournamentLeaderCheckIn(instanceId, team.id, interaction.user.id);

        const panel = await buildTeamPanel(
          interaction.user.id,
          interaction.guildId,
          interaction.member.roles
        );

        await interaction.editReply({
          content:
            `${team.teamName} checked in successfully.\n` +
            `The tournament panel will reflect this on refresh.`,
          ...panel,
        });
      } catch (error) {
        if (!interaction.deferred && !interaction.replied) {
          await deferEphemeralResponse();
        }

        await interaction.editReply({
          content: error instanceof Error ? error.message : "Check-in failed.",
        });
      }
      return true;
    }

    if (action === "submit_cashout" || action === "edit_cashout") {
      try {
        const reply = await buildCashoutTeamSelectReply(
          instanceId,
          team.id,
          action === "edit_cashout"
        );

        await interaction.reply({
          ...reply,
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        await interaction.reply({
          content:
            error instanceof Error
              ? error.message
              : "Failed to open cashout submission flow.",
          flags: MessageFlags.Ephemeral,
        });
      }

      return true;
    }

    if (action === "submit_final_round" || action === "edit_final_round") {
      try {
        const reply = await buildFinalRoundTeamSelectReply(
          instanceId,
          team.id,
          action === "edit_final_round"
        );

        await interaction.reply({
          ...reply,
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        await interaction.reply({
          content:
            error instanceof Error
              ? error.message
              : "Failed to open final round submission flow.",
          flags: MessageFlags.Ephemeral,
        });
      }

      return true;
    }
  }

  if (!interaction.customId.startsWith("tournament:")) {
    return false;
  }

  // Every tournament:* interaction route is expected to flow through the same
  // shared admin helper so slash access and panel follow-ups stay aligned.
  if (!(await hasAdminInteractionAccess(interaction))) {
    await interaction.reply({
      content: "You do not have permission to use this action.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (interaction.customId.startsWith("tournament:approve_submission:")) {
    const [, , instanceIdRaw, submissionIdRaw] = interaction.customId.split(":");
    const instanceId = Number(instanceIdRaw);
    const submissionId = Number(submissionIdRaw);

    try {
      const approvedSubmission = await approveTeamStageSubmission(
        submissionId,
        interaction.user.id
      );
      const isCashoutApproval =
        getTeamStageSubmissionType(approvedSubmission) === "CASHOUT_PLACEMENT";
      const autoFinalizeResult = isCashoutApproval
        ? await maybeAutoFinalizeCashoutStage(instanceId, interaction.user.id)
        : { finalized: false };
      const review = await buildTeamSubmissionReviewReply(instanceId);
      await interaction.reply({
        content:
          isCashoutApproval && autoFinalizeResult.finalized
            ? "Team submission approved. Cashout stage auto-finalized and Final Round pairings are ready."
            : "Team submission approved.",
        ...review,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : "Failed to approve submission.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return true;
  }

  if (interaction.customId.startsWith("tournament:restart_tournament_confirm:")) {
    const [, , instanceIdRaw, actorDiscordUserId] = interaction.customId.split(":");
    const instanceId = Number(instanceIdRaw);

    if (actorDiscordUserId !== interaction.user.id) {
      await interaction.reply({
        content: "This confirmation is stale. Run Restart Tournament again from the panel.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    try {
      await deferEphemeralResponse();
      const updated = await restartTournamentInstance(instanceId, interaction.user.id);
      const panel = await buildTournamentPanel(updated.id);
      await interaction.editReply({
        content:
          `${updated.name} was restarted.\n` +
          `• Teams remained assigned to this instance.\n` +
          `• Team check-ins were cleared.\n` +
          `• FRP standings were reset to 0.\n` +
          `• Cycle/match submissions, placements, assignments, and results were cleared.`,
        ...panel,
      });
    } catch (error) {
      if (!interaction.deferred && !interaction.replied) {
        await deferEphemeralResponse();
      }

      await interaction.editReply({
        content:
          error instanceof Error
            ? error.message
            : "Failed to restart tournament progress for this instance.",
      });
    }

    return true;
  }

  if (interaction.customId.startsWith("tournament:restart_tournament_cancel:")) {
    const [, , instanceIdRaw, actorDiscordUserId] = interaction.customId.split(":");
    const instanceId = Number(instanceIdRaw);

    if (actorDiscordUserId !== interaction.user.id) {
      await interaction.reply({
        content: "This confirmation is stale. Run Restart Tournament again from the panel.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const panel = await buildTournamentPanel(instanceId);
    await interaction.reply({
      content: "Restart cancelled. No tournament data was changed.",
      ...panel,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (interaction.customId.startsWith("tournament:approve_all_cashout_submissions:")) {
    const [, , instanceIdRaw] = interaction.customId.split(":");
    const instanceId = Number(instanceIdRaw);

    try {
      await approveAllCashoutSubmissions(instanceId, interaction.user.id);
      const review = await buildTeamSubmissionReviewReply(instanceId);
      await interaction.reply({
        content:
          "All cashout submissions approved. Cashout stage auto-finalized and Final Round pairings are ready.",
        ...review,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error
            ? error.message
            : "Failed to approve all cashout submissions.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return true;
  }

  if (interaction.customId.startsWith("tournament:open_submission:")) {
    const [, , instanceIdRaw, submissionIdRaw] = interaction.customId.split(":");
    const instanceId = Number(instanceIdRaw);
    const submissionId = Number(submissionIdRaw);
    const submission = await getReportSubmissionById(submissionId);

    if (!submission) {
      await interaction.reply({
        content: "Submission not found.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const embed = buildSubmissionReviewEmbed(submission);
    await interaction.reply({
      embeds: embed ? [embed] : [],
      components: [buildSubmissionActionRow(instanceId, submissionId)],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (interaction.customId.startsWith("tournament:reject_submission:")) {
    const [, , instanceIdRaw, submissionIdRaw] = interaction.customId.split(":");
    const instanceId = Number(instanceIdRaw);
    const submissionId = Number(submissionIdRaw);

    const modal = new ModalBuilder()
      .setCustomId(`tournament:reject_submission_modal:${instanceId}:${submissionId}`)
      .setTitle("Reject Team Submission");

    const reasonInput = new TextInputBuilder()
      .setCustomId("reject_reason")
      .setLabel("Rejection reason")
      .setPlaceholder("Short reason shown in audit trail")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.customId.startsWith("tournament:approve_matchup:")) {
    const [, , instanceIdRaw, assignmentIdRaw] = interaction.customId.split(":");
    const instanceId = Number(instanceIdRaw);
    const assignmentId = Number(assignmentIdRaw);

    try {
      await approveFinalRoundMatchup(instanceId, assignmentId, interaction.user.id);
      const review = await buildTeamSubmissionReviewReply(instanceId);
      await interaction.reply({
        content: "Matchup approved and official result recorded.",
        ...review,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : "Failed to approve matchup.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return true;
  }

  if (interaction.customId.startsWith("tournament:reject_matchup:")) {
    const [, , instanceIdRaw, assignmentIdRaw] = interaction.customId.split(":");
    const instanceId = Number(instanceIdRaw);
    const assignmentId = Number(assignmentIdRaw);

    const modal = new ModalBuilder()
      .setCustomId(`tournament:reject_matchup_modal:${instanceId}:${assignmentId}`)
      .setTitle("Reject Final Round Matchup");

    const reasonInput = new TextInputBuilder()
      .setCustomId("reject_reason")
      .setLabel("Rejection reason")
      .setPlaceholder("Short reason shown in audit trail")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
    await interaction.showModal(modal);
    return true;
  }

  const { instanceId, action } = parseTournamentButton(interaction.customId);

  const tournamentAction = action as TournamentPanelAction;
  const tournamentAvailabilityKey = getTournamentActionAvailabilityKey(tournamentAction);
  if (tournamentAvailabilityKey) {
    const instance = await getTournamentInstanceById(instanceId);

    if (!instance) {
      await interaction.reply({
        content: "Tournament instance not found.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const checkedInCount = await countCheckedInTeamsForInstance(instanceId);
    const stageSubmissions =
      instance.currentCycle !== null &&
      (instance.currentStage === TournamentStage.CASHOUT ||
        instance.currentStage === TournamentStage.FINAL_ROUND)
        ? await listCurrentStageTeamSubmissions(
            instanceId,
            instance.currentCycle,
            instance.currentStage
          )
        : [];
    const placements =
      instance.currentCycle !== null
        ? await getCashoutPlacementForCycle(instanceId, instance.currentCycle)
        : null;
    const officialResults =
      instance.currentCycle !== null
        ? await listOfficialResultsForTournamentInstance(
            instanceId,
            instance.currentCycle
          )
        : [];

    const availableTournamentActions = getAvailableTournamentPanelActions({
      status: instance.status,
      currentStage: instance.currentStage,
      currentCycle: instance.currentCycle,
      isCheckInOpen: isCheckInOpen(instance),
      checkedInCount,
      maxTeams: instance.maxTeams,
      hasUncheckedTeams: checkedInCount < instance.maxTeams,
      hasCashoutAdvancementData:
        instance.currentStage === TournamentStage.CASHOUT &&
        stageSubmissions.filter((row) => row.status === "reviewed").length === 4 &&
        Boolean(placements),
      finalRoundOfficialResultsCount: officialResults.filter(
        (result: { status: string }) => result.status === "active"
      ).length,
    });

    if (!availableTournamentActions[tournamentAvailabilityKey]) {
      await interaction.reply({
        content: STALE_ACTION_MESSAGE,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
  }

  if (action === "refresh") {
    const panel = await buildTournamentPanel(instanceId);
    await replaceOrEditPanelFromInteraction({
      interaction,
      scopeKey: buildPanelScopeKey("tournament", interaction.guildId ?? "", interaction.user.id),
      panelType: "tournament",
      panel,
      metadata: {
        ownerDiscordUserId: interaction.user.id,
        actorDiscordUserId: interaction.user.id,
        tournamentInstanceId: instanceId,
      },
    });
    return true;
  }

  if (action === "open_checkin") {
    const updated = await openTournamentCheckIn(instanceId, interaction.user.id);
    const panel = await buildTournamentPanel(updated.id);
    await interaction.reply({
      content: `${updated.name} check-in is now open.`,
      ...panel,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === "close_checkin") {
    const updated = await closeTournamentCheckIn(instanceId, interaction.user.id);
    const panel = await buildTournamentPanel(updated.id);
    await interaction.reply({
      content: `${updated.name} check-in is now closed.`,
      ...panel,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (
    action === "start_cycle_1" ||
    action === "start_cycle_2" ||
    action === "start_cycle_3"
  ) {
    const cycleNumber = Number(action.split("_")[2]);

    try {
      await deferEphemeralResponse();
      const updated = await startTournamentCycle(
        instanceId,
        cycleNumber,
        interaction.user.id
      );
      const panel = await buildTournamentPanel(updated.id);
      await interaction.editReply({
        content: `${updated.name} is ready for cycle ${cycleNumber} cashout.`,
        ...panel,
      });
    } catch (error) {
      if (!interaction.deferred && !interaction.replied) {
        await deferEphemeralResponse();
      }

      await interaction.editReply({
        content: error instanceof Error ? error.message : "Failed to start cycle.",
      });
    }
    return true;
  }

  if (action === "review_team_submissions") {
    try {
      const review = await buildTeamSubmissionReviewReply(instanceId);
      await interaction.reply({
        ...review,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error
            ? error.message
            : "Failed to open team submissions review.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return true;
  }

  if (action === "force_checkin") {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "This action must be used inside the guild.",
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      const forceCheckInReply = await buildForceCheckInReply({
        instanceId,
        guildId: interaction.guildId,
        actorDiscordUserId: interaction.user.id,
        sourcePanelScopeKey: buildPanelScopeKey(
          "tournament",
          interaction.guildId,
          interaction.user.id
        ),
      });

      if (!forceCheckInReply) {
        await interaction.reply({
          content: "All teams are already checked in.",
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      await interaction.reply({
        ...forceCheckInReply,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error
            ? error.message
            : "Failed to load force check-in options.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return true;
  }

  if (action === "start_final_round") {
    try {
      await deferEphemeralResponse();
      const instance = await getTournamentInstanceById(instanceId);
      if (!instance || instance.currentCycle === null) {
        throw new Error("This tournament instance is not in an active cycle.");
      }

      if (instance.currentStage !== TournamentStage.CASHOUT) {
        throw new Error("Start Final Round is only available from CASHOUT stage.");
      }

      const placements = await listCurrentStageTeamSubmissions(
        instanceId,
        instance.currentCycle,
        TournamentStage.CASHOUT
      );
      const approved = placements.filter((row) => row.status === "reviewed");
      if (approved.length !== 4) {
        throw new Error("Start Final Round requires four approved cashout submissions.");
      }
      const officialPlacements = await getCashoutPlacementForCycle(
        instanceId,
        instance.currentCycle
      );
      let resolvedPlacements = officialPlacements;
      if (!resolvedPlacements) {
        await maybeAutoFinalizeCashoutStage(instanceId, interaction.user.id);
        resolvedPlacements = await getCashoutPlacementForCycle(
          instanceId,
          instance.currentCycle
        );
      }
      if (!resolvedPlacements) {
        throw new Error("Start Final Round requires valid approved cashout placements.");
      }
      const finalRoundAssignments = await listMatchAssignmentsForTournamentInstance(
        instanceId,
        instance.currentCycle,
        TournamentStage.FINAL_ROUND
      );
      if (finalRoundAssignments.length !== 2) {
        await upsertCashoutPlacement({
          tournamentInstanceId: instanceId,
          cycleNumber: instance.currentCycle,
          firstPlaceTeamId: resolvedPlacements.firstPlaceTeamId,
          secondPlaceTeamId: resolvedPlacements.secondPlaceTeamId,
          thirdPlaceTeamId: resolvedPlacements.thirdPlaceTeamId,
          fourthPlaceTeamId: resolvedPlacements.fourthPlaceTeamId,
          actorDiscordUserId: interaction.user.id,
        });
      }

      const updated = await setTournamentInstanceFinalRoundReady(
        instanceId,
        instance.currentCycle,
        interaction.user.id
      );
      await assignFinalRoundMapsIfMissing(instanceId, instance.currentCycle);

      const panel = await buildTournamentPanel(updated.id);
      await interaction.editReply({
        content: "Final Round started. Matchup maps assigned.",
        ...panel,
      });
    } catch (error) {
      if (!interaction.deferred && !interaction.replied) {
        await deferEphemeralResponse();
      }

      await interaction.editReply({
        content: error instanceof Error ? error.message : "Failed to start Final Round.",
      });
    }

    return true;
  }

  if (action === "approve_final_round_stage") {
    try {
      await deferEphemeralResponse();
      await approveFinalRoundStage(instanceId, interaction.user.id);
      const panel = await buildTournamentPanel(instanceId);
      await interaction.editReply({
        content: "Final Round stage approved. Official match results reconciled from team submissions.",
        ...panel,
      });
    } catch (error) {
      if (!interaction.deferred && !interaction.replied) {
        await deferEphemeralResponse();
      }

      await interaction.editReply({
        content:
          error instanceof Error ? error.message : "Failed to approve final round stage.",
      });
    }

    return true;
  }

  if (action === "finalize_cycle") {
    try {
      await deferEphemeralResponse();
      const updated = await finalizeTournamentCycle(instanceId, interaction.user.id);
      const panel = await buildTournamentPanel(updated.id);
      await interaction.editReply({
        content: `${updated.name} cycle ${updated.currentCycle} finalized.`,
        ...panel,
      });
    } catch (error) {
      if (!interaction.deferred && !interaction.replied) {
        await deferEphemeralResponse();
      }

      await interaction.editReply({
        content: error instanceof Error ? error.message : "Failed to finalize cycle.",
      });
    }
    return true;
  }

  if (action === "finish") {
    try {
      const updated = await finishTournamentInstance(instanceId, interaction.user.id);
      const panel = await buildTournamentPanel(updated.id);
      await interaction.reply({
        content:
          updated.status === "TIEBREAKER_READY"
            ? `${updated.name} is tied and now marked TIEBREAKER_READY.`
            : `${updated.name} has been finished.`,
        ...panel,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : "Failed to finish tournament.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return true;
  }

  if (action === "restart_tournament") {
    await interaction.reply({
      content:
        "⚠️ **Confirm Restart Tournament**\n" +
        "This will restart only this tournament instance run.\n\n" +
        "• Teams and instance membership will remain assigned.\n" +
        "• Team check-ins will be cleared.\n" +
        "• FRP/standings will be reset to 0.\n" +
        "• Cycle/match progress, placements, submissions, and results will be wiped.\n\n" +
        "**This cannot be undone.**",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(
              `tournament:restart_tournament_confirm:${instanceId}:${interaction.user.id}`
            )
            .setLabel("Confirm Restart Tournament")
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(
              `tournament:restart_tournament_cancel:${instanceId}:${interaction.user.id}`
            )
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary)
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === "emergency_override") {
    const modal = new ModalBuilder()
      .setCustomId(`tournament:override_modal:${instanceId}`)
      .setTitle("Emergency Override");

    const overrideAction = new TextInputBuilder()
      .setCustomId("override_action")
      .setLabel("Override action")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("reopen_checkin | clear_checkin | void_result | reopen_cycle")
      .setRequired(true);

    const overrideTarget = new TextInputBuilder()
      .setCustomId("override_target")
      .setLabel("Override target")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("team name, assignment ID, or cycle number")
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(overrideAction),
      new ActionRowBuilder<TextInputBuilder>().addComponents(overrideTarget)
    );
    await interaction.showModal(modal);
    return true;
  }

  return false;
}

export async function handleTournamentInstanceSelectMenu(
  interaction: StringSelectMenuInteraction
): Promise<boolean> {
  const deferEphemeralResponse = async () => {
    if (interaction.deferred || interaction.replied) {
      return;
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
  };

  if (interaction.customId === "tournament:select_instance") {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const instanceId = Number(interaction.values[0]);
    if (!interaction.guildId) {
      return true;
    }
    await rememberPanelInstance({
      guildId: interaction.guildId,
      discordUserId: interaction.user.id,
      panelType: SavedPanelType.tournament,
      tournamentInstanceId: instanceId,
    });
    const panel = await buildTournamentPanel(instanceId);
    await replaceOrEditPanelByScopeFromSelector({
      interaction,
      scopeKey: buildPanelScopeKey("tournament", interaction.guildId, interaction.user.id),
      panelType: "tournament",
      panel,
      metadata: {
        ownerDiscordUserId: interaction.user.id,
        actorDiscordUserId: interaction.user.id,
        tournamentInstanceId: instanceId,
      },
    });
    return true;
  }

  if (interaction.customId.startsWith("team:cashout_select:")) {
    if (!interaction.inCachedGuild()) {
      return true;
    }

    const [, , instanceIdRaw, teamIdRaw] = interaction.customId.split(":");
    const instanceId = parseFiniteNumber(instanceIdRaw);
    const teamId = parseFiniteNumber(teamIdRaw);
    if (instanceId === null || teamId === null) {
      await interaction.reply({
        content: "Invalid cashout selection payload. Please refresh /team and try again.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const team = await getTeamById(teamId);
    if (!team || team.tournamentInstanceId !== instanceId) {
      logTeamAccessFailure({
        reason: !team ? "cashout_select_team_not_found" : "cashout_select_team_not_in_instance",
        userId: interaction.user.id,
        instanceId,
        buttonTeamId: teamId,
        targetTeamId: team?.id ?? null,
        targetTeamName: team?.teamName ?? null,
        isMemberOfExactTeam: false,
        isLeader: false,
      });
      await interaction.reply({
        content: "This selection is no longer valid. Please refresh /team and try again.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const membership = evaluateExactTeamMembership(
      interaction.user.id,
      team,
      new Set(interaction.member.roles.cache.keys())
    );
    if (!membership.isMemberOfExactTeam) {
      logTeamAccessFailure({
        reason: "cashout_select_not_member",
        userId: interaction.user.id,
        instanceId,
        buttonTeamId: teamId,
        targetTeamId: team.id,
        targetTeamName: team.teamName,
        isMemberOfExactTeam: membership.isMemberOfExactTeam,
        isLeader: false,
      });
      await interaction.reply({
        content: "You do not belong to this tournament team.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const leaderAccess = await getTeamLeaderAccessDebug(
      interaction.guildId,
      interaction.member.roles,
      team,
      interaction.user.id
    );

    if (!leaderAccess.isLeader) {
      logTeamAccessFailure({
        reason: "cashout_select_not_leader",
        userId: interaction.user.id,
        instanceId,
        buttonTeamId: teamId,
        targetTeamId: team.id,
        targetTeamName: team.teamName,
        isMemberOfExactTeam: membership.isMemberOfExactTeam,
        isLeader: leaderAccess.isLeader,
      });
      await interaction.reply({
        content: "Only the team leader can submit results.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const instance = await getTournamentInstanceById(instanceId);

    if (!instance || instance.currentCycle === null) {
      await interaction.reply({
        content: "This tournament instance is not in an active cycle.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const placement = Number(interaction.values[0]);

    try {
      await deferEphemeralResponse();
      await createOrUpdateTeamStageSubmission({
        tournamentInstanceId: instanceId,
        teamId: team.id,
        teamName: team.teamName,
        opponentTeamName: "N/A",
        cycleNumber: instance.currentCycle,
        stageName: TournamentStage.CASHOUT,
        submissionType: "CASHOUT_PLACEMENT",
        value: placement,
        submittedByDiscordUserId: interaction.user.id,
        submittedByDisplayName:
          interaction.user.tag ?? interaction.user.globalName ?? interaction.user.username,
      });

      const panel = await buildTeamPanel(
        interaction.user.id,
        interaction.guildId,
        interaction.member.roles
      );

      await interaction.editReply({
        content: `Cashout placement ${placement} submitted for admin approval.`,
        ...panel,
      });
    } catch (error) {
      if (!interaction.deferred && !interaction.replied) {
        await deferEphemeralResponse();
      }

      await interaction.editReply({
        content:
          error instanceof Error
            ? error.message
            : "Failed to submit cashout placement.",
      });
    }

    return true;
  }

  if (interaction.customId.startsWith("team:final_round_select:")) {
    if (!interaction.inCachedGuild()) {
      return true;
    }

    const [, , instanceIdRaw, teamIdRaw] = interaction.customId.split(":");
    const instanceId = parseFiniteNumber(instanceIdRaw);
    const teamId = parseFiniteNumber(teamIdRaw);
    if (instanceId === null || teamId === null) {
      await interaction.reply({
        content: "Invalid final round selection payload. Please refresh /team and try again.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const team = await getTeamById(teamId);
    if (!team || team.tournamentInstanceId !== instanceId) {
      logTeamAccessFailure({
        reason: !team ? "final_round_select_team_not_found" : "final_round_select_team_not_in_instance",
        userId: interaction.user.id,
        instanceId,
        buttonTeamId: teamId,
        targetTeamId: team?.id ?? null,
        targetTeamName: team?.teamName ?? null,
        isMemberOfExactTeam: false,
        isLeader: false,
      });
      await interaction.reply({
        content: "This selection is no longer valid. Please refresh /team and try again.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const membership = evaluateExactTeamMembership(
      interaction.user.id,
      team,
      new Set(interaction.member.roles.cache.keys())
    );
    if (!membership.isMemberOfExactTeam) {
      logTeamAccessFailure({
        reason: "final_round_select_not_member",
        userId: interaction.user.id,
        instanceId,
        buttonTeamId: teamId,
        targetTeamId: team.id,
        targetTeamName: team.teamName,
        isMemberOfExactTeam: membership.isMemberOfExactTeam,
        isLeader: false,
      });
      await interaction.reply({
        content: "You do not belong to this tournament team.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const leaderAccess = await getTeamLeaderAccessDebug(
      interaction.guildId,
      interaction.member.roles,
      team,
      interaction.user.id
    );

    if (!leaderAccess.isLeader) {
      logTeamAccessFailure({
        reason: "final_round_select_not_leader",
        userId: interaction.user.id,
        instanceId,
        buttonTeamId: teamId,
        targetTeamId: team.id,
        targetTeamName: team.teamName,
        isMemberOfExactTeam: membership.isMemberOfExactTeam,
        isLeader: leaderAccess.isLeader,
      });
      await interaction.reply({
        content: "Only the team leader can submit results.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const instance = await getTournamentInstanceById(instanceId);

    if (!instance || instance.currentCycle === null) {
      await interaction.reply({
        content: "This tournament instance is not in an active cycle.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const assignments = await listMatchAssignmentsForTournamentInstance(
      instanceId,
      instance.currentCycle,
      TournamentStage.FINAL_ROUND
    );
    const assignment = assignments.find(
      (row) => row.teamId === team.id || row.opponentTeamId === team.id
    );

    if (!assignment) {
      await interaction.reply({
        content: "No Final Round assignment exists for your team.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const frp = Number(interaction.values[0]);

    try {
      await deferEphemeralResponse();
      await createOrUpdateTeamStageSubmission({
        tournamentInstanceId: instanceId,
        teamId: team.id,
        teamName: team.teamName,
        opponentTeamName: assignment.teamId === team.id ? assignment.opponentTeamName : assignment.teamName,
        cycleNumber: instance.currentCycle,
        stageName: TournamentStage.FINAL_ROUND,
        submissionType: "FINAL_ROUND_SCORE",
        value: frp,
        submittedByDiscordUserId: interaction.user.id,
        submittedByDisplayName:
          interaction.user.tag ?? interaction.user.globalName ?? interaction.user.username,
        matchAssignmentId: assignment.id,
      });

      const panel = await buildTeamPanel(
        interaction.user.id,
        interaction.guildId,
        interaction.member.roles
      );

      await interaction.editReply({
        content: `Final Round FRP ${frp} submitted for admin approval.`,
        ...panel,
      });
    } catch (error) {
      if (!interaction.deferred && !interaction.replied) {
        await deferEphemeralResponse();
      }

      await interaction.editReply({
        content:
          error instanceof Error
            ? error.message
            : "Failed to submit Final Round FRP.",
      });
    }

    return true;
  }

  if (interaction.customId.startsWith("tournament:select_team_submission:")) {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const instanceId = Number(interaction.customId.split(":")[2]);
    const instance = await getTournamentInstanceById(instanceId);
    if (instance?.currentStage === TournamentStage.FINAL_ROUND) {
      const review = await buildTeamSubmissionReviewReply(instanceId);
      await interaction.reply({
        content:
          "Final Round uses matchup-based review. Use the matchup controls below.",
        ...review,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const submissionId = Number(interaction.values[0]);
    const submission = await getReportSubmissionById(submissionId);

    if (!submission) {
      await interaction.reply({
        content: "Submission not found.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const embed = buildSubmissionReviewEmbed(submission);

    await interaction.reply({
      embeds: embed ? [embed] : [],
      components: [buildSubmissionActionRow(instanceId, submissionId)],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return false;
}

export async function handleTournamentInstanceModal(
  interaction: ModalSubmitInteraction
): Promise<boolean> {
  const deferEphemeralResponse = async () => {
    if (interaction.deferred || interaction.replied) {
      return;
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
  };

  if (interaction.customId.startsWith("tournament:reject_matchup_modal:")) {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const [, , instanceIdRaw, assignmentIdRaw] = interaction.customId.split(":");
    const instanceId = Number(instanceIdRaw);
    const assignmentId = Number(assignmentIdRaw);
    const reason = interaction.fields.getTextInputValue("reject_reason").trim();

    try {
      await rejectFinalRoundMatchup(
        instanceId,
        assignmentId,
        interaction.user.id,
        reason || "No reason provided."
      );
      const review = await buildTeamSubmissionReviewReply(instanceId);
      await interaction.reply({
        content: "Matchup submissions rejected.",
        ...review,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : "Failed to reject matchup.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return true;
  }

  if (interaction.customId.startsWith("tournament:reject_submission_modal:")) {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const [, , instanceIdRaw, submissionIdRaw] = interaction.customId.split(":");
    const instanceId = Number(instanceIdRaw);
    const submissionId = Number(submissionIdRaw);
    const reason = interaction.fields.getTextInputValue("reject_reason").trim();

    try {
      await rejectTeamStageSubmission(submissionId, interaction.user.id, reason || "No reason provided.");
      const review = await buildTeamSubmissionReviewReply(instanceId);
      await interaction.reply({
        content: "Team submission rejected.",
        ...review,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : "Failed to reject submission.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return true;
  }

  if (interaction.customId.startsWith("tournament:override_modal:")) {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const instanceId = Number(interaction.customId.split(":")[2]);
    const action = interaction.fields.getTextInputValue("override_action").trim();
    const target = interaction.fields.getTextInputValue("override_target").trim();

    try {
      await deferEphemeralResponse();
      if (action === "reopen_checkin") {
        await reopenTournamentCheckIn(instanceId, interaction.user.id);
      } else if (action === "clear_checkin") {
        const team = await getTeamByTournamentInstanceAndName(instanceId, target);

        if (!team) {
          throw new Error("Team not found for clear_checkin.");
        }

        await setTeamCheckInStatus(team.id, "Not Checked In", interaction.user.id);
      } else if (action === "void_result") {
        await voidOfficialMatchResult(Number(target), interaction.user.id);
      } else if (action === "reopen_cycle") {
        await reopenTournamentCycle(instanceId, Number(target), interaction.user.id);
      } else {
        throw new Error("Unsupported override action.");
      }

      const panel = await buildTournamentPanel(instanceId);
      await interaction.editReply({
        content: "Emergency override applied.",
        ...panel,
      });

      void pushTournamentWebhookUpdate({
        tournamentInstanceId: instanceId,
        reason: "admin_override",
      }).catch((webhookError) => {
        console.warn("[tournament-webhook-update-failed]", {
          tournamentInstanceId: instanceId,
          reason: "admin_override",
          error:
            webhookError instanceof Error ? webhookError.message : "Unknown webhook error",
        });
      });
    } catch (error) {
      if (!interaction.deferred && !interaction.replied) {
        await deferEphemeralResponse();
      }

      await interaction.editReply({
        content: error instanceof Error ? error.message : "Emergency override failed.",
      });
    }
    return true;
  }

  return false;
}

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
import { TournamentStage } from "@prisma/client";
import { buildTeamPanel } from "../helpers/teamPanel";
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
  assignCashoutMapForCycleIfMissing,
  assignFinalRoundMapsIfMissing,
} from "../storage/tournamentMaps";
import {
  closeTournamentCheckIn,
  finalizeTournamentCycle,
  finishTournamentInstance,
  getTournamentInstanceById,
  handleTournamentLeaderCheckIn,
  openTournamentCheckIn,
  reopenTournamentCheckIn,
  reopenTournamentCycle,
  setTournamentInstanceFinalRoundReady,
  startTournamentCycle,
} from "../storage/tournamentInstances";
import {
  getTeamById,
  getTeamByTournamentInstanceAndName,
  setTeamCheckInStatus,
} from "../storage/teams";
import { pushTournamentWebhookUpdate } from "../services/tournamentWebhook";

type TeamButtonAction =
  | "checkin"
  | "submit_cashout"
  | "edit_cashout"
  | "submit_final_round"
  | "edit_final_round";

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

async function approveCashoutStage(instanceId: number, actorDiscordUserId: string) {
  const instance = await getTournamentInstanceById(instanceId);

  if (!instance || instance.currentCycle === null) {
    throw new Error("This tournament instance is not in an active cycle.");
  }

  if (instance.currentStage !== TournamentStage.CASHOUT) {
    throw new Error("Approve Cashout Stage is only available during CASHOUT.");
  }

  const submissions = await listCurrentStageTeamSubmissions(
    instanceId,
    instance.currentCycle,
    TournamentStage.CASHOUT
  );

  const approved = submissions.filter((row) => row.status === "reviewed");
  if (approved.length !== 4) {
    throw new Error("Four approved cashout placements are required before stage approval.");
  }

  const values = approved.map((row) => Number(row.score));
  const uniqueValues = new Set(values);
  if (uniqueValues.size !== 4 || values.some((value) => ![1, 2, 3, 4].includes(value))) {
    throw new Error("Approved cashout placements must be unique values from 1st to 4th.");
  }

  const byPlacement = new Map<number, number>();
  for (const submission of approved) {
    if (submission.teamId === null) {
      throw new Error("Found approved placement missing team linkage.");
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

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`tournament:select_team_submission:${instanceId}`)
    .setPlaceholder("Select a team submission to review")
    .addOptions(
      submissions.map((submission) => ({
        label: `${submission.teamName} (${submission.score})`.slice(0, 100),
        description: `${submission.stageName} | ${formatStageSubmissionStatus(submission.status)}`.slice(
          0,
          100
        ),
        value: `${submission.id}`,
      }))
    );

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
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  };
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

export async function handleTournamentInstanceButton(
  interaction: ButtonInteraction
): Promise<boolean> {
  if (interaction.customId === "tournament:change_instance") {
    if (!interaction.inCachedGuild()) {
      return true;
    }

    const picker = await buildTournamentInstancePicker(interaction.guildId);
    await interaction.reply({
      ...picker,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (interaction.customId.startsWith("team:refresh:")) {
    if (!interaction.inCachedGuild()) {
      return true;
    }

    const teamId = Number(interaction.customId.split(":")[2]);
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
    await interaction.reply({
      ...panel,
      flags: MessageFlags.Ephemeral,
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

    if (action === "checkin") {
      try {
        await handleTournamentLeaderCheckIn(instanceId, team.id, interaction.user.id);

        const panel = await buildTeamPanel(
          interaction.user.id,
          interaction.guildId,
          interaction.member.roles
        );

        await interaction.reply({
          content:
            `${team.teamName} checked in successfully.\n` +
            `The tournament panel will reflect this on refresh.`,
          ...panel,
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        await interaction.reply({
          content: error instanceof Error ? error.message : "Check-in failed.",
          flags: MessageFlags.Ephemeral,
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
      await approveTeamStageSubmission(submissionId, interaction.user.id);
      const review = await buildTeamSubmissionReviewReply(instanceId);
      await interaction.reply({
        content: "Team submission approved.",
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

  const { instanceId, action } = parseTournamentButton(interaction.customId);

  if (action === "refresh") {
    const panel = await buildTournamentPanel(instanceId);
    await interaction.reply({
      ...panel,
      flags: MessageFlags.Ephemeral,
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
      const updated = await startTournamentCycle(
        instanceId,
        cycleNumber,
        interaction.user.id
      );
      await assignCashoutMapForCycleIfMissing(instanceId, cycleNumber);
      const panel = await buildTournamentPanel(updated.id);
      await interaction.reply({
        content: `${updated.name} is ready for cycle ${cycleNumber} cashout.`,
        ...panel,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : "Failed to start cycle.",
        flags: MessageFlags.Ephemeral,
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

  if (action === "approve_cashout_stage") {
    try {
      await approveCashoutStage(instanceId, interaction.user.id);
      const panel = await buildTournamentPanel(instanceId);
      await interaction.reply({
        content: "Cashout stage approved. Official placements and final round pairings are ready.",
        ...panel,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : "Failed to approve cashout stage.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return true;
  }

  if (action === "start_final_round") {
    try {
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
      if (!officialPlacements) {
        throw new Error(
          "Start Final Round requires approved cashout stage placements. Run Approve Cashout Stage first."
        );
      }

      const updated = await setTournamentInstanceFinalRoundReady(
        instanceId,
        instance.currentCycle,
        interaction.user.id
      );
      await assignFinalRoundMapsIfMissing(instanceId, instance.currentCycle);

      const panel = await buildTournamentPanel(updated.id);
      await interaction.reply({
        content: "Final Round started. Matchup maps assigned.",
        ...panel,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : "Failed to start Final Round.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return true;
  }

  if (action === "approve_final_round_stage") {
    try {
      await approveFinalRoundStage(instanceId, interaction.user.id);
      const panel = await buildTournamentPanel(instanceId);
      await interaction.reply({
        content: "Final Round stage approved. Official match results reconciled from team submissions.",
        ...panel,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error ? error.message : "Failed to approve final round stage.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return true;
  }

  if (action === "finalize_cycle") {
    try {
      const updated = await finalizeTournamentCycle(instanceId, interaction.user.id);
      const panel = await buildTournamentPanel(updated.id);
      await interaction.reply({
        content: `${updated.name} cycle ${updated.currentCycle} finalized.`,
        ...panel,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : "Failed to finalize cycle.",
        flags: MessageFlags.Ephemeral,
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
  if (interaction.customId === "tournament:select_instance") {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const instanceId = Number(interaction.values[0]);
    const panel = await buildTournamentPanel(instanceId);
    await interaction.reply({
      ...panel,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (interaction.customId.startsWith("team:cashout_select:")) {
    if (!interaction.inCachedGuild()) {
      return true;
    }

    const [, , , instanceIdRaw, teamIdRaw] = interaction.customId.split(":");
    const instanceId = Number(instanceIdRaw);
    const teamId = Number(teamIdRaw);
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

      await interaction.reply({
        content: `Cashout placement ${placement} submitted for admin approval.`,
        ...panel,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error
            ? error.message
            : "Failed to submit cashout placement.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return true;
  }

  if (interaction.customId.startsWith("team:final_round_select:")) {
    if (!interaction.inCachedGuild()) {
      return true;
    }

    const [, , , instanceIdRaw, teamIdRaw] = interaction.customId.split(":");
    const instanceId = Number(instanceIdRaw);
    const teamId = Number(teamIdRaw);
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

      await interaction.reply({
        content: `Final Round FRP ${frp} submitted for admin approval.`,
        ...panel,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error
            ? error.message
            : "Failed to submit Final Round FRP.",
        flags: MessageFlags.Ephemeral,
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
    const submissionId = Number(interaction.values[0]);
    const submission = await getReportSubmissionById(submissionId);

    if (!submission) {
      await interaction.reply({
        content: "Submission not found.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const type = getTeamStageSubmissionType(submission) ?? "UNKNOWN";

    const embed = new EmbedBuilder()
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

    await interaction.reply({
      embeds: [embed],
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

      await pushTournamentWebhookUpdate({
        tournamentInstanceId: instanceId,
        reason: "admin_override",
      });

      const panel = await buildTournamentPanel(instanceId);
      await interaction.reply({
        content: "Emergency override applied.",
        ...panel,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : "Emergency override failed.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return true;
  }

  return false;
}

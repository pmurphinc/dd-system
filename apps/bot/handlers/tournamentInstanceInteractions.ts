import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from "discord.js";
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
  getTournamentInstanceById,
  openTournamentCheckIn,
  closeTournamentCheckIn,
  handleTournamentLeaderCheckIn,
  startTournamentCycle,
  finalizeTournamentCycle,
  finishTournamentInstance,
  reopenTournamentCheckIn,
  reopenTournamentCycle,
} from "../storage/tournamentInstances";
import {
  getTeamByTournamentInstanceAndName,
  getTeamById,
  getTeamForUserInTournament,
  listImportedTeamsForTournamentInstance,
  setTeamCheckInStatus,
} from "../storage/teams";
import { upsertCashoutPlacement } from "../storage/cashoutPlacements";
import {
  getMatchAssignmentById,
  listMatchAssignmentsForTournamentInstance,
} from "../storage/matchAssignments";
import {
  createReportSubmission,
  getPendingReportSubmissions,
  hasPendingReportSubmissionForAssignment,
} from "../storage/reportSubmissions";
import {
  recordOfficialMatchResult,
  voidOfficialMatchResult,
} from "../storage/officialMatchResults";
import { TournamentStage } from "@prisma/client";
import { pushTournamentWebhookUpdate } from "../services/tournamentWebhook";

type CashoutDraft = {
  firstPlaceTeamId?: number;
  secondPlaceTeamId?: number;
  thirdPlaceTeamId?: number;
  fourthPlaceTeamId?: number;
};

type FinalRoundScoreDraft = {
  winnerTeamId?: number;
  losingTeamFrp?: 0 | 1;
};

const cashoutPlacementDrafts = new Map<number, CashoutDraft>();
const finalRoundScoreDrafts = new Map<string, FinalRoundScoreDraft>();

function parseTournamentButton(customId: string) {
  const [, instanceIdRaw, action] = customId.split(":");
  return {
    instanceId: Number(instanceIdRaw),
    action,
  };
}

function parseTeamButton(customId: string) {
  const [, action, instanceIdRaw, teamIdRaw] = customId.split(":");
  return {
    action,
    instanceId: Number(instanceIdRaw),
    teamId: Number(teamIdRaw),
  };
}

function getCashoutDraft(instanceId: number): CashoutDraft {
  return cashoutPlacementDrafts.get(instanceId) ?? {};
}

function setCashoutDraftValue(
  instanceId: number,
  place: 1 | 2 | 3 | 4,
  teamId: number
) {
  const current = getCashoutDraft(instanceId);

  const updated: CashoutDraft = {
    ...current,
  };

  if (place === 1) updated.firstPlaceTeamId = teamId;
  else if (place === 2) updated.secondPlaceTeamId = teamId;
  else if (place === 3) updated.thirdPlaceTeamId = teamId;
  else updated.fourthPlaceTeamId = teamId;

  cashoutPlacementDrafts.set(instanceId, updated);
}

function clearCashoutDraft(instanceId: number) {
  cashoutPlacementDrafts.delete(instanceId);
}

function parseCashoutSelectCustomId(customId: string) {
  const [, action, placeRaw, instanceIdRaw] = customId.split(":");

  return {
    action,
    place: Number(placeRaw) as 1 | 2 | 3 | 4,
    instanceId: Number(instanceIdRaw),
  };
}

function parseCashoutConfirmCustomId(customId: string) {
  const [, action, instanceIdRaw] = customId.split(":");

  return {
    action,
    instanceId: Number(instanceIdRaw),
  };
}

function getPlacementLabel(place: 1 | 2 | 3 | 4): string {
  if (place === 1) return "1st Place";
  if (place === 2) return "2nd Place";
  if (place === 3) return "3rd Place";
  return "4th Place";
}

function buildCashoutPlacementSummary(
  teams: Awaited<ReturnType<typeof listImportedTeamsForTournamentInstance>>,
  draft: CashoutDraft
) {
  const findName = (teamId?: number) =>
    teamId
      ? teams.find((team) => team.id === teamId)?.teamName ?? `Unknown (${teamId})`
      : "Not selected";

  return [
    `1st: ${findName(draft.firstPlaceTeamId)}`,
    `2nd: ${findName(draft.secondPlaceTeamId)}`,
    `3rd: ${findName(draft.thirdPlaceTeamId)}`,
    `4th: ${findName(draft.fourthPlaceTeamId)}`,
  ].join("\n");
}

function buildCashoutPlacementComponents(
  instanceId: number,
  teams: Awaited<ReturnType<typeof listImportedTeamsForTournamentInstance>>,
  draft: CashoutDraft
) {
  const buildMenuRow = (place: 1 | 2 | 3 | 4) => {
    const selectedValue =
      place === 1
        ? draft.firstPlaceTeamId
        : place === 2
          ? draft.secondPlaceTeamId
          : place === 3
            ? draft.thirdPlaceTeamId
            : draft.fourthPlaceTeamId;

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`tournament:cashout_select:${place}:${instanceId}`)
      .setPlaceholder(`Select ${getPlacementLabel(place)}`)
      .addOptions(
        teams.map((team) => ({
          label: team.teamName.slice(0, 100),
          value: `${team.id}`,
          default: selectedValue === team.id,
        }))
      );

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
  };

  const draftValues = [
    draft.firstPlaceTeamId,
    draft.secondPlaceTeamId,
    draft.thirdPlaceTeamId,
    draft.fourthPlaceTeamId,
  ].filter((value): value is number => Number.isFinite(value));

  const canSubmit = draftValues.length === 4;

  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tournament:cashout_confirm:${instanceId}`)
      .setLabel("Submit Cashout Placements")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canSubmit),
    new ButtonBuilder()
      .setCustomId(`tournament:${instanceId}:refresh`)
      .setLabel("Back to Tournament Panel")
      .setStyle(ButtonStyle.Secondary)
  );

  return [
    buildMenuRow(1),
    buildMenuRow(2),
    buildMenuRow(3),
    buildMenuRow(4),
    confirmRow,
  ];
}

async function buildCashoutPlacementReply(instanceId: number) {
  const instance = await getTournamentInstanceById(instanceId);

  if (!instance || instance.currentCycle === null) {
    throw new Error("This tournament instance is not in an active cycle.");
  }

  const teams = await listImportedTeamsForTournamentInstance(instanceId);

  if (teams.length !== 4) {
    throw new Error(
      `Cashout placements require exactly 4 assigned teams. Found ${teams.length}.`
    );
  }

  const draft = getCashoutDraft(instanceId);

  const embed = new EmbedBuilder()
    .setTitle(`Cashout Placements: ${instance.name}`)
    .setDescription(
      `Select the placements for cycle ${instance.currentCycle}.\n\n${buildCashoutPlacementSummary(
        teams,
        draft
      )}`
    );

  return {
    embeds: [embed],
    components: buildCashoutPlacementComponents(instanceId, teams, draft),
  };
}

function validateCashoutDraft(
  teams: Awaited<ReturnType<typeof listImportedTeamsForTournamentInstance>>,
  draft: CashoutDraft
) {
  const required = [
    draft.firstPlaceTeamId,
    draft.secondPlaceTeamId,
    draft.thirdPlaceTeamId,
    draft.fourthPlaceTeamId,
  ];

  if (required.some((value) => !Number.isFinite(value))) {
    throw new Error("All 4 placements must be selected before submitting.");
  }

  const selectedIds = required as number[];
  const uniqueIds = new Set(selectedIds);

  if (uniqueIds.size !== 4) {
    throw new Error("Each placement must be assigned to a different team.");
  }

  const validTeamIds = new Set(teams.map((team) => team.id));
  const invalid = selectedIds.find((teamId) => !validTeamIds.has(teamId));

  if (invalid) {
    throw new Error(`Selected team ${invalid} does not belong to this tournament instance.`);
  }

  return {
    firstPlaceTeamId: draft.firstPlaceTeamId as number,
    secondPlaceTeamId: draft.secondPlaceTeamId as number,
    thirdPlaceTeamId: draft.thirdPlaceTeamId as number,
    fourthPlaceTeamId: draft.fourthPlaceTeamId as number,
  };
}

function getFinalRoundScoreDraft(
  instanceId: number,
  assignmentId: number
): FinalRoundScoreDraft {
  return finalRoundScoreDrafts.get(`${instanceId}:${assignmentId}`) ?? {};
}

function setFinalRoundScoreDraftValue(
  instanceId: number,
  assignmentId: number,
  updates: Partial<FinalRoundScoreDraft>
) {
  const key = `${instanceId}:${assignmentId}`;
  const current = getFinalRoundScoreDraft(instanceId, assignmentId);

  finalRoundScoreDrafts.set(key, {
    ...current,
    ...updates,
  });
}

function clearFinalRoundScoreDraft(instanceId: number, assignmentId: number) {
  finalRoundScoreDrafts.delete(`${instanceId}:${assignmentId}`);
}

function parseScoreWinnerSelectCustomId(customId: string) {
  const [, action, instanceIdRaw, assignmentIdRaw] = customId.split(":");
  return {
    action,
    instanceId: Number(instanceIdRaw),
    assignmentId: Number(assignmentIdRaw),
  };
}

function parseScoreLoserFrpSelectCustomId(customId: string) {
  const [, action, instanceIdRaw, assignmentIdRaw] = customId.split(":");
  return {
    action,
    instanceId: Number(instanceIdRaw),
    assignmentId: Number(assignmentIdRaw),
  };
}

function parseScoreConfirmCustomId(customId: string) {
  const [, action, instanceIdRaw, assignmentIdRaw] = customId.split(":");
  return {
    action,
    instanceId: Number(instanceIdRaw),
    assignmentId: Number(assignmentIdRaw),
  };
}

async function buildFinalRoundScoreReply(instanceId: number, assignmentId: number) {
  const assignment = await getMatchAssignmentById(assignmentId);

  if (!assignment || assignment.tournamentInstanceId !== instanceId) {
    throw new Error("Final Round assignment not found.");
  }

  const draft = getFinalRoundScoreDraft(instanceId, assignmentId);

  const winnerOptions = [
    {
      label: assignment.teamName.slice(0, 100),
      value: `${assignment.teamId}`,
      default: draft.winnerTeamId === assignment.teamId,
    },
    {
      label: assignment.opponentTeamName.slice(0, 100),
      value: `${assignment.opponentTeamId}`,
      default: draft.winnerTeamId === assignment.opponentTeamId,
    },
  ];

  const loserFrpOptions = [
    {
      label: "0 FRP (winner won 2-0)",
      value: "0",
      default: draft.losingTeamFrp === 0,
    },
    {
      label: "1 FRP (winner won 2-1)",
      value: "1",
      default: draft.losingTeamFrp === 1,
    },
  ];

  const winnerLabel =
    draft.winnerTeamId === assignment.teamId
      ? assignment.teamName
      : draft.winnerTeamId === assignment.opponentTeamId
        ? assignment.opponentTeamName
        : "Not selected";

  const loserFrpLabel =
    draft.losingTeamFrp === 0 || draft.losingTeamFrp === 1
      ? `${draft.losingTeamFrp}`
      : "Not selected";

  const canSubmit =
    Number.isFinite(draft.winnerTeamId) &&
    (draft.losingTeamFrp === 0 || draft.losingTeamFrp === 1);

  const embed = new EmbedBuilder()
    .setTitle("Final Round Score")
    .setDescription(
      [
        `Match: ${assignment.teamName} vs ${assignment.opponentTeamName}`,
        `Winner: ${winnerLabel}`,
        `Losing Team FRP: ${loserFrpLabel}`,
        "",
        "Winner automatically receives 2 FRP.",
      ].join("\n")
    );

  const winnerMenu = new StringSelectMenuBuilder()
    .setCustomId(`tournament:score_winner:${instanceId}:${assignmentId}`)
    .setPlaceholder("Who Won?")
    .addOptions(winnerOptions);

  const loserFrpMenu = new StringSelectMenuBuilder()
    .setCustomId(`tournament:score_loser_frp:${instanceId}:${assignmentId}`)
    .setPlaceholder("How many FRP for losing team?")
    .addOptions(loserFrpOptions);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tournament:score_confirm:${instanceId}:${assignmentId}`)
      .setLabel("Submit Official Score")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canSubmit),
    new ButtonBuilder()
      .setCustomId(`tournament:${instanceId}:refresh`)
      .setLabel("Back to Tournament Panel")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(winnerMenu),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(loserFrpMenu),
      buttons,
    ],
  };
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
    const team = await getTeamForUserInTournament(
      interaction.user.id,
      instanceId,
      interaction.member.roles
    );

    if (!team || team.id !== teamId) {
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

    if (action === "report") {
      const instance = await getTournamentInstanceById(instanceId);
      const assignments = instance
        ? await listMatchAssignmentsForTournamentInstance(
            instanceId,
            instance.currentCycle ?? undefined,
            TournamentStage.FINAL_ROUND
          )
        : [];
      const assignment = assignments.find(
        (row) => row.teamId === team.id || row.opponentTeamId === team.id
      );

      if (!instance || !assignment) {
        await interaction.reply({
          content: "No Final Round assignment is available for your team.",
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      const modal = new ModalBuilder()
        .setCustomId(`team:report_modal:${instanceId}:${team.id}:${assignment.id}`)
        .setTitle(`Informational Report: ${team.teamName}`.slice(0, 45));

      const scoreInput = new TextInputBuilder()
        .setCustomId("score")
        .setLabel("Reported BO3 Score")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("2-0, 2-1, 1-2, 0-2")
        .setRequired(true);

      const notesInput = new TextInputBuilder()
        .setCustomId("notes")
        .setLabel("Notes")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(scoreInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput)
      );
      await interaction.showModal(modal);
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

  if (interaction.customId.startsWith("tournament:cashout_confirm:")) {
    const { instanceId } = parseCashoutConfirmCustomId(interaction.customId);

    try {
      const instance = await getTournamentInstanceById(instanceId);

      if (!instance || instance.currentCycle === null) {
        throw new Error("This tournament instance is not in an active cycle.");
      }

      const teams = await listImportedTeamsForTournamentInstance(instanceId);
      const draft = getCashoutDraft(instanceId);
      const validated = validateCashoutDraft(teams, draft);

      await upsertCashoutPlacement({
        tournamentInstanceId: instanceId,
        cycleNumber: instance.currentCycle,
        firstPlaceTeamId: validated.firstPlaceTeamId,
        secondPlaceTeamId: validated.secondPlaceTeamId,
        thirdPlaceTeamId: validated.thirdPlaceTeamId,
        fourthPlaceTeamId: validated.fourthPlaceTeamId,
        actorDiscordUserId: interaction.user.id,
      });

      clearCashoutDraft(instanceId);

      const panel = await buildTournamentPanel(instanceId);
      await interaction.reply({
        content: "Cashout placements recorded and Final Round pairings created automatically.",
        ...panel,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error
            ? error.message
            : "Failed to record cashout placements.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return true;
  }

  if (interaction.customId.startsWith("tournament:score_confirm:")) {
    const { instanceId, assignmentId } = parseScoreConfirmCustomId(interaction.customId);

    try {
      const assignment = await getMatchAssignmentById(assignmentId);

      if (!assignment || assignment.tournamentInstanceId !== instanceId) {
        throw new Error("Final Round assignment not found.");
      }

      const draft = getFinalRoundScoreDraft(instanceId, assignmentId);

      if (!Number.isFinite(draft.winnerTeamId)) {
        throw new Error("Select the winning team first.");
      }

      if (draft.losingTeamFrp !== 0 && draft.losingTeamFrp !== 1) {
        throw new Error("Select the losing team's FRP first.");
      }

      const winnerTeamId = draft.winnerTeamId as number;
      const loserTeamId =
        winnerTeamId === assignment.teamId
          ? assignment.opponentTeamId
          : assignment.teamId;

      const round3Played = draft.losingTeamFrp === 1;
      const round3WinnerTeamId =
        round3Played && typeof loserTeamId === "number" ? loserTeamId : undefined;

      await recordOfficialMatchResult({
        tournamentInstanceId: instanceId,
        matchAssignmentId: assignmentId,
        round1WinnerTeamId: winnerTeamId,
        round2WinnerTeamId: winnerTeamId,
        round3Played,
        round3WinnerTeamId,
        enteredByDiscordUserId: interaction.user.id,
      });

      clearFinalRoundScoreDraft(instanceId, assignmentId);

      const panel = await buildTournamentPanel(instanceId);
      await interaction.reply({
        content: "Official Final Round score recorded.",
        ...panel,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : "Failed to record official score.",
        flags: MessageFlags.Ephemeral,
      });
    }

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

  if (action === "enter_cashout") {
    try {
      const reply = await buildCashoutPlacementReply(instanceId);
      await interaction.reply({
        content: "Select the Cashout placements for this cycle.",
        ...reply,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error
            ? error.message
            : "Failed to open cashout placement entry.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return true;
  }

  if (action === "enter_score") {
    const instance = await getTournamentInstanceById(instanceId);
    const assignments = await listMatchAssignmentsForTournamentInstance(
      instanceId,
      instance?.currentCycle ?? undefined,
      TournamentStage.FINAL_ROUND
    );

    if (assignments.length === 0) {
      await interaction.reply({
        content: "No Final Round assignments are available for this instance.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`tournament:select_score_assignment:${instanceId}`)
      .setPlaceholder("Select a Final Round match")
      .addOptions(
        assignments.map((assignment) => ({
          label: `${assignment.teamName} vs ${assignment.opponentTeamName}`.slice(0, 100),
          description: `Cycle ${assignment.cycleNumber} | ${assignment.bracketLabel ?? "match"}`.slice(
            0,
            100
          ),
          value: `${assignment.id}`,
        }))
      );

    await interaction.reply({
      content: "Select the Final Round match to score officially.",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === "review_pending_results") {
    const pendingReports = await getPendingReportSubmissions(20, instanceId);
    const embed = new EmbedBuilder()
      .setTitle("Pending Informational Results")
      .setDescription(
        pendingReports.length > 0
          ? pendingReports
              .map(
                (report) =>
                  `${report.teamName} vs ${report.opponentTeamName} | ${report.score} | ${report.notes || "no notes"}`
              )
              .join("\n")
          : "No pending informational team-leader results."
      );

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
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

  if (interaction.customId.startsWith("tournament:cashout_select:")) {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const { place, instanceId } = parseCashoutSelectCustomId(interaction.customId);
    const selectedTeamId = Number(interaction.values[0]);

    if (!Number.isFinite(selectedTeamId)) {
      await interaction.reply({
        content: "Invalid team selection.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    try {
      const teams = await listImportedTeamsForTournamentInstance(instanceId);
      const validTeam = teams.find((team) => team.id === selectedTeamId);

      if (!validTeam) {
        throw new Error("Selected team does not belong to this tournament instance.");
      }

      setCashoutDraftValue(instanceId, place, selectedTeamId);

      const reply = await buildCashoutPlacementReply(instanceId);
      await interaction.reply({
        content: `${getPlacementLabel(place)} set to ${validTeam.teamName}.`,
        ...reply,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error
            ? error.message
            : "Failed to update cashout placement selection.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return true;
  }

  if (interaction.customId.startsWith("tournament:select_score_assignment:")) {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const instanceId = Number(interaction.customId.split(":")[2]);
    const assignmentId = Number(interaction.values[0]);

    try {
      const reply = await buildFinalRoundScoreReply(instanceId, assignmentId);
      await interaction.reply({
        content: "Select the official Final Round result.",
        ...reply,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content:
          error instanceof Error
            ? error.message
            : "Failed to open Final Round score entry.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return true;
  }

  if (interaction.customId.startsWith("tournament:score_winner:")) {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const { instanceId, assignmentId } = parseScoreWinnerSelectCustomId(
      interaction.customId
    );
    const selectedWinnerTeamId = Number(interaction.values[0]);
    const assignment = await getMatchAssignmentById(assignmentId);

    if (!assignment || assignment.tournamentInstanceId !== instanceId) {
      await interaction.reply({
        content: "Final Round assignment not found.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const validWinner =
      selectedWinnerTeamId === assignment.teamId ||
      selectedWinnerTeamId === assignment.opponentTeamId;

    if (!validWinner) {
      await interaction.reply({
        content: "Selected winner does not belong to this match.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    setFinalRoundScoreDraftValue(instanceId, assignmentId, {
      winnerTeamId: selectedWinnerTeamId,
    });

    const reply = await buildFinalRoundScoreReply(instanceId, assignmentId);
    await interaction.reply({
      content: "Winner selection updated.",
      ...reply,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (interaction.customId.startsWith("tournament:score_loser_frp:")) {
    if (!(await hasAdminInteractionAccess(interaction))) {
      await interaction.reply({
        content: "You do not have permission to use this action.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const { instanceId, assignmentId } = parseScoreLoserFrpSelectCustomId(
      interaction.customId
    );
    const losingTeamFrp = Number(interaction.values[0]);

    if (losingTeamFrp !== 0 && losingTeamFrp !== 1) {
      await interaction.reply({
        content: "Losing team FRP must be 0 or 1.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    setFinalRoundScoreDraftValue(instanceId, assignmentId, {
      losingTeamFrp: losingTeamFrp as 0 | 1,
    });

    const reply = await buildFinalRoundScoreReply(instanceId, assignmentId);
    await interaction.reply({
      content: "Losing team FRP updated.",
      ...reply,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return false;
}

export async function handleTournamentInstanceModal(
  interaction: ModalSubmitInteraction
): Promise<boolean> {
  if (interaction.customId.startsWith("team:report_modal:")) {
    if (!interaction.inCachedGuild()) {
      return true;
    }

    const [, , instanceIdRaw, teamIdRaw, assignmentIdRaw] =
      interaction.customId.split(":");
    const instanceId = Number(instanceIdRaw);
    const teamId = Number(teamIdRaw);
    const assignmentId = Number(assignmentIdRaw);
    const team = await getTeamForUserInTournament(
      interaction.user.id,
      instanceId,
      interaction.member.roles
    );

    if (!team || team.id !== teamId) {
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
      await interaction.reply({
        content: `Only the team leader can submit an informational report. ${leaderAccess.note ?? ""}`.trim(),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const score = interaction.fields.getTextInputValue("score").trim().replace("-", "_");
    const notes = interaction.fields.getTextInputValue("notes").trim();
    const assignment = await getMatchAssignmentById(assignmentId);

    if (!assignment || assignment.tournamentInstanceId !== instanceId) {
      await interaction.reply({
        content: "Final Round assignment not found.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const pendingExists = await hasPendingReportSubmissionForAssignment(
      assignment.id,
      team.id
    );

    if (pendingExists) {
      await interaction.reply({
        content: "A pending informational report already exists for this team and match.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await createReportSubmission({
      tournamentInstanceId: instanceId,
      teamId: team.id,
      score,
      matchAssignmentId: assignment.id,
      submittedByDiscordUserId: interaction.user.id,
      submittedByDisplayName:
        interaction.user.tag ?? interaction.user.globalName ?? interaction.user.username,
      teamName: team.teamName,
      opponentTeamName: assignment.opponentTeamName,
      cycleNumber: assignment.cycleNumber,
      stageName: assignment.stageName,
      notes: notes || "none",
    });

    const panel = await buildTeamPanel(
      interaction.user.id,
      interaction.guildId,
      interaction.member.roles
    );
    await interaction.reply({
      content: "Informational Final Round report submitted for admin review.",
      ...panel,
      flags: MessageFlags.Ephemeral,
    });
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

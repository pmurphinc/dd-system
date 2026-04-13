import { OfficialMatchResultStatus } from "@prisma/client";
import { createAuditLog } from "./auditLog";
import { prisma } from "./prisma";
import {
  getFrpAwardByScore,
  recomputeStandingsForTournamentInstance,
} from "./standings";
import { pushTournamentWebhookUpdate } from "../services/tournamentWebhook";
import { notifyPanelDataChanged } from "../services/panelRefreshBus";

export interface OfficialMatchResultInput {
  tournamentInstanceId: number;
  matchAssignmentId: number;
  round1WinnerTeamId: number;
  round2WinnerTeamId: number;
  round3Played: boolean;
  round3WinnerTeamId?: number;
  enteredByDiscordUserId: string;
}

export function buildBo3Score(
  teamId: number,
  round1WinnerTeamId: number,
  round2WinnerTeamId: number,
  round3Played: boolean,
  round3WinnerTeamId?: number
): { teamScore: number; opponentScore: number; score: string } {
  let teamScore = 0;
  let opponentScore = 0;

  for (const winnerTeamId of [
    round1WinnerTeamId,
    round2WinnerTeamId,
    ...(round3Played && round3WinnerTeamId ? [round3WinnerTeamId] : []),
  ]) {
    if (winnerTeamId === teamId) {
      teamScore += 1;
    } else {
      opponentScore += 1;
    }
  }

  return {
    teamScore,
    opponentScore,
    score: `${teamScore}_${opponentScore}`,
  };
}

export async function recordOfficialMatchResult(
  input: OfficialMatchResultInput
) {
  const assignment = await prisma.matchAssignment.findUnique({
    where: { id: input.matchAssignmentId },
  });

  if (!assignment || assignment.tournamentInstanceId !== input.tournamentInstanceId) {
    throw new Error("Final Round assignment not found for this tournament instance.");
  }

  if (
    assignment.teamId === null ||
    assignment.opponentTeamId === null ||
    assignment.tournamentInstanceId === null
  ) {
    throw new Error("Final Round assignment is missing required team linkage.");
  }

  const teamId = assignment.teamId;
  const opponentTeamId = assignment.opponentTeamId;

  if (assignment.stageName !== "FINAL_ROUND") {
    throw new Error("Official result entry is only available for Final Round assignments.");
  }

  const validWinnerIds = new Set([teamId, opponentTeamId]);

  for (const winnerId of [
    input.round1WinnerTeamId,
    input.round2WinnerTeamId,
    ...(input.round3Played && input.round3WinnerTeamId
      ? [input.round3WinnerTeamId]
      : []),
  ]) {
    if (!validWinnerIds.has(winnerId)) {
      throw new Error("Round winners must be one of the two assigned teams.");
    }
  }

  if (input.round3Played && !input.round3WinnerTeamId) {
    throw new Error("Round 3 winner is required when round 3 was played.");
  }

  const existing = await prisma.officialMatchResult.findUnique({
    where: { matchAssignmentId: input.matchAssignmentId },
  });

  if (existing && existing.status === OfficialMatchResultStatus.active) {
    throw new Error("An official result already exists for this match. Use Emergency Override to void it first.");
  }

  const scoreSummary = buildBo3Score(
    teamId,
    input.round1WinnerTeamId,
    input.round2WinnerTeamId,
    input.round3Played,
    input.round3WinnerTeamId
  );
  const frpAward = getFrpAwardByScore(scoreSummary.score);

  if (!frpAward) {
    throw new Error("Official result did not produce a valid BO3 score.");
  }

  const winnerTeamId =
    scoreSummary.teamScore > scoreSummary.opponentScore
      ? teamId
      : opponentTeamId;
  const loserTeamId =
    winnerTeamId === teamId ? opponentTeamId : teamId;

  const result = existing
    ? await prisma.officialMatchResult.update({
        where: { id: existing.id },
        data: {
          cycleNumber: assignment.cycleNumber,
          teamId,
          opponentTeamId,
          round1WinnerTeamId: input.round1WinnerTeamId,
          round2WinnerTeamId: input.round2WinnerTeamId,
          round3Played: input.round3Played,
          round3WinnerTeamId: input.round3WinnerTeamId ?? null,
          teamScore: scoreSummary.teamScore,
          opponentScore: scoreSummary.opponentScore,
          winnerTeamId,
          loserTeamId,
          score: scoreSummary.score,
          frpAwardedToTeam: frpAward.reportingTeam,
          frpAwardedToOpponent: frpAward.opponentTeam,
          enteredByDiscordUserId: input.enteredByDiscordUserId,
          status: OfficialMatchResultStatus.active,
          updatedAt: new Date(),
        },
      })
    : await prisma.officialMatchResult.create({
        data: {
          tournamentInstanceId: input.tournamentInstanceId,
          matchAssignmentId: input.matchAssignmentId,
          cycleNumber: assignment.cycleNumber,
          teamId,
          opponentTeamId,
          round1WinnerTeamId: input.round1WinnerTeamId,
          round2WinnerTeamId: input.round2WinnerTeamId,
          round3Played: input.round3Played,
          round3WinnerTeamId: input.round3WinnerTeamId ?? null,
          teamScore: scoreSummary.teamScore,
          opponentScore: scoreSummary.opponentScore,
          winnerTeamId,
          loserTeamId,
          score: scoreSummary.score,
          frpAwardedToTeam: frpAward.reportingTeam,
          frpAwardedToOpponent: frpAward.opponentTeam,
          enteredByDiscordUserId: input.enteredByDiscordUserId,
          status: OfficialMatchResultStatus.active,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

  await recomputeStandingsForTournamentInstance(input.tournamentInstanceId);

  await createAuditLog({
    action: "official_final_round_result_recorded",
    entityType: "match_assignment",
    entityId: `${assignment.id}`,
    summary: `Official result ${assignment.teamName} vs ${assignment.opponentTeamName}: ${scoreSummary.score.replace("_", "-")}.`,
    actorDiscordUserId: input.enteredByDiscordUserId,
  });

  await pushTournamentWebhookUpdate({
    tournamentInstanceId: input.tournamentInstanceId,
    reason: "official_result_recorded",
  });

  notifyPanelDataChanged({
    reason: "official_result_recorded",
    tournamentInstanceId: input.tournamentInstanceId,
    panelTypes: ["admin", "tournament", "team"],
  });

  return result;
}

export async function listOfficialResultsForTournamentInstance(
  tournamentInstanceId: number,
  cycleNumber?: number
) {
  return prisma.officialMatchResult.findMany({
    where: {
      tournamentInstanceId,
      status: OfficialMatchResultStatus.active,
      ...(cycleNumber === undefined ? {} : { cycleNumber }),
    },
    orderBy: [{ cycleNumber: "asc" }, { id: "asc" }],
  });
}

export async function getOfficialResultByMatchAssignmentId(matchAssignmentId: number) {
  return prisma.officialMatchResult.findUnique({
    where: { matchAssignmentId },
  });
}

export async function voidOfficialMatchResult(
  matchAssignmentId: number,
  actorDiscordUserId: string
) {
  const existing = await prisma.officialMatchResult.findUnique({
    where: { matchAssignmentId },
  });

  if (!existing || existing.status === OfficialMatchResultStatus.voided) {
    throw new Error("No active official result was found for that match.");
  }

  const updated = await prisma.officialMatchResult.update({
    where: { id: existing.id },
    data: {
      status: OfficialMatchResultStatus.voided,
      updatedAt: new Date(),
    },
  });

  await recomputeStandingsForTournamentInstance(existing.tournamentInstanceId);

  await createAuditLog({
    action: "official_final_round_result_voided",
    entityType: "match_assignment",
    entityId: `${matchAssignmentId}`,
    summary: `Voided official result for match assignment ${matchAssignmentId}.`,
    actorDiscordUserId,
  });

  await pushTournamentWebhookUpdate({
    tournamentInstanceId: existing.tournamentInstanceId,
    reason: "official_result_voided",
  });

  notifyPanelDataChanged({
    reason: "official_result_voided",
    tournamentInstanceId: existing.tournamentInstanceId,
    panelTypes: ["admin", "tournament", "team"],
  });

  return updated;
}

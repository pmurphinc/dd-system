import { TournamentInstanceStatus } from "@prisma/client";
import { getTournamentState } from "../mocks/tournamentState";
import { getStandings, getStandingsForTournamentInstance } from "../storage/standings";
import {
  getTournamentInstanceById,
  listTournamentInstancesForGuild,
} from "../storage/tournamentInstances";

export interface PublicTournamentStatePayload {
  eventWinner: string | null;
  status: string;
  currentLeader: string | null;
  updatedAt: string;
  tournamentId: string;
  cycle: number;
  isComplete: boolean;
}

function mapInstanceStatus(status: TournamentInstanceStatus, cycle: number | null): string {
  switch (status) {
    case TournamentInstanceStatus.REGISTRATION_READY:
      return "Registration Open";
    case TournamentInstanceStatus.CHECKIN_OPEN:
      return "Check-In Open";
    case TournamentInstanceStatus.TIEBREAKER_READY:
      return "Sudden Death";
    case TournamentInstanceStatus.COMPLETED:
      return "Complete";
    default:
      return cycle ? `Live - Cycle ${cycle}` : "Live";
  }
}

function mapLegacyStatus(status: string, cycle: number | null): string {
  if (status === "Registration Open") return "Registration Open";
  if (status === "Check-In Open") return "Check-In Open";
  if (status === "Completed") return "Complete";
  if (status === "Live" && cycle) return `Live - Cycle ${cycle}`;
  return status;
}

function resolveLeaderName(
  standings: Array<{ teamName: string; frp: number }>
): string | null {
  if (standings.length === 0) return null;
  const topFrp = standings[0]?.frp ?? 0;
  const leaders = standings.filter((standing) => standing.frp === topFrp);

  if (leaders.length === 1) {
    return leaders[0]?.teamName ?? null;
  }

  return null;
}

function normalizeCycleForPublicStatus(
  cycle: number | null | undefined,
  status: string
): number {
  if (status === "Registration Open" || status === "Check-In Open") {
    return 0;
  }

  if (typeof cycle !== "number" || !Number.isFinite(cycle) || cycle < 0) {
    return 0;
  }

  return cycle;
}

function normalizeTournamentId(rawId: string | null | undefined): string {
  const value = `${rawId ?? ""}`.trim();
  return value.length > 0 ? value : "default";
}

export async function buildPublicTournamentState(input?: {
  tournamentInstanceId?: number;
  guildId?: string;
}): Promise<PublicTournamentStatePayload | null> {
  let tournamentInstanceId = input?.tournamentInstanceId;

  if (!tournamentInstanceId && input?.guildId) {
    const instances = await listTournamentInstancesForGuild(input.guildId);
    tournamentInstanceId = instances[0]?.id;
  }

  if (tournamentInstanceId) {
    const [instance, standings] = await Promise.all([
      getTournamentInstanceById(tournamentInstanceId),
      getStandingsForTournamentInstance(tournamentInstanceId),
    ]);

    if (!instance) {
      return null;
    }

    const leader = resolveLeaderName(standings);
    const winner =
      instance.winningTeamId === null
        ? null
        : standings.find((standing) => standing.teamId === instance.winningTeamId)?.teamName ??
          null;
    const latestStandingUpdate = standings
      .map((standing) => standing.updatedAt.getTime())
      .sort((left, right) => right - left)[0];
    const updatedAt = new Date(
      Math.max(instance.updatedAt.getTime(), latestStandingUpdate ?? 0)
    );
    const status = mapInstanceStatus(instance.status, instance.currentCycle);

    return {
      eventWinner: winner,
      status,
      currentLeader: leader,
      updatedAt: updatedAt.toISOString(),
      tournamentId: normalizeTournamentId(`${instance.id}`),
      cycle: normalizeCycleForPublicStatus(instance.currentCycle, status),
      isComplete: instance.status === TournamentInstanceStatus.COMPLETED,
    };
  }

  const [legacyState, standings] = await Promise.all([getTournamentState(), getStandings()]);
  const leader = resolveLeaderName(standings);
  const winner = legacyState.tournamentStatus === "Completed" ? leader : null;
  const latestStandingUpdate = standings
    .map((standing) => standing.updatedAt.getTime())
    .sort((left, right) => right - left)[0];

  const status = mapLegacyStatus(legacyState.tournamentStatus, legacyState.currentCycle);

  return {
    eventWinner: winner,
    status,
    currentLeader: leader,
    updatedAt: new Date(latestStandingUpdate ?? 0).toISOString(),
    tournamentId: "legacy",
    cycle: normalizeCycleForPublicStatus(legacyState.currentCycle, status),
    isComplete: legacyState.tournamentStatus === "Completed",
  };
}

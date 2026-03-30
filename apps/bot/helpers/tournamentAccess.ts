import { TournamentInstanceStatus } from "@prisma/client";
import { StoredTournamentInstance } from "../storage/tournamentInstances";

type LegacyTournamentLike = {
  tournamentStatus?: string;
  currentStage?: string;
};

type TournamentLike = StoredTournamentInstance | LegacyTournamentLike | null;

export function isCheckInOpen(instance: TournamentLike): boolean {
  if (!instance) {
    return false;
  }

  const legacy = instance as LegacyTournamentLike;

  return (
    (instance as StoredTournamentInstance).status === TournamentInstanceStatus.CHECKIN_OPEN ||
    legacy.tournamentStatus === "Check-In Open" ||
    legacy.currentStage === "Check-In"
  );
}

export function isCashoutReady(instance: StoredTournamentInstance | null): boolean {
  return (
    instance?.status === TournamentInstanceStatus.CYCLE_1_CASHOUT_READY ||
    instance?.status === TournamentInstanceStatus.CYCLE_2_CASHOUT_READY ||
    instance?.status === TournamentInstanceStatus.CYCLE_3_CASHOUT_READY
  );
}

export function isFinalRoundReady(instance: StoredTournamentInstance | null): boolean {
  return (
    instance?.status === TournamentInstanceStatus.CYCLE_1_FINAL_ROUND_READY ||
    instance?.status === TournamentInstanceStatus.CYCLE_2_FINAL_ROUND_READY ||
    instance?.status === TournamentInstanceStatus.CYCLE_3_FINAL_ROUND_READY
  );
}

export function canLeaderSubmitInformationalReport(
  instance: StoredTournamentInstance | null
): boolean {
  return isFinalRoundReady(instance);
}

export function isFinalRoundReportingOpen(instance: TournamentLike): boolean {
  if (!instance) {
    return false;
  }

  const legacy = instance as LegacyTournamentLike;

  return (
    isFinalRoundReady(instance as StoredTournamentInstance) ||
    legacy.tournamentStatus === "Live" ||
    legacy.currentStage === "Final Round"
  );
}

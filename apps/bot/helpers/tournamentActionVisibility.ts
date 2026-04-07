import { TournamentInstanceStatus, TournamentStage } from "@prisma/client";

export interface TeamPanelActionAvailability {
  canCheckIn: boolean;
  canSubmitCashout: boolean;
  canEditCashout: boolean;
  canSubmitFinalRound: boolean;
  canEditFinalRound: boolean;
}

interface TeamPanelActionInput {
  isLeader: boolean;
  hasInstance: boolean;
  teamBelongsToInstance: boolean;
  isCheckInOpen: boolean;
  isTeamCheckedIn: boolean;
  currentStage: TournamentStage | null;
  currentCycle: number | null;
  hasCurrentStageAssignment: boolean;
  hasCurrentStageSubmission: boolean;
  isCurrentStageSubmissionEditable: boolean;
  currentSubmissionType: "CASHOUT_PLACEMENT" | "FINAL_ROUND_SCORE" | null;
}

export function getAvailableTeamPanelActions(
  input: TeamPanelActionInput
): TeamPanelActionAvailability {
  const {
    isLeader,
    hasInstance,
    teamBelongsToInstance,
    isCheckInOpen,
    isTeamCheckedIn,
    currentStage,
    currentCycle,
    hasCurrentStageAssignment,
    hasCurrentStageSubmission,
    isCurrentStageSubmissionEditable,
    currentSubmissionType,
  } = input;

  if (!isLeader || !hasInstance || !teamBelongsToInstance) {
    return {
      canCheckIn: false,
      canSubmitCashout: false,
      canEditCashout: false,
      canSubmitFinalRound: false,
      canEditFinalRound: false,
    };
  }

  const isCashout = currentStage === TournamentStage.CASHOUT;
  const isFinalRound = currentStage === TournamentStage.FINAL_ROUND;
  const isCompleted = currentStage === TournamentStage.COMPLETE;

  const canCheckIn =
    isCheckInOpen &&
    !isTeamCheckedIn &&
    !isCashout &&
    !isFinalRound &&
    !isCompleted;

  const canSubmitCashout = isCashout && currentCycle !== null;
  const canEditCashout =
    isCashout &&
    hasCurrentStageSubmission &&
    isCurrentStageSubmissionEditable &&
    currentSubmissionType === "CASHOUT_PLACEMENT";

  const canSubmitFinalRound =
    isFinalRound && currentCycle !== null && hasCurrentStageAssignment;
  const canEditFinalRound =
    isFinalRound &&
    hasCurrentStageSubmission &&
    isCurrentStageSubmissionEditable &&
    currentSubmissionType === "FINAL_ROUND_SCORE";

  return {
    canCheckIn,
    canSubmitCashout,
    canEditCashout,
    canSubmitFinalRound,
    canEditFinalRound,
  };
}

export interface TournamentPanelActionAvailability {
  canOpenCheckIn: boolean;
  canCloseCheckIn: boolean;
  canForceCheckIn: boolean;
  canStartCycle1: boolean;
  canStartCycle2: boolean;
  canStartCycle3: boolean;
  canReviewTeamSubmissions: boolean;
  canStartFinalRound: boolean;
  canApproveFinalRoundStage: boolean;
  canFinalizeCycle: boolean;
  canFinishTournament: boolean;
  canRestartTournament: boolean;
  canRefresh: boolean;
  canChangeInstance: boolean;
}

interface TournamentPanelActionInput {
  status: TournamentInstanceStatus;
  currentStage: TournamentStage;
  currentCycle: number | null;
  isCheckInOpen: boolean;
  checkedInCount: number;
  maxTeams: number;
  hasUncheckedTeams: boolean;
  hasCashoutAdvancementData: boolean;
  finalRoundOfficialResultsCount: number;
}

export function getAvailableTournamentPanelActions(
  input: TournamentPanelActionInput
): TournamentPanelActionAvailability {
  const {
    status,
    currentStage,
    currentCycle,
    isCheckInOpen,
    checkedInCount,
    maxTeams,
    hasUncheckedTeams,
    hasCashoutAdvancementData,
    finalRoundOfficialResultsCount,
  } = input;

  const isRegistrationOrCheckin =
    currentStage === TournamentStage.REGISTRATION ||
    currentStage === TournamentStage.CHECKIN;
  const isCashout = currentStage === TournamentStage.CASHOUT;
  const isFinalRound = currentStage === TournamentStage.FINAL_ROUND;

  const canOpenCheckIn =
    isRegistrationOrCheckin &&
    !isCheckInOpen &&
    currentCycle !== 2 &&
    currentCycle !== 3 &&
    status !== TournamentInstanceStatus.CYCLE_1_COMPLETE &&
    status !== TournamentInstanceStatus.CYCLE_2_COMPLETE &&
    status !== TournamentInstanceStatus.CYCLE_3_COMPLETE &&
    status !== TournamentInstanceStatus.TIEBREAKER_READY &&
    status !== TournamentInstanceStatus.COMPLETED;

  const canCloseCheckIn = isRegistrationOrCheckin && isCheckInOpen && currentCycle === 1;

  const canForceCheckIn =
    currentStage === TournamentStage.CHECKIN &&
    isCheckInOpen &&
    hasUncheckedTeams &&
    status !== TournamentInstanceStatus.COMPLETED &&
    status !== TournamentInstanceStatus.TIEBREAKER_READY;

  const canStartCycle1 =
    isRegistrationOrCheckin && currentCycle === 1 && checkedInCount >= maxTeams;

  const canReviewTeamSubmissions = isCashout || isFinalRound;

  const canStartFinalRound = isCashout && hasCashoutAdvancementData;
  const canApproveFinalRoundStage = isFinalRound && finalRoundOfficialResultsCount < 2;
  const canFinalizeCycle = isFinalRound && finalRoundOfficialResultsCount >= 2;

  const canStartCycle2 =
    status === TournamentInstanceStatus.CYCLE_1_COMPLETE &&
    currentStage === TournamentStage.COMPLETE &&
    currentCycle === 1;

  const canStartCycle3 =
    status === TournamentInstanceStatus.CYCLE_2_COMPLETE &&
    currentStage === TournamentStage.COMPLETE &&
    currentCycle === 2;

  const canFinishTournament =
    status === TournamentInstanceStatus.CYCLE_3_COMPLETE &&
    currentStage === TournamentStage.COMPLETE &&
    currentCycle === 3;

  return {
    canOpenCheckIn,
    canCloseCheckIn,
    canForceCheckIn,
    canStartCycle1,
    canStartCycle2,
    canStartCycle3,
    canReviewTeamSubmissions,
    canStartFinalRound,
    canApproveFinalRoundStage,
    canFinalizeCycle,
    canFinishTournament,
    canRestartTournament: true,
    canRefresh: true,
    canChangeInstance: true,
  };
}

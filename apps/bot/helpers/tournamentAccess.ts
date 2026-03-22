import { MockTournamentState } from "../mocks/tournamentState";

export function isCheckInOpen(tournamentState: MockTournamentState): boolean {
  return (
    tournamentState.tournamentStatus === "Check-In Open" ||
    tournamentState.currentStage === "Check-In"
  );
}

export function isFinalRoundReportingOpen(
  tournamentState: MockTournamentState
): boolean {
  return (
    tournamentState.tournamentStatus === "Live" &&
    tournamentState.currentStage === "Final Round"
  );
}

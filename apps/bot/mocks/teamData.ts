import { GuildMemberRoleManager } from "discord.js";
import { getTeamForUser } from "../storage/teams";

export interface TeamPanelData {
  teamName: string;
  captainName: string;
  playerNames: string[];
  substituteName: string;
  approvalStatus: string;
  checkInStatus: string;
}

export function getDefaultDevelopmentTeams(): TeamPanelData[] {
  return [];
}

export async function getTeamPanelData(
  reportingUserKey: string,
  memberRoles?: GuildMemberRoleManager
): Promise<TeamPanelData> {
  const team = await getTeamForUser(reportingUserKey, memberRoles);

  if (!team) {
    return {
      teamName: "No team linked",
      captainName: "Unknown",
      playerNames: [],
      substituteName: "-",
      approvalStatus: "Not Imported",
      checkInStatus: "Not Checked In",
    };
  }

  return {
    teamName: team.teamName,
    captainName: team.captainName,
    playerNames: team.playerNames,
    substituteName: team.substituteName || "-",
    approvalStatus: team.approvalStatus,
    checkInStatus: team.checkInStatus,
  };
}

export type MockTeamData = TeamPanelData;
export const getMockTeamData = getTeamPanelData;

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, GuildMemberRoleManager } from "discord.js";
import { getTeamLeaderAccessDebug } from "./permissions";
import { getTeamById, getTeamForUser } from "../storage/teams";
import { getScrimStateForTeam } from "../storage/scrims";

function formatTs(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return `<t:${Math.floor(date.getTime() / 1000)}:R> (<t:${Math.floor(date.getTime() / 1000)}:f>)`;
}

function statusLabel(status?: string | null): string {
  switch (status) {
    case "LOOKING":
      return "Looking for Scrim";
    case "MATCHED":
      return "Matched";
    case "IN_LOBBY_SETUP":
      return "In Lobby Setup";
    case "READY":
      return "Ready";
    case "ACTIVE":
      return "Active Scrim";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    case "EXPIRED":
      return "Expired";
    default:
      return "Idle";
  }
}

type ScrimPanelStatus =
  | "IDLE"
  | "LOOKING"
  | "MATCHED"
  | "IN_LOBBY_SETUP"
  | "READY"
  | "ACTIVE"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

interface ScrimActionVisibility {
  canLookForScrim: boolean;
  canCancelSearch: boolean;
  canSetLobbyCode: boolean;
  canMarkReady: boolean;
  canLeaveMatch: boolean;
  canCompleteScrim: boolean;
  canRequeue: boolean;
  canRequestNewMap: boolean;
  canClearLobbyCode: boolean;
  canViewQueue: boolean;
  canViewMatches: boolean;
}

function getScrimActionVisibility(input: {
  status: ScrimPanelStatus;
  hasActiveMatch: boolean;
  teamReady: boolean;
  canManageTeam: boolean;
  isAdminViewer: boolean;
}): ScrimActionVisibility {
  const { status, hasActiveMatch, teamReady, canManageTeam, isAdminViewer } = input;
  const isMatchedFlow = status === "MATCHED" || status === "IN_LOBBY_SETUP";
  const isActiveFlow = status === "READY" || status === "ACTIVE";
  const isPostMatch = status === "COMPLETED" || status === "CANCELLED" || status === "EXPIRED";

  return {
    canLookForScrim: canManageTeam && status === "IDLE",
    canCancelSearch: canManageTeam && status === "LOOKING",
    canSetLobbyCode: canManageTeam && hasActiveMatch && (isMatchedFlow || isActiveFlow),
    canMarkReady: canManageTeam && hasActiveMatch && (isMatchedFlow || isActiveFlow) && !teamReady,
    canLeaveMatch: canManageTeam && hasActiveMatch && (isMatchedFlow || isActiveFlow),
    canCompleteScrim: canManageTeam && hasActiveMatch && isActiveFlow,
    canRequeue: canManageTeam && isPostMatch,
    canRequestNewMap: canManageTeam && status === "COMPLETED",
    canClearLobbyCode: isAdminViewer && hasActiveMatch && (isMatchedFlow || isActiveFlow),
    canViewQueue: isAdminViewer && !isActiveFlow,
    canViewMatches: isAdminViewer,
  };
}

function chunkButtons(buttons: ButtonBuilder[], chunkSize = 4) {
  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];
  for (let index = 0; index < buttons.length; index += chunkSize) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...buttons.slice(index, index + chunkSize)
      )
    );
  }
  return rows;
}

export async function buildScrimPanel(params: {
  guildId: string;
  userId: string;
  memberRoles: GuildMemberRoleManager;
  forcedTeamId?: number;
  isAdminViewer?: boolean;
}) {
  const { guildId, userId, memberRoles, forcedTeamId, isAdminViewer } = params;

  const team = forcedTeamId ? await getTeamById(forcedTeamId) : await getTeamForUser(userId, memberRoles);
  if (!team) {
    return {
      embeds: [new EmbedBuilder().setTitle("Scrim Panel").setDescription("No linked team was found.")],
      components: [],
    };
  }

  const scrim = await getScrimStateForTeam(guildId, team.id);
  const opponentTeam = scrim.teamState?.opponentTeamId
    ? await getTeamById(scrim.teamState.opponentTeamId)
    : null;

  const leaderAccess = await getTeamLeaderAccessDebug(guildId, memberRoles, team, userId);
  const isLeader = leaderAccess.isLeader;

  const activeStatus = (scrim.activeMatch?.status ??
    scrim.activeQueue?.status ??
    scrim.teamState?.status ??
    "IDLE") as ScrimPanelStatus;
  const teamIsA = scrim.activeMatch?.teamAId === team.id;
  const teamReady = teamIsA
    ? Boolean(scrim.activeMatch?.teamAReadyAt)
    : Boolean(scrim.activeMatch?.teamBReadyAt);
  const visibility = getScrimActionVisibility({
    status: activeStatus,
    hasActiveMatch: Boolean(scrim.activeMatch),
    teamReady,
    canManageTeam: isLeader || Boolean(isAdminViewer),
    isAdminViewer: Boolean(isAdminViewer),
  });
  const teamA = scrim.activeMatch ? await getTeamById(scrim.activeMatch.teamAId) : null;
  const teamB = scrim.activeMatch ? await getTeamById(scrim.activeMatch.teamBId) : null;
  const readyStateLabel = scrim.activeMatch
    ? `${teamA?.teamName ?? `Team ${scrim.activeMatch.teamAId}`}: ${
        scrim.activeMatch.teamAReadyAt ? "✅ Ready" : "❌ Not Ready"
      }\n${teamB?.teamName ?? `Team ${scrim.activeMatch.teamBId}`}: ${
        scrim.activeMatch.teamBReadyAt ? "✅ Ready" : "❌ Not Ready"
      }`
    : "No active match";
  const notes =
    activeStatus === "LOOKING"
      ? "Waiting in queue. You can cancel search anytime."
      : activeStatus === "MATCHED"
        ? "Match found. Set lobby code and mark ready."
        : activeStatus === "IN_LOBBY_SETUP"
          ? "Lobby code is being coordinated."
          : activeStatus === "READY"
            ? "Waiting for both team leaders to be ready."
            : activeStatus === "ACTIVE"
              ? "Scrim active. Complete or leave when done."
              : "Use Looking for Scrim to start a new practice BO3 Final Round.";

  const embed = new EmbedBuilder()
    .setTitle("Development Division Scrim Panel")
    .addFields(
      { name: "Team", value: team.teamName, inline: true },
      { name: "Status", value: statusLabel(activeStatus), inline: true },
      { name: "Opponent", value: opponentTeam?.teamName ?? "None", inline: true },
      { name: "Map", value: scrim.activeMatch?.map ?? "Not assigned", inline: true },
      {
        name: "Queue Expiration",
        value: scrim.activeQueue?.expiresAt ? formatTs(scrim.activeQueue.expiresAt) : "-",
        inline: true,
      },
      {
        name: "Lobby Code",
        value: scrim.activeMatch?.lobbyCode
          ? `\`${scrim.activeMatch.lobbyCode}\`\nSet by <@${scrim.activeMatch.lobbyCodeSetByDiscordUserId}> ${formatTs(scrim.activeMatch.lobbyCodeSetAt)}`
          : "Lobby code not yet provided",
        inline: false,
      },
      {
        name: "Ready States",
        value: readyStateLabel,
        inline: true,
      },
      {
        name: "Last Updated",
        value: formatTs(scrim.teamState?.lastUpdatedAt ?? scrim.activeMatch?.updatedAt ?? scrim.activeQueue?.updatedAt),
        inline: true,
      },
      { name: "Notes", value: notes, inline: false }
    );

  const components: Array<ActionRowBuilder<ButtonBuilder>> = [];
  const primaryButtons: ButtonBuilder[] = [];

  if (visibility.canLookForScrim) {
    primaryButtons.push(
      new ButtonBuilder()
        .setCustomId(`scrim:looking:${team.id}`)
        .setLabel("Looking for Scrim")
        .setStyle(ButtonStyle.Success)
    );
  }
  if (visibility.canCancelSearch) {
    primaryButtons.push(
      new ButtonBuilder()
        .setCustomId(`scrim:cancel:${team.id}`)
        .setLabel("Cancel Search")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (visibility.canSetLobbyCode) {
    primaryButtons.push(
      new ButtonBuilder()
        .setCustomId(`scrim:set_code:${team.id}`)
        .setLabel(scrim.activeMatch?.lobbyCode ? "Edit Lobby Code" : "Set Lobby Code")
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (visibility.canMarkReady) {
    primaryButtons.push(
      new ButtonBuilder()
        .setCustomId(`scrim:ready:${team.id}`)
        .setLabel("Mark Ready")
        .setStyle(ButtonStyle.Success)
    );
  }
  if (visibility.canLeaveMatch) {
    primaryButtons.push(
      new ButtonBuilder()
        .setCustomId(`scrim:leave:${team.id}`)
        .setLabel("Leave Match")
        .setStyle(ButtonStyle.Danger)
    );
  }
  if (visibility.canCompleteScrim) {
    primaryButtons.push(
      new ButtonBuilder()
        .setCustomId(`scrim:complete:${team.id}`)
        .setLabel("Complete Scrim")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (visibility.canRequeue) {
    primaryButtons.push(
      new ButtonBuilder()
        .setCustomId(`scrim:requeue:${team.id}`)
        .setLabel("Requeue")
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (visibility.canRequestNewMap) {
    primaryButtons.push(
      new ButtonBuilder()
        .setCustomId(`scrim:rematch:${team.id}`)
        .setLabel("Request New Map")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  primaryButtons.push(
    new ButtonBuilder()
      .setCustomId(`scrim:refresh:${team.id}`)
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary)
  );

  components.push(...chunkButtons(primaryButtons));

  if (isAdminViewer) {
    const adminButtons: ButtonBuilder[] = [];
    if (visibility.canViewQueue) {
      adminButtons.push(
        new ButtonBuilder()
          .setCustomId(`scrim:admin_queue:${team.id}`)
          .setLabel("View Queue")
          .setStyle(ButtonStyle.Secondary)
      );
    }
    if (visibility.canViewMatches) {
      adminButtons.push(
        new ButtonBuilder()
          .setCustomId(`scrim:admin_matches:${team.id}`)
          .setLabel("View Matches")
          .setStyle(ButtonStyle.Secondary)
      );
    }

    if (visibility.canClearLobbyCode) {
      adminButtons.push(
        new ButtonBuilder()
          .setCustomId(`scrim:admin_clear_code:${team.id}`)
          .setLabel("Clear Lobby Code")
          .setStyle(ButtonStyle.Danger)
      );
    }

    if (adminButtons.length > 0) {
      components.push(...chunkButtons(adminButtons));
    }
  }

  return { embeds: [embed], components };
}

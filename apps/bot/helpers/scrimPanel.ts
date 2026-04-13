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

  const activeStatus = scrim.activeMatch?.status ?? scrim.activeQueue?.status ?? scrim.teamState?.status ?? "IDLE";
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
        value: scrim.activeMatch
          ? `Team A: ${scrim.activeMatch.teamAReadyAt ? "✅" : "❌"}\nTeam B: ${scrim.activeMatch.teamBReadyAt ? "✅" : "❌"}`
          : "No active match",
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

  const refreshRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`scrim:refresh:${team.id}`).setLabel("Refresh").setStyle(ButtonStyle.Secondary)
  );

  if (isLeader || isAdminViewer) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`scrim:looking:${team.id}`).setLabel("Looking for Scrim").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`scrim:cancel:${team.id}`).setLabel("Cancel Search").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`scrim:set_code:${team.id}`).setLabel("Set Lobby Code").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`scrim:ready:${team.id}`).setLabel("Mark Ready").setStyle(ButtonStyle.Success),
      )
    );

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`scrim:leave:${team.id}`).setLabel("Leave Match").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`scrim:complete:${team.id}`).setLabel("Complete Scrim").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`scrim:requeue:${team.id}`).setLabel("Requeue").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`scrim:rematch:${team.id}`).setLabel("Request New Map").setStyle(ButtonStyle.Secondary),
      )
    );
  }

  if (isAdminViewer) {
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`scrim:admin_queue:${team.id}`).setLabel("View Queue").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`scrim:admin_matches:${team.id}`).setLabel("View Matches").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`scrim:admin_clear_code:${team.id}`).setLabel("Clear Lobby Code").setStyle(ButtonStyle.Danger)
      )
    );
  }

  components.push(refreshRow);

  return { embeds: [embed], components };
}

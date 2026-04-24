import {
  ChannelType,
  ChatInputCommandInteraction,
  GuildBasedChannel,
  PermissionsBitField,
  TextChannel,
} from "discord.js";
import { StoredTeam } from "../storage/teams";

export type TeamChannelSafetyResult =
  | { kind: "shared_or_unknown" }
  | { kind: "correct_team_private_channel" }
  | { kind: "wrong_team_private_channel" };

type TeamPanelChannel = TextChannel;

function isGuildTextChannel(channel: GuildBasedChannel): channel is TeamPanelChannel {
  return channel.type === ChannelType.GuildText;
}

function hasDeniedEveryoneView(channel: TeamPanelChannel): boolean {
  const everyoneOverwrite = channel.permissionOverwrites.cache.get(channel.guild.roles.everyone.id);
  if (!everyoneOverwrite) {
    return false;
  }
  return everyoneOverwrite.deny.has(PermissionsBitField.Flags.ViewChannel);
}

function hasAllowedRoleView(channel: TeamPanelChannel, roleId: string): boolean {
  const overwrite = channel.permissionOverwrites.cache.get(roleId);
  if (!overwrite) {
    return false;
  }
  return overwrite.allow.has(PermissionsBitField.Flags.ViewChannel);
}

export async function evaluateTeamPanelChannelSafety(
  interaction: ChatInputCommandInteraction,
  team: StoredTeam
): Promise<TeamChannelSafetyResult> {
  if (!interaction.inCachedGuild()) {
    return { kind: "shared_or_unknown" };
  }

  const channel = interaction.channel;
  if (!channel || !isGuildTextChannel(channel)) {
    return { kind: "shared_or_unknown" };
  }

  if (!hasDeniedEveryoneView(channel)) {
    return { kind: "shared_or_unknown" };
  }

  if (team.discordRoleId && hasAllowedRoleView(channel, team.discordRoleId)) {
    return { kind: "correct_team_private_channel" };
  }

  return { kind: "wrong_team_private_channel" };
}

export function evaluateTrackedTeamPanelChannelSafety(
  channel: GuildBasedChannel,
  team: StoredTeam
): TeamChannelSafetyResult {
  if (!isGuildTextChannel(channel)) {
    return { kind: "shared_or_unknown" };
  }

  if (!hasDeniedEveryoneView(channel)) {
    return { kind: "shared_or_unknown" };
  }

  if (team.discordRoleId && hasAllowedRoleView(channel, team.discordRoleId)) {
    return { kind: "correct_team_private_channel" };
  }

  return { kind: "wrong_team_private_channel" };
}

import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  GuildMemberRoleManager,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuInteraction,
} from "discord.js";
import { getGuildConfig, upsertGuildConfig } from "../storage/guildConfig";
import { getTeamForUser, StoredTeam } from "../storage/teams";

type ConfiguredRole = "admin" | "founder" | "teamLeader" | "player";

interface ResolvedRoleIds {
  adminRoleIds: string[];
  founderRoleId: string | null;
  teamLeaderRoleId: string | null;
  playerRoleId: string | null;
}

interface MemberAccessFlags {
  isAdmin: boolean;
  isFounder: boolean;
  isTeamLeader: boolean;
  isPlayer: boolean;
  roleIds: Set<string>;
}

export interface TeamLeaderAccessDebug {
  hasTeamRole: boolean;
  hasBaseTeamLeaderRole: boolean;
  matchesStoredLeaderId: boolean;
  matchesLeaderMemberId: boolean;
  isRoleBasedLeader: boolean;
  isLeader: boolean;
  note: string | null;
}

interface CommandAccessPolicy {
  requiresGuild?: boolean;
  allowedRoles?: ConfiguredRole[];
  requireLinkedTeam?: boolean;
  bypassTeamLinkForRoles?: ConfiguredRole[];
}

export const slashCommandAccessPolicies: Record<string, CommandAccessPolicy> = {
  ping: {},
  help: {},
  register: {},
  standings: {},
  team: {
    requiresGuild: true,
    allowedRoles: ["player", "teamLeader"],
    requireLinkedTeam: true,
  },
  report: {
    requiresGuild: true,
    allowedRoles: ["teamLeader"],
    requireLinkedTeam: true,
  },
  checkin: {
    requiresGuild: true,
    allowedRoles: ["player", "teamLeader"],
    requireLinkedTeam: true,
  },
  match: {
    requiresGuild: true,
    allowedRoles: ["teamLeader", "admin"],
    requireLinkedTeam: true,
    bypassTeamLinkForRoles: ["admin"],
  },
  review: {
    requiresGuild: true,
    allowedRoles: ["admin"],
  },
  reports: {
    requiresGuild: true,
    allowedRoles: ["admin"],
  },
  tournament: {
    requiresGuild: true,
    allowedRoles: ["admin"],
  },
  status: {
    requiresGuild: true,
    allowedRoles: ["admin"],
  },
  admin: {
    requiresGuild: true,
    allowedRoles: ["founder"],
  },
  cycleresults: {
    requiresGuild: true,
    allowedRoles: ["admin"],
  },
  syncstatus: {
    requiresGuild: true,
    allowedRoles: ["admin"],
  },
};

function getEnvRoleId(name: string): string | null {
  return process.env[name]?.trim() || null;
}
function findRoleIdByName(
  roles: GuildMemberRoleManager,
  names: string[]
): string | null {
  const loweredNames = names.map((name) => name.trim().toLowerCase());

  const found = roles.cache.find((role) =>
    loweredNames.includes(role.name.trim().toLowerCase())
  );

  return found?.id ?? null;
}

async function ensureGuildRoleConfig(
  guildId: string,
  roles: GuildMemberRoleManager
) {
  const existingConfig = await getGuildConfig(guildId);

  const adminRoleId =
    existingConfig?.adminRoleId ??
    getEnvRoleId("ADMIN_ROLE_ID") ??
    findRoleIdByName(roles, ["Admin"]);

  const founderRoleId =
    existingConfig?.founderRoleId ??
    getEnvRoleId("FOUNDER_ROLE_ID") ??
    findRoleIdByName(roles, ["Founder"]);

  const teamLeaderRoleId =
    existingConfig?.teamLeaderRoleId ??
    getEnvRoleId("TEAM_LEADER_ROLE_ID") ??
    findRoleIdByName(roles, ["Team Leader", "TeamLeader"]);

  const playerRoleId =
    existingConfig?.playerRoleId ??
    getEnvRoleId("PLAYER_ROLE_ID") ??
    findRoleIdByName(roles, ["Player", "Players"]);

  if (
    existingConfig?.adminRoleId === adminRoleId &&
    existingConfig?.founderRoleId === founderRoleId &&
    existingConfig?.teamLeaderRoleId === teamLeaderRoleId &&
    existingConfig?.playerRoleId === playerRoleId
  ) {
    return existingConfig;
  }

  return upsertGuildConfig({
    guildId,
    teamVoiceCategoryId: existingConfig?.teamVoiceCategoryId ?? null,
    adminRoleId,
    founderRoleId,
    teamLeaderRoleId,
    playerRoleId,
  });
}
async function resolveConfiguredRoleIds(
  guildId: string,
  roles: GuildMemberRoleManager
): Promise<ResolvedRoleIds> {
  const config = await ensureGuildRoleConfig(guildId, roles);

  const adminRoleIds = [config?.adminRoleId, config?.founderRoleId].filter(
    (roleId): roleId is string => Boolean(roleId)
  );

  return {
    adminRoleIds,
    founderRoleId: config?.founderRoleId ?? null,
    teamLeaderRoleId: config?.teamLeaderRoleId ?? null,
    playerRoleId: config?.playerRoleId ?? null,
  };
}

async function resolveMemberAccessFlags(
  guildId: string,
  roles: GuildMemberRoleManager
): Promise<MemberAccessFlags> {
const configuredRoles = await resolveConfiguredRoleIds(guildId, roles);

    const hasDiscordAdmin = roles.member.permissions.has(
    PermissionFlagsBits.Administrator
  );

  return {
    isFounder: configuredRoles.founderRoleId
      ? roles.cache.has(configuredRoles.founderRoleId)
      : false,
    isAdmin:
      hasDiscordAdmin ||
      configuredRoles.adminRoleIds.some((roleId) => roles.cache.has(roleId)),
    isTeamLeader: configuredRoles.teamLeaderRoleId
      ? roles.cache.has(configuredRoles.teamLeaderRoleId)
      : false,
    isPlayer: configuredRoles.playerRoleId
      ? roles.cache.has(configuredRoles.playerRoleId)
      : false,
    roleIds: new Set(roles.cache.keys()),
  };
}

function hasAnyAllowedRole(
  memberAccess: MemberAccessFlags,
  allowedRoles: ConfiguredRole[]
): boolean {
  return allowedRoles.some((role) => {
    if (role === "admin") {
      return memberAccess.isAdmin || memberAccess.isFounder;
    }

    if (role === "founder") {
      return memberAccess.isFounder;
    }

    if (role === "teamLeader") {
      return memberAccess.isTeamLeader;
    }

    return memberAccess.isPlayer;
  });
}

function hasAnyBypassRole(
  memberAccess: MemberAccessFlags,
  bypassRoles: ConfiguredRole[]
): boolean {
  return hasAnyAllowedRole(memberAccess, bypassRoles);
}

export async function authorizeSlashCommand(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  const policy = slashCommandAccessPolicies[interaction.commandName];

  if (!policy) {
    await interaction.reply({
      content: "You do not have permission to use this command.",
      ephemeral: true,
    });
    return false;
  }

  if (!policy.requiresGuild) {
    return true;
  }

  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: "You do not have permission to use this command.",
      ephemeral: true,
    });
    return false;
  }

  const memberAccess = await resolveMemberAccessFlags(
    interaction.guildId,
    interaction.member.roles
  );

  if (
    policy.allowedRoles &&
    !hasAnyAllowedRole(memberAccess, policy.allowedRoles)
  ) {
    await interaction.reply({
      content: "You do not have permission to use this command.",
      ephemeral: true,
    });
    return false;
  }

  if (
    policy.requireLinkedTeam &&
    !hasAnyBypassRole(memberAccess, policy.bypassTeamLinkForRoles ?? [])
  ) {
    const linkedTeam = await getTeamForUser(
      interaction.user.id,
      interaction.member.roles
    );

    if (!linkedTeam) {
      await interaction.reply({
        content: "You do not have permission to use this command.",
        ephemeral: true,
      });
      return false;
    }
  }

  return true;
}

export async function hasAdminCommandAccess(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  if (!interaction.inCachedGuild()) {
    return false;
  }

  const memberAccess = await resolveMemberAccessFlags(
    interaction.guildId,
    interaction.member.roles
  );
  return memberAccess.isAdmin;
}

export async function hasFounderCommandAccess(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  if (!interaction.inCachedGuild()) {
    return false;
  }

  const memberAccess = await resolveMemberAccessFlags(
    interaction.guildId,
    interaction.member.roles
  );
  return memberAccess.isFounder;
}

export async function hasAdminInteractionAccess(
  interaction:
    | ButtonInteraction
    | ModalSubmitInteraction
    | StringSelectMenuInteraction
): Promise<boolean> {
  if (!interaction.inCachedGuild()) {
    return false;
  }

  const memberAccess = await resolveMemberAccessFlags(
    interaction.guildId,
    interaction.member.roles
  );
  return memberAccess.isAdmin;
}

export async function hasFounderInteractionAccess(
  interaction:
    | ButtonInteraction
    | ModalSubmitInteraction
    | StringSelectMenuInteraction
): Promise<boolean> {
  if (!interaction.inCachedGuild()) {
    return false;
  }

  const memberAccess = await resolveMemberAccessFlags(
    interaction.guildId,
    interaction.member.roles
  );
  return memberAccess.isFounder;
}

export async function hasTeamLeaderAccessForTeam(
  guildId: string,
  roles: GuildMemberRoleManager,
  team: StoredTeam,
  userId: string
): Promise<boolean> {
  const debug = await getTeamLeaderAccessDebug(guildId, roles, team, userId);
  return debug.isLeader;
}

export async function getTeamLeaderAccessDebug(
  guildId: string,
  roles: GuildMemberRoleManager,
  team: StoredTeam,
  userId: string
): Promise<TeamLeaderAccessDebug> {
  const memberAccess = await resolveMemberAccessFlags(guildId, roles);
  const hasTeamRole = team.discordRoleId
    ? memberAccess.roleIds.has(team.discordRoleId)
    : false;
  const matchesStoredLeaderId =
    Boolean(team.leaderDiscordUserId) && team.leaderDiscordUserId === userId;
  const matchesLeaderMemberId = team.members.some(
    (member) => member.isLeader && member.discordUserId === userId
  );
  const isRoleBasedLeader = memberAccess.isTeamLeader && hasTeamRole;
  const isLeader =
    matchesStoredLeaderId || matchesLeaderMemberId || isRoleBasedLeader;

  let note: string | null = null;

  if (
    Boolean(team.leaderDiscordUserId) &&
    team.leaderDiscordUserId !== userId &&
    isRoleBasedLeader
  ) {
    note =
      "Stored leader ID does not match the acting user, but role-based leader access is allowing the action.";
    console.warn("[team-leader-access-mismatch]", {
      teamId: team.id,
      teamName: team.teamName,
      storedLeaderDiscordUserId: team.leaderDiscordUserId,
      actingUserId: userId,
      hasTeamRole,
      hasBaseTeamLeaderRole: memberAccess.isTeamLeader,
    });
  } else if (!isLeader) {
    note =
      "Leader access requires a stored leader match or both the team role and base Team Leader role.";
  }

  return {
    hasTeamRole,
    hasBaseTeamLeaderRole: memberAccess.isTeamLeader,
    matchesStoredLeaderId,
    matchesLeaderMemberId,
    isRoleBasedLeader,
    isLeader,
    note,
  };
}

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

// Founder is treated as a superset of admin access. These aliases are the
// accepted human-managed Discord role names when a guild-specific role ID has
// not been configured yet.
const ADMIN_ROLE_NAME_ALIASES = ["Admin", "Admins", "Administrator"] as const;
const FOUNDER_ROLE_NAME_ALIASES = ["Founder"] as const;

interface ResolvedRoleIds {
  adminRoleId: string | null;
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

type SupportedInteraction =
  | ButtonInteraction
  | ModalSubmitInteraction
  | StringSelectMenuInteraction;

export interface TeamLeaderAccessDebug {
  hasTeamRole: boolean;
  hasBaseTeamLeaderRole: boolean;
  matchesStoredLeaderId: boolean;
  matchesLeaderMemberId: boolean;
  isRoleBasedLeader: boolean;
  isLeader: boolean;
  note: string | null;
}

type TeamPanelAccessReason =
  | "admin_override"
  | "missing_team_leader_role"
  | "not_member_of_team"
  | "not_team_leader"
  | "allowed";

export interface TeamPanelAccessResult {
  allowed: boolean;
  reason: TeamPanelAccessReason;
  leaderAccess: TeamLeaderAccessDebug;
}

export type TournamentPanelAccessReason =
  | "not_in_guild"
  | "founder"
  | "guild_owner"
  | "discord_admin_permission"
  | "configured_admin_role"
  | "admin_role_name_fallback"
  | "missing_founder_or_admin";

export function evaluateTournamentPanelAccessDecision(params: {
  inGuild: boolean;
  isFounder: boolean;
  isGuildOwner: boolean;
  hasDiscordAdministratorPermission: boolean;
  hasConfiguredAdminRole: boolean;
  hasAdminRoleNameFallback: boolean;
}): { allowed: boolean; reason: TournamentPanelAccessReason } {
  if (!params.inGuild) {
    return { allowed: false, reason: "not_in_guild" };
  }

  if (params.isFounder) {
    return { allowed: true, reason: "founder" };
  }

  if (params.isGuildOwner) {
    return { allowed: true, reason: "guild_owner" };
  }

  if (params.hasDiscordAdministratorPermission) {
    return { allowed: true, reason: "discord_admin_permission" };
  }

  if (params.hasConfiguredAdminRole) {
    return { allowed: true, reason: "configured_admin_role" };
  }

  if (params.hasAdminRoleNameFallback) {
    return { allowed: true, reason: "admin_role_name_fallback" };
  }

  return { allowed: false, reason: "missing_founder_or_admin" };
}

export function evaluateTeamPanelAccessDecision(params: {
  isAdminOverride: boolean;
  hasTeamLeaderRole: boolean;
  isMemberOfExactTeam: boolean;
  isLeader: boolean;
}): { allowed: boolean; reason: TeamPanelAccessReason } {
  if (params.isAdminOverride) {
    return { allowed: true, reason: "admin_override" };
  }

  if (!params.hasTeamLeaderRole) {
    return { allowed: false, reason: "missing_team_leader_role" };
  }

  if (!params.isMemberOfExactTeam) {
    return { allowed: false, reason: "not_member_of_team" };
  }

  if (!params.isLeader) {
    return { allowed: false, reason: "not_team_leader" };
  }

  return { allowed: true, reason: "allowed" };
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
    allowedRoles: ["player", "teamLeader", "admin"],
    requireLinkedTeam: true,
    bypassTeamLinkForRoles: ["admin"],
  },
  scrim: {
    requiresGuild: true,
    allowedRoles: ["player", "teamLeader", "admin"],
    requireLinkedTeam: true,
    bypassTeamLinkForRoles: ["admin"],
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
  names: readonly string[]
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
    findRoleIdByName(roles, ADMIN_ROLE_NAME_ALIASES);

  const founderRoleId =
    existingConfig?.founderRoleId ??
    getEnvRoleId("FOUNDER_ROLE_ID") ??
    findRoleIdByName(roles, FOUNDER_ROLE_NAME_ALIASES);

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

  return {
    adminRoleId: config?.adminRoleId ?? null,
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
  const hasNamedAdminRole = Boolean(findRoleIdByName(roles, ADMIN_ROLE_NAME_ALIASES));
  const hasNamedFounderRole = Boolean(
    findRoleIdByName(roles, FOUNDER_ROLE_NAME_ALIASES)
  );
  const hasNamedTeamLeaderRole = Boolean(
    findRoleIdByName(roles, ["Team Leader", "TeamLeader"])
  );
  const hasNamedPlayerRole = Boolean(findRoleIdByName(roles, ["Player", "Players"]));

  return {
    isFounder: configuredRoles.founderRoleId
      ? roles.cache.has(configuredRoles.founderRoleId)
      : hasNamedFounderRole,
    isAdmin:
      hasDiscordAdmin ||
      (configuredRoles.adminRoleId
        ? roles.cache.has(configuredRoles.adminRoleId)
        : hasNamedAdminRole),
    isTeamLeader: configuredRoles.teamLeaderRoleId
      ? roles.cache.has(configuredRoles.teamLeaderRoleId)
      : hasNamedTeamLeaderRole,
    isPlayer: configuredRoles.playerRoleId
      ? roles.cache.has(configuredRoles.playerRoleId)
      : hasNamedPlayerRole,
    roleIds: new Set(roles.cache.keys()),
  };
}

function hasAnyAllowedRole(
  memberAccess: MemberAccessFlags,
  allowedRoles: ConfiguredRole[]
): boolean {
  return allowedRoles.some((role) => {
    if (role === "admin") {
      // Founder-only controls stay explicit, but any admin-gated flow also
      // admits Founder so tournament operations do not diverge by entry point.
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
  return memberAccess.isAdmin || memberAccess.isFounder;
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

export async function canManageTournamentPanel(
  interaction:
    | ButtonInteraction
    | ModalSubmitInteraction
    | StringSelectMenuInteraction
): Promise<boolean> {
  const guildId = interaction.guildId ?? null;
  const userId = interaction.user.id;
  const customId = interaction.customId;

  if (!interaction.inCachedGuild()) {
    console.warn("[tournament-panel-access-denied]", {
      guildId,
      userId,
      customId,
      reason: "not_in_guild",
    });
    return false;
  }

  const configuredRoles = await resolveConfiguredRoleIds(
    interaction.guildId,
    interaction.member.roles
  );
  const hasAdminRoleNameFallback =
    !configuredRoles.adminRoleId &&
    Boolean(findRoleIdByName(interaction.member.roles, ADMIN_ROLE_NAME_ALIASES));
  const decision = evaluateTournamentPanelAccessDecision({
    inGuild: true,
    isFounder: await hasFounderInteractionAccess(interaction),
    isGuildOwner: interaction.guild.ownerId === interaction.user.id,
    hasDiscordAdministratorPermission:
      interaction.member.permissions.has(PermissionFlagsBits.Administrator),
    hasConfiguredAdminRole: configuredRoles.adminRoleId
      ? interaction.member.roles.cache.has(configuredRoles.adminRoleId)
      : false,
    hasAdminRoleNameFallback,
  });

  if (!decision.allowed) {
    console.warn("[tournament-panel-access-denied]", {
      guildId: interaction.guildId,
      userId,
      customId,
      reason: decision.reason,
    });
  }

  return decision.allowed;
}

function evaluateExactTeamMembership(
  userId: string,
  team: StoredTeam,
  roleIds: Set<string>
) {
  const matchesStoredLeaderId =
    Boolean(team.leaderDiscordUserId) && team.leaderDiscordUserId === userId;
  const matchesRosterMemberId = team.members.some(
    (member) => member.discordUserId === userId
  );
  const hasTeamRole = team.discordRoleId ? roleIds.has(team.discordRoleId) : false;

  return matchesStoredLeaderId || matchesRosterMemberId || hasTeamRole;
}

export async function canManageTeamPanel(
  interaction: SupportedInteraction,
  team: StoredTeam
): Promise<TeamPanelAccessResult> {
  const leaderAccess = interaction.inCachedGuild()
    ? await getTeamLeaderAccessDebug(
        interaction.guildId,
        interaction.member.roles,
        team,
        interaction.user.id
      )
    : {
        hasTeamRole: false,
        hasBaseTeamLeaderRole: false,
        matchesStoredLeaderId: false,
        matchesLeaderMemberId: false,
        isRoleBasedLeader: false,
        isLeader: false,
        note: "This action can only be used in a server.",
      };

  if (!interaction.inCachedGuild()) {
    return {
      allowed: false,
      reason: "not_member_of_team",
      leaderAccess,
    };
  }

  const roleIds = new Set(interaction.member.roles.cache.keys());
  const isMemberOfExactTeam = evaluateExactTeamMembership(
    interaction.user.id,
    team,
    roleIds
  );
  const decision = evaluateTeamPanelAccessDecision({
    isAdminOverride: await hasAdminInteractionAccess(interaction),
    hasTeamLeaderRole: leaderAccess.hasBaseTeamLeaderRole,
    isMemberOfExactTeam,
    isLeader: leaderAccess.isLeader,
  });

  return {
    allowed: decision.allowed,
    reason: decision.reason,
    leaderAccess,
  };
}

export async function canSubmitTeamCashoutPlacement(
  interaction: SupportedInteraction,
  team: StoredTeam
): Promise<TeamPanelAccessResult> {
  return canManageTeamPanel(interaction, team);
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
  const hasBaseTeamParticipationRole = memberAccess.isPlayer || hasTeamRole;
  const isRoleBasedLeader =
    memberAccess.isTeamLeader && hasBaseTeamParticipationRole;
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
      "Leader access requires a stored leader match, a roster leader match, or Team Leader plus Player/team role access.";
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

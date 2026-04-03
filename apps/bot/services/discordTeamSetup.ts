import {
  CategoryChannel,
  ChannelType,
  Guild,
  OverwriteType,
  PermissionsBitField,
  Role,
  VoiceChannel,
} from "discord.js";
import { getRegistrationById } from "../storage/registrations";
import { StoredTeam, updateTeamDiscordAssets } from "../storage/teams";
import { getGuildConfig, upsertGuildConfig } from "../storage/guildConfig";
import { createAuditLog } from "../storage/auditLog";

interface ResolvedGuildSetupConfig {
  teamLeaderRole: Role;
  playerRole: Role;
  adminRole: Role | null;
  founderRole: Role | null;
  fallbackVoiceCategoryId: string | null;
}

export interface TeamSetupResult {
  teamRole: Role;
  voiceChannel: VoiceChannel;
  roleAction: "created" | "reused" | "renamed";
  voiceAction: "created" | "reused" | "renamed";
  players: string[];
}

function getEnvRoleId(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function getDivisionCategoryName(discordCommunity: string | null): string | null {
  if (discordCommunity === "Murph Tournament Community") {
    return process.env.MY_DIVISION_VOICE_CATEGORY_NAME?.trim() || "Murphs Division";
  }

  if (discordCommunity === "7th Circle") {
    return (
      process.env.SEVENTH_CIRCLE_DIVISION_VOICE_CATEGORY_NAME?.trim() ||
      "7th Circle Division"
    );
  }

  return null;
}

async function resolveSetupConfig(guild: Guild): Promise<ResolvedGuildSetupConfig> {
  const storedConfig = await getGuildConfig(guild.id);
  const teamLeaderRoleId =
    storedConfig?.teamLeaderRoleId ?? getEnvRoleId("TEAM_LEADER_ROLE_ID");
  const playerRoleId =
    storedConfig?.playerRoleId ?? getEnvRoleId("PLAYER_ROLE_ID");
  const adminRoleId =
    storedConfig?.adminRoleId ?? getEnvRoleId("ADMIN_ROLE_ID");
  const founderRoleId =
    storedConfig?.founderRoleId ?? getEnvRoleId("FOUNDER_ROLE_ID");
  const fallbackVoiceCategoryId =
    storedConfig?.teamVoiceCategoryId ??
    getEnvRoleId("TEAM_VOICE_CATEGORY_ID") ??
    null;

  const teamLeaderRole =
    (teamLeaderRoleId ? guild.roles.cache.get(teamLeaderRoleId) : null) ??
    guild.roles.cache.find((role) => role.name === "Team Leader");
  const playerRole =
    (playerRoleId ? guild.roles.cache.get(playerRoleId) : null) ??
    guild.roles.cache.find((role) => role.name === "Player");
  const adminRole =
    (adminRoleId ? guild.roles.cache.get(adminRoleId) : null) ??
    guild.roles.cache.find((role) => role.name === "Admin") ??
    null;
  const founderRole =
    (founderRoleId ? guild.roles.cache.get(founderRoleId) : null) ??
    guild.roles.cache.find((role) => role.name === "Founder") ??
    null;

  if (!teamLeaderRole || !playerRole) {
    throw new Error("Missing required base roles Team Leader and/or Player.");
  }

  await upsertGuildConfig({
    guildId: guild.id,
    teamVoiceCategoryId: fallbackVoiceCategoryId,
    teamLeaderRoleId: teamLeaderRole.id,
    playerRoleId: playerRole.id,
    adminRoleId: adminRole?.id ?? null,
    founderRoleId: founderRole?.id ?? null,
  });

  return {
    teamLeaderRole,
    playerRole,
    adminRole,
    founderRole,
    fallbackVoiceCategoryId,
  };
}

async function resolveVoiceCategory(
  guild: Guild,
  team: StoredTeam,
  fallbackVoiceCategoryId: string | null
): Promise<CategoryChannel | null> {
  const submission = team.importedFromSubmissionId
    ? await getRegistrationById(team.importedFromSubmissionId)
    : null;
  const divisionCategoryName = getDivisionCategoryName(
    submission?.discordCommunity ?? submission?.sourceLabel ?? null
  );

  if (divisionCategoryName) {
    const matchedCategory = guild.channels.cache.find(
      (channel): channel is CategoryChannel =>
        channel.type === ChannelType.GuildCategory &&
        channel.name === divisionCategoryName
    );

    if (!matchedCategory) {
      throw new Error(
        `Voice category "${divisionCategoryName}" was not found for ${submission?.discordCommunity ?? submission?.sourceLabel ?? "the submission source"}.`
      );
    }

    return matchedCategory;
  }

  if (!fallbackVoiceCategoryId) {
    return null;
  }

  const fallbackCategory = guild.channels.cache.get(fallbackVoiceCategoryId);

  if (!fallbackCategory || fallbackCategory.type !== ChannelType.GuildCategory) {
    throw new Error("Configured fallback team voice category was not found.");
  }

  return fallbackCategory;
}

export async function ensureDiscordTeamSetup(
  guild: Guild,
  team: StoredTeam,
  actorDiscordUserId: string,
  previousTeamName?: string | null
): Promise<TeamSetupResult> {
  if (team.importedFromSubmissionId) {
    const submission = await getRegistrationById(team.importedFromSubmissionId);

    if (!submission) {
      throw new Error(
        "The linked registration submission could not be found for Discord setup."
      );
    }

    if (submission.reviewStatus !== "approved") {
      throw new Error(
        "Discord team setup is blocked until the submission is approved in /review."
      );
    }
  }

  const config = await resolveSetupConfig(guild);
  const voiceCategory = await resolveVoiceCategory(
    guild,
    team,
    config.fallbackVoiceCategoryId
  );

  const existingRole =
    (team.discordRoleId ? guild.roles.cache.get(team.discordRoleId) : null) ??
    guild.roles.cache.find((role) => role.name === team.teamName) ??
    (previousTeamName
      ? guild.roles.cache.find((role) => role.name === previousTeamName)
      : null);
  const teamRole =
    existingRole ??
    (await guild.roles.create({
      name: team.teamName,
      mentionable: true,
      reason: `Development Division setup for ${team.teamName}`,
    }));

  const roleAction = !existingRole
    ? "created"
    : teamRole.name !== team.teamName
      ? "renamed"
      : "reused";

  if (roleAction === "renamed") {
    await teamRole.edit({
      name: team.teamName,
      reason: `Sync rename for ${team.teamName}`,
    });
  }

  await updateTeamDiscordAssets(
    team.id,
    teamRole.id,
    team.voiceChannelId,
    actorDiscordUserId
  );

  const voiceById = team.voiceChannelId
    ? guild.channels.cache.get(team.voiceChannelId)
    : null;
  const existingVoice =
    (voiceById && voiceById.type === ChannelType.GuildVoice ? voiceById : null) ??
    guild.channels.cache.find(
      (channel): channel is VoiceChannel =>
        channel.type === ChannelType.GuildVoice &&
        channel.name === team.teamName
    ) ??
    (previousTeamName
      ? guild.channels.cache.find(
          (channel): channel is VoiceChannel =>
            channel.type === ChannelType.GuildVoice &&
            channel.name === previousTeamName
        )
      : null);

  const adminOverwrite = config.adminRole
    ? [
        {
          id: config.adminRole.id,
          type: OverwriteType.Role,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.ManageChannels,
          ],
        },
      ]
    : [];
  const founderOverwrite = config.founderRole
    ? [
        {
          id: config.founderRole.id,
          type: OverwriteType.Role,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.ManageChannels,
          ],
        },
      ]
    : [];

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      type: OverwriteType.Role,
      deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect],
    },
    {
      id: teamRole.id,
      type: OverwriteType.Role,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect],
    },
    ...adminOverwrite,
    ...founderOverwrite,
  ];

  const voiceChannel = existingVoice
    ? await existingVoice.edit({
        parent: voiceCategory?.id ?? null,
        userLimit: 4,
        permissionOverwrites,
        reason: `Development Division setup for ${team.teamName}`,
      })
    : await guild.channels.create({
        name: team.teamName,
        type: ChannelType.GuildVoice,
        parent: voiceCategory?.id,
        userLimit: 4,
        permissionOverwrites,
        reason: `Development Division setup for ${team.teamName}`,
      });

  const voiceAction = !existingVoice
    ? "created"
    : existingVoice.name !== team.teamName
      ? "renamed"
      : "reused";

  await updateTeamDiscordAssets(team.id, teamRole.id, voiceChannel.id, actorDiscordUserId);

  await createAuditLog({
    guildId: guild.id,
    action:
      roleAction === "created"
        ? "team_role_created"
        : roleAction === "renamed"
          ? "team_role_renamed"
          : "team_role_reused",
    entityType: "team",
    entityId: `${team.id}`,
    summary: `${roleAction === "created" ? "Created" : roleAction === "renamed" ? "Renamed" : "Reused"} team role for ${team.teamName}.`,
    details: `Role id ${teamRole.id}.`,
    actorDiscordUserId,
  });

  await createAuditLog({
    guildId: guild.id,
    action:
      voiceAction === "created"
        ? "team_voice_created"
        : voiceAction === "renamed"
          ? "team_voice_renamed"
          : "team_voice_reused",
    entityType: "team",
    entityId: `${team.id}`,
    summary: `${voiceAction === "created" ? "Created" : voiceAction === "renamed" ? "Renamed" : "Reused"} voice channel for ${team.teamName}.`,
    details: `Channel id ${voiceChannel.id}${voiceCategory ? ` in ${voiceCategory.name}` : ""}.`,
    actorDiscordUserId,
  });

  await createAuditLog({
    guildId: guild.id,
    action: "team_setup_package_generated",
    entityType: "team",
    entityId: `${team.id}`,
    summary: `Generated setup package for ${team.teamName}.`,
    details: `Role ${teamRole.name}, voice ${voiceChannel.name}.`,
    actorDiscordUserId,
  });

  const orderedMembers = team.members.sort(
    (left, right) => left.sortOrder - right.sortOrder
  );
  const nonLeaderPlayers = orderedMembers.filter((member) => !member.isLeader);
  const players = (nonLeaderPlayers.length > 0 ? nonLeaderPlayers : orderedMembers).map(
    (member) => member.displayName
  );

  return {
    teamRole,
    voiceChannel,
    roleAction,
    voiceAction,
    players,
  };
}

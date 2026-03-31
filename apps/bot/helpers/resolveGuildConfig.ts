import type { Guild } from "discord.js";
import { getGuildConfig, upsertGuildConfig } from "../storage/guildConfig";

function findRole(guild: Guild, name: string) {
  return guild.roles.cache.find(
    (role) => role.name.toLowerCase() === name.toLowerCase()
  );
}

export async function resolveGuildConfig(guild: Guild) {
  let config = await getGuildConfig(guild.id);

  const adminRole = findRole(guild, "Admin");
  const founderRole = findRole(guild, "Founder");

  // If config is missing OR roles not set → auto-fill
  if (!config || !config.adminRoleId || !config.founderRoleId) {
    config = await upsertGuildConfig({
      guildId: guild.id,
      adminRoleId: adminRole?.id ?? null,
      founderRoleId: founderRole?.id ?? null,
      teamLeaderRoleId: config?.teamLeaderRoleId ?? null,
      playerRoleId: config?.playerRoleId ?? null,
      teamVoiceCategoryId: config?.teamVoiceCategoryId ?? null,
    });
  }

  return config;
}

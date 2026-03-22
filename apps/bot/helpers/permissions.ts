import { ChatInputCommandInteraction } from "discord.js";

const allowedAdminRoleNames = ["Admin", "Founder"];

export function hasAdminCommandAccess(
  interaction: ChatInputCommandInteraction
): boolean {
  if (!interaction.inCachedGuild()) return false;

  return interaction.member.roles.cache.some((role) =>
    allowedAdminRoleNames.includes(role.name)
  );
}

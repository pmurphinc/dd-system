import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { BotCommand } from "./types";
import { buildTeamPanel } from "../helpers/teamPanel";

export const checkinCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("checkin")
    .setDescription("Open your team panel and use the instance-scoped check-in flow"),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "This command must be used inside the guild.",
        ephemeral: true,
      });
      return;
    }

    const teamPanel = await buildTeamPanel(
      interaction.user.id,
      interaction.guildId,
      interaction.member.roles
    );

    await interaction.reply({
      content: "Check-in now runs through `/team`. Use the panel below.",
      ...teamPanel,
      ephemeral: true,
    });
  },
};

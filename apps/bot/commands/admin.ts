import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { BotCommand } from "./types";
import { buildAdminInstancePicker, buildAdminPanel } from "../helpers/adminPanel";

export const adminCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Founder-only panel for tournament instance management")
    .addIntegerOption((option) =>
      option
        .setName("instance")
        .setDescription("Optional tournament instance ID")
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "This command must be used inside the guild.",
        ephemeral: true,
      });
      return;
    }

    const instanceId = interaction.options.getInteger("instance");

    if (instanceId === null) {
      const picker = await buildAdminInstancePicker(interaction.guildId);
      await interaction.reply({
        ...picker,
        ephemeral: true,
      });
      return;
    }

    const panel = await buildAdminPanel(interaction.guildId, instanceId);
    await interaction.reply({
      ...panel,
      ephemeral: true,
    });
  },
};

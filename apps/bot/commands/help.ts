import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { BotCommand } from "./types";

export const helpCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Shows available bot commands"),

  async execute(interaction: ChatInputCommandInteraction) {
    const embed = new EmbedBuilder()
      .setTitle("Available Commands")
      .setDescription("/ping\n/register\n/team");

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};

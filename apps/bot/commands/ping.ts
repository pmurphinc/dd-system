import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { BotCommand } from "./types";

export const pingCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Test command"),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply("Pong!");
  },
};

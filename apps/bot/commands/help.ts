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
      .setDescription(
        [
          "Public: /register /standings /help /ping",
          "Participant: /team /match /checkin (opens /team) /report",
          "Admin: /review /reports /tournament /status /cycleresults /syncstatus",
          "Founder: /admin",
        ].join("\n")
      );

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};

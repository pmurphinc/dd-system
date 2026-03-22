import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { BotCommand } from "./types";
import { getStandings } from "../storage/standings";

export const standingsCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("standings")
    .setDescription("Shows current FRP standings"),

  async execute(interaction: ChatInputCommandInteraction) {
    const standings = await getStandings();

    const embed = new EmbedBuilder()
      .setTitle("Development Division Standings")
      .setDescription(
        standings.length > 0
          ? standings
              .map(
                (standing, index) =>
                  `${index + 1}. ${standing.teamName} - ${standing.frp} FRP`
              )
              .join("\n")
          : "No standings available."
      );

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};

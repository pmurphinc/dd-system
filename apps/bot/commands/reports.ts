import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { BotCommand } from "./types";
import { buildReportsPanel } from "../helpers/reportsPanel";

export const reportsCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("reports")
    .setDescription("Shows recent submitted match reports"),

  async execute(interaction: ChatInputCommandInteraction) {
    const reportsPanel = await buildReportsPanel();

    await interaction.reply({
      ...reportsPanel,
      ephemeral: true,
    });
  },
};

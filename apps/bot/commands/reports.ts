import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { BotCommand } from "./types";
import { hasAdminCommandAccess } from "../helpers/permissions";
import { buildReportsPanel } from "../helpers/reportsPanel";

export const reportsCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("reports")
    .setDescription("Shows recent submitted match reports"),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!hasAdminCommandAccess(interaction)) {
      await interaction.reply({
        content: "You do not have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    const reportsPanel = await buildReportsPanel();

    await interaction.reply({
      ...reportsPanel,
      ephemeral: true,
    });
  },
};

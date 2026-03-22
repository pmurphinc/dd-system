import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { BotCommand } from "./types";
import { hasAdminCommandAccess } from "../helpers/permissions";
import { buildReviewPanel } from "../helpers/reviewPanel";

export const reviewCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("review")
    .setDescription("Review registered teams (admin)"),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!hasAdminCommandAccess(interaction)) {
      await interaction.reply({
        content: "You do not have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    const reviewPanel = await buildReviewPanel();

    await interaction.reply({
      ...reviewPanel,
      ephemeral: true,
    });
  },
};

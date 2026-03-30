import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { BotCommand } from "./types";
import { buildReviewQueue } from "../helpers/reviewPanel";

export const reviewCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("review")
    .setDescription("Review registered teams (admin)")
    .addStringOption((option) =>
      option
        .setName("status")
        .setDescription("Choose which review queue to open")
        .addChoices(
          { name: "Pending", value: "pending" },
          { name: "Approved", value: "approved" },
          { name: "Rejected", value: "rejected" }
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const statusFilter =
      (interaction.options.getString("status") as
        | "pending"
        | "approved"
        | "rejected"
        | null) ?? "pending";
    const reviewPanel = await buildReviewQueue(statusFilter);

    await interaction.reply({
      ...reviewPanel,
      ephemeral: true,
    });
  },
};

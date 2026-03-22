import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { BotCommand } from "./types";
import { buildTeamPanel } from "../helpers/teamPanel";

export const teamCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("team")
    .setDescription("Shows the team panel"),

  async execute(interaction: ChatInputCommandInteraction) {
    const teamPanel = await buildTeamPanel(interaction.user.id);

    await interaction.reply({
      ...teamPanel,
      ephemeral: true,
    });
  },
};

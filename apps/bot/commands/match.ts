import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { BotCommand } from "./types";
import { buildMatchPanel } from "../helpers/matchPanel";

export const matchCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("match")
    .setDescription("Shows the current match panel"),

  async execute(interaction: ChatInputCommandInteraction) {
    const matchPanel = await buildMatchPanel(
      interaction.user.id,
      interaction.inCachedGuild() ? interaction.member.roles : undefined
    );

    await interaction.reply({
      ...matchPanel,
      ephemeral: true,
    });
  },
};

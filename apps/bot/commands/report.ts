import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { BotCommand } from "./types";
import { buildReportPanel } from "../helpers/reportPanel";

export const reportCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("report")
    .setDescription("Submit an informational Final Round result as team leader"),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "This command must be used inside the guild.",
        ephemeral: true,
      });
      return;
    }

    const reportPanel = await buildReportPanel(
      interaction.user.id,
      interaction.guildId,
      interaction.inCachedGuild() ? interaction.member.roles : undefined
    );

    await interaction.reply({
      ...reportPanel,
      ephemeral: true,
    });
  },
};

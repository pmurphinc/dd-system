import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { BotCommand } from "./types";
import { buildAdminPanel } from "../helpers/adminPanel";
import { registerPanelMessage } from "../services/panelAutoUpdateService";

export const adminCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Founder-only panel for tournament instance management")
    .addIntegerOption((option) =>
      option
        .setName("instance")
        .setDescription("Optional tournament instance ID")
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "This command must be used inside the guild.",
        ephemeral: true,
      });
      return;
    }

    const instanceId = interaction.options.getInteger("instance") ?? undefined;
    const panel = await buildAdminPanel(interaction.guildId, instanceId);
    await interaction.reply(panel);
    const message = await interaction.fetchReply();
    registerPanelMessage(message, {
      panelType: "admin",
      guildId: interaction.guildId,
      tournamentInstanceId: instanceId,
      userId: interaction.user.id,
    });
  },
};

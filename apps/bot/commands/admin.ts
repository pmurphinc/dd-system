import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { SavedPanelType } from "@prisma/client";
import { BotCommand } from "./types";
import { buildAdminInstancePicker, buildAdminPanel } from "../helpers/adminPanel";
import {
  buildPanelScopeKey,
  rememberPanelInstance,
  replaceOrEditPanelFromCommand,
  resolvePanelInstanceOrPrompt,
} from "../services/panelLifecycle";

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

    const scopeKey = buildPanelScopeKey("admin", interaction.guildId, interaction.user.id);
    const selectedInstanceId = interaction.options.getInteger("instance");
    const instanceId =
      selectedInstanceId ??
      (await resolvePanelInstanceOrPrompt({
        guildId: interaction.guildId,
        discordUserId: interaction.user.id,
        panelType: SavedPanelType.admin,
        canAccessInstance: async () => true,
      }));

    if (!instanceId) {
      const picker = await buildAdminInstancePicker(interaction.guildId, "admin:select_instance");
      await interaction.reply({
        ...picker,
        ephemeral: true,
      });
      return;
    }

    await rememberPanelInstance({
      guildId: interaction.guildId,
      discordUserId: interaction.user.id,
      panelType: SavedPanelType.admin,
      tournamentInstanceId: instanceId,
    });

    const panel = await buildAdminPanel(interaction.guildId, instanceId);
    await replaceOrEditPanelFromCommand({
      interaction,
      scopeKey,
      panelType: "admin",
      panel,
      metadata: {
        ownerDiscordUserId: interaction.user.id,
        actorDiscordUserId: interaction.user.id,
        tournamentInstanceId: instanceId,
      },
    });
  },
};

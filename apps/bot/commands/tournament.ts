import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { SavedPanelType } from "@prisma/client";
import { BotCommand } from "./types";
import { buildTournamentInstancePicker, buildTournamentPanel } from "../helpers/tournamentPanel";
import {
  buildPanelScopeKey,
  rememberPanelInstance,
  replaceOrEditPanelFromCommand,
  resolvePanelInstanceOrPrompt,
} from "../services/panelLifecycle";

export const tournamentCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("tournament")
    .setDescription("Shows an instance-scoped tournament control panel")
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

    const scopeKey = buildPanelScopeKey(
      "tournament",
      interaction.guildId,
      interaction.user.id
    );
    const selectedInstanceId = interaction.options.getInteger("instance");
    const instanceId =
      selectedInstanceId ??
      (await resolvePanelInstanceOrPrompt({
        guildId: interaction.guildId,
        discordUserId: interaction.user.id,
        panelType: SavedPanelType.tournament,
        canAccessInstance: async () => true,
      }));

    if (!instanceId) {
      const picker = await buildTournamentInstancePicker(
        interaction.guildId,
        "tournament:select_instance"
      );

      await interaction.reply({
        ...picker,
        ephemeral: true,
      });
      return;
    }

    await rememberPanelInstance({
      guildId: interaction.guildId,
      discordUserId: interaction.user.id,
      panelType: SavedPanelType.tournament,
      tournamentInstanceId: instanceId,
    });

    const tournamentPanel = await buildTournamentPanel(
      instanceId,
      interaction.guildId
    );
    await replaceOrEditPanelFromCommand({
      interaction,
      scopeKey,
      panelType: "tournament",
      panel: tournamentPanel,
      metadata: {
        ownerDiscordUserId: interaction.user.id,
        actorDiscordUserId: interaction.user.id,
        tournamentInstanceId: instanceId,
      },
    });
  },
};

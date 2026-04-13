import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { BotCommand } from "./types";
import { buildTeamPanel } from "../helpers/teamPanel";
import { getTeamForUser } from "../storage/teams";
import {
  buildPanelScopeKey,
  replaceOrEditPanelFromCommand,
} from "../services/panelLifecycle";

export const teamCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("team")
    .setDescription("Shows the team panel"),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: "This command must be used inside the guild.",
        ephemeral: true,
      });
      return;
    }

    const teamPanel = await buildTeamPanel(
      interaction.user.id,
      interaction.guildId,
      interaction.inCachedGuild() ? interaction.member.roles : undefined
    );

    const scopeKey = buildPanelScopeKey("team", interaction.guildId, interaction.user.id);
    const team = await getTeamForUser(
      interaction.user.id,
      interaction.inCachedGuild() ? interaction.member.roles : undefined
    );
    await replaceOrEditPanelFromCommand({
      interaction,
      scopeKey,
      panelType: "team",
      panel: teamPanel,
      metadata: {
        ownerDiscordUserId: interaction.user.id,
        actorDiscordUserId: interaction.user.id,
        teamId: team?.id,
        tournamentInstanceId: team?.tournamentInstanceId ?? undefined,
      },
    });
  },
};

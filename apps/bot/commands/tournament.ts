import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { BotCommand } from "./types";
import { hasAdminCommandAccess } from "../helpers/permissions";
import { buildTournamentPanel } from "../helpers/tournamentPanel";

export const tournamentCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("tournament")
    .setDescription("Shows the tournament control panel"),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!hasAdminCommandAccess(interaction)) {
      await interaction.reply({
        content: "You do not have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    const tournamentPanel = await buildTournamentPanel();

    await interaction.reply({
      ...tournamentPanel,
      ephemeral: true,
    });
  },
};

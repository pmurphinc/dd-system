import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { BotCommand } from "./types";
import { buildCheckinPanel } from "../helpers/checkinPanel";
import { isCheckInOpen } from "../helpers/tournamentAccess";
import { getMockTournamentState } from "../mocks/tournamentState";

export const checkinCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("checkin")
    .setDescription("Check in your team for the event"),

  async execute(interaction: ChatInputCommandInteraction) {
    const tournamentState = await getMockTournamentState();

    if (!isCheckInOpen(tournamentState)) {
      await interaction.reply({
        content: "Check-in is not open right now.",
        ephemeral: true,
      });
      return;
    }

    const checkinPanel = await buildCheckinPanel();

    await interaction.reply({
      ...checkinPanel,
      ephemeral: true,
    });
  },
};

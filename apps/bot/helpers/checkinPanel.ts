import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { getMockTournamentState } from "../mocks/tournamentState";

export async function buildCheckinPanel() {
  const tournamentState = await getMockTournamentState();

  const embed = new EmbedBuilder()
    .setTitle("Development Division Check-In")
    .setDescription("Use the button below to update the mock team check-in state.")
    .addFields(
      {
        name: "Check-In Status",
        value: tournamentState.tournamentStatus,
        inline: true,
      },
      {
        name: "Checked In Teams",
        value: `${tournamentState.checkedInTeams}`,
        inline: true,
      },
      {
        name: "Total Teams",
        value: `${tournamentState.totalTeams}`,
        inline: true,
      }
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("checkin_team")
      .setLabel("Check In Team")
      .setStyle(ButtonStyle.Success)
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

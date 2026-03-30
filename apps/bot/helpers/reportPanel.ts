import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMemberRoleManager,
} from "discord.js";
import { getCurrentFinalRoundAssignmentForTeam } from "../storage/matchAssignments";
import { getTeamForUser } from "../storage/teams";
import { getTournamentInstanceById, syncTournamentInstancesForGuild } from "../storage/tournamentInstances";

export async function buildReportPanel(
  userId: string,
  guildId: string,
  memberRoles?: GuildMemberRoleManager
) {
  await syncTournamentInstancesForGuild(guildId);
  const team = await getTeamForUser(userId, memberRoles);
  const instance =
    team?.tournamentInstanceId !== null && team
      ? await getTournamentInstanceById(team.tournamentInstanceId)
      : null;
  const assignment =
    team && instance
      ? await getCurrentFinalRoundAssignmentForTeam(
          instance.id,
          team.id,
          instance.currentCycle
        )
      : null;

  const embed = new EmbedBuilder()
    .setTitle("Development Division Result Report")
    .setDescription(
      assignment
        ? "Team leader informational Final Round report."
        : "No Final Round assignment is available for your team."
    )
    .addFields(
      { name: "Tournament Instance", value: instance?.name ?? "Not assigned", inline: true },
      { name: "Assigned Team", value: team?.teamName ?? "No team linked", inline: true },
      { name: "Opponent", value: assignment?.opponentTeamName ?? "Not assigned", inline: true },
      { name: "Cycle", value: `${instance?.currentCycle ?? "-"}`, inline: true },
      { name: "Stage", value: instance?.currentStage ?? "REGISTRATION", inline: true },
      { name: "Submission Type", value: "Informational only", inline: true }
    );

  const components =
    team && instance
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`team:report:${instance.id}:${team.id}`)
              .setLabel("Submit Final Report")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(!assignment)
          ),
        ]
      : [];

  return {
    embeds: [embed],
    components,
  };
}

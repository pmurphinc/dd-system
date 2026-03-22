import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { getMockReviewData } from "../mocks/reviewData";

export async function buildReviewPanel() {
  const reviewData = await getMockReviewData();
  const currentPendingTeam = reviewData.currentPendingTeam;

  const embed = new EmbedBuilder()
    .setTitle("Development Division Review Panel")
    .setDescription(
      "This panel will be used by admins to review and approve teams."
    )
    .addFields(
      {
        name: "Pending Teams",
        value: `${reviewData.pendingTeamsCount}`,
        inline: true,
      },
      {
        name: "Approved Teams",
        value: `${reviewData.approvedTeamsCount}`,
        inline: true,
      },
      {
        name: "Denied Teams",
        value: `${reviewData.deniedTeamsCount}`,
        inline: true,
      },
      {
        name: "Current Team",
        value: currentPendingTeam?.teamName ?? "None",
        inline: true,
      },
      {
        name: "Captain",
        value: currentPendingTeam?.captainName ?? "-",
        inline: true,
      },
      {
        name: "Players",
        value: currentPendingTeam?.playerNames.join("\n") ?? "-",
        inline: false,
      },
      {
        name: "Substitute",
        value: currentPendingTeam?.substituteName ?? "-",
        inline: true,
      },
      {
        name: "Proof Status or Notes",
        value: currentPendingTeam?.proofStatus ?? "No pending team",
        inline: false,
      }
    )
    .setFooter({ text: "Admin review tools coming soon" });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("review_approve")
      .setLabel("Approve Team")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("review_deny")
      .setLabel("Deny Team")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("review_refresh")
      .setLabel("Refresh Review")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

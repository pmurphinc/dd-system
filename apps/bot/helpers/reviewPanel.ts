import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import {
  getRegistrationById,
  listRegistrationsByStatus,
  RegistrationStatus,
  StoredRegistrationSubmission,
} from "../storage/registrations";

function truncateValue(value: string, fallback = "-"): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return fallback;
  }

  return trimmed.length > 1024 ? `${trimmed.slice(0, 1021)}...` : trimmed;
}

function getRosterIdentity(value?: string | null): string {
  return value?.trim() || "";
}

function getPlayerRosterValue(player?: StoredRegistrationSubmission["players"][number]): string {
  if (!player) {
    return "";
  }

  return getRosterIdentity(player.embarkId) || getRosterIdentity(player.displayName);
}

function getOrderedRoster(submission: StoredRegistrationSubmission | null) {
  if (!submission) {
    return [];
  }

  return [...submission.players].sort((left, right) => left.sortOrder - right.sortOrder);
}

function getLeaderDetails(submission: StoredRegistrationSubmission | null): string {
  if (!submission) {
    return "-";
  }

  const orderedRoster = getOrderedRoster(submission);
  const leaderPlayer =
    orderedRoster.find((player) => player.isLeader) ?? orderedRoster[0];
  const leaderValue =
    getPlayerRosterValue(leaderPlayer) ||
    getRosterIdentity(submission.leaderDisplayName) ||
    "Leader";

  return truncateValue(leaderValue);
}

function formatPlayers(submission: StoredRegistrationSubmission | null): string {
  if (!submission) {
    return "-";
  }

  const orderedRoster = getOrderedRoster(submission);
  const starters = orderedRoster.slice(0, 3);
  const substitute = orderedRoster[3];
  const starterLines = starters
    .map((player, index) => {
      const rosterValue = getPlayerRosterValue(player);
      return rosterValue ? `${index + 1}. ${rosterValue}` : "";
    })
    .filter(Boolean);
  const lines = [...starterLines];

  if (substitute) {
    const substituteValue = getPlayerRosterValue(substitute);

    if (substituteValue) {
      lines.push("", `Sub = ${substituteValue}`);
    }
  }

  return lines.length > 0 ? truncateValue(lines.join("\n")) : "-";
}

function formatScreenshots(submission: StoredRegistrationSubmission | null): string {
  if (!submission) {
    return "-";
  }

  const orderedRoster = getOrderedRoster(submission);
  const screenshotLines = orderedRoster.map((player, index) => {
    const roleLabel =
      player.isLeader
        ? "Leader"
        : player.sortOrder >= 4
          ? "Substitute"
          : `Player ${index + 1}`;
    const rawValue = player.screenshotLink.trim();
    const status = rawValue ? "Screenshot provided" : "Screenshot missing";

    return rawValue
      ? `${roleLabel} (${player.displayName}): ${status}\n${rawValue}`
      : `${roleLabel} (${player.displayName}): ${status}`;
  });

  return screenshotLines.length > 0
    ? truncateValue(screenshotLines.join("\n"))
    : "-";
}

function getMapBanValue(submission: StoredRegistrationSubmission | null): string {
  if (!submission) {
    return "-";
  }

  if (submission.mapBan?.trim()) {
    return truncateValue(submission.mapBan.trim());
  }

  const match = submission.submittedNotes.match(/Map Ban:\s*([^\n\r]+)/i);
  return truncateValue(match?.[1] ?? "");
}

function getSourceLabel(submission: StoredRegistrationSubmission | null): string {
  if (!submission) {
    return "-";
  }

  return submission.sourceLabel
    ? `${submission.sourceLabel} row ${submission.sourceRowNumber ?? "?"}`
    : "Manual";
}

function getDiscordCommunityLabel(
  submission: StoredRegistrationSubmission | null
): string {
  if (!submission?.discordCommunity?.trim()) {
    return "-";
  }

  return truncateValue(submission.discordCommunity.trim());
}

export async function buildReviewQueue(
  statusFilter: RegistrationStatus = "pending"
) {
  const submissions = await listRegistrationsByStatus(statusFilter, 25);
  const embed = new EmbedBuilder()
    .setTitle("Development Division Review Queue")
    .setDescription(
      submissions.length > 0
        ? `Select a ${statusFilter} team to review.`
        : `No ${statusFilter} submissions are waiting.`
    )
    .addFields(
      submissions.length > 0
        ? submissions.slice(0, 10).map((submission) => ({
            name: submission.teamName,
            value: [
              submission.reviewStatus,
              getDiscordCommunityLabel(submission),
              getSourceLabel(submission),
            ].join(" | "),
            inline: false,
          }))
        : [
            {
              name: "Queue",
              value: `No ${statusFilter} submissions found.`,
              inline: false,
            },
          ]
    )
    .setFooter({
      text: `${submissions.length} ${statusFilter} submission${submissions.length === 1 ? "" : "s"}`,
    });

  const components = [];

  if (submissions.length > 0) {
    const picker = new StringSelectMenuBuilder()
      .setCustomId(`review_select_${statusFilter}`)
      .setPlaceholder(`Open a ${statusFilter} submission`)
      .addOptions(
        submissions.map((submission) => ({
          label: submission.teamName.slice(0, 100),
          description: `${submission.reviewStatus} | ${getDiscordCommunityLabel(
            submission
          )} | ${getSourceLabel(submission)}`.slice(0, 100),
          value: `${submission.id}`,
        }))
      );

    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(picker)
    );
  }

  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("review_queue_pending")
        .setLabel("Pending")
        .setStyle(
          statusFilter === "pending" ? ButtonStyle.Primary : ButtonStyle.Secondary
        ),
      new ButtonBuilder()
        .setCustomId("review_queue_approved")
        .setLabel("Approved")
        .setStyle(
          statusFilter === "approved" ? ButtonStyle.Primary : ButtonStyle.Secondary
        ),
      new ButtonBuilder()
        .setCustomId("review_queue_rejected")
        .setLabel("Rejected")
        .setStyle(
          statusFilter === "rejected" ? ButtonStyle.Primary : ButtonStyle.Secondary
        )
    )
  );

  return {
    embeds: [embed],
    components,
  };
}

export async function buildReviewPanel(
  selectedSubmissionId?: number,
  statusFilter: RegistrationStatus = "pending"
) {
  const filteredSubmissions = await listRegistrationsByStatus(statusFilter, 100);
  if (filteredSubmissions.length === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle("Development Division Review")
          .setDescription(`No ${statusFilter} submissions found.`)
          .setFooter({
            text: `No ${statusFilter} submissions`,
          }),
      ],
      components: [],
    };
  }

  const selectedIndex = selectedSubmissionId
    ? filteredSubmissions.findIndex((submission) => submission.id === selectedSubmissionId)
    : 0;
  const resolvedIndex =
    selectedIndex >= 0 ? selectedIndex : 0;
  const selectedSummary =
    resolvedIndex >= 0 && filteredSubmissions[resolvedIndex]
      ? filteredSubmissions[resolvedIndex]
      : filteredSubmissions[0] ?? null;
  const selectedSubmission = selectedSummary
    ? await getRegistrationById(selectedSummary.id)
    : null;
  const selectedId = selectedSubmission?.id ?? 0;
  const actionDisabled = selectedSubmission === null;
  const showPendingActions =
    selectedSubmission?.reviewStatus === "pending" || selectedSubmission === null;
  const showApprovedActions = selectedSubmission?.reviewStatus === "approved";
  const showRejectedActions = selectedSubmission?.reviewStatus === "rejected";
  const effectiveIndex = selectedSummary
    ? filteredSubmissions.findIndex((submission) => submission.id === selectedSummary.id)
    : -1;
  const hasPrevious = effectiveIndex > 0;
  const hasNext =
    effectiveIndex >= 0 && effectiveIndex < filteredSubmissions.length - 1;

  const embed = new EmbedBuilder()
    .setTitle("Development Division Review")
    .addFields(
      {
        name: "Submission ID",
        value: selectedSubmission ? `${selectedSubmission.id}` : "-",
        inline: true,
      },
      {
        name: "Team Name",
        value: selectedSubmission?.teamName ?? `No ${statusFilter} submissions`,
        inline: true,
      },
      {
        name: "Status",
        value: selectedSubmission?.reviewStatus ?? statusFilter,
        inline: true,
      },
      {
        name: "Source",
        value: getSourceLabel(selectedSubmission),
        inline: true,
      },
      {
        name: "Discord Community",
        value: getDiscordCommunityLabel(selectedSubmission),
        inline: false,
      },
      {
        name: "LEADER",
        value: getLeaderDetails(selectedSubmission),
        inline: false,
      },
      {
        name: "PLAYERS",
        value: formatPlayers(selectedSubmission),
        inline: false,
      },
      {
        name: "SCREENSHOTS",
        value: formatScreenshots(selectedSubmission),
        inline: false,
      },
      {
        name: "MAP BAN SELECTION",
        value: getMapBanValue(selectedSubmission),
        inline: false,
      },
      {
        name: "REVIEWER NOTES",
        value: truncateValue(selectedSubmission?.reviewerNotes ?? ""),
        inline: false,
      }
    )
    .setFooter({
      text:
        effectiveIndex >= 0
          ? `${effectiveIndex + 1} of ${filteredSubmissions.length} ${statusFilter}`
          : `No ${statusFilter} submissions`,
    });

  const actionRows: ActionRowBuilder<ButtonBuilder>[] = [];

  if (showPendingActions) {
    actionRows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`review_approve_${selectedId}_${statusFilter}`)
          .setLabel("Approve")
          .setStyle(ButtonStyle.Success)
          .setDisabled(actionDisabled),
        new ButtonBuilder()
          .setCustomId(`review_reject_${selectedId}_${statusFilter}`)
          .setLabel("Reject")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(actionDisabled),
        new ButtonBuilder()
          .setCustomId(`review_notes_${selectedId}_${statusFilter}`)
          .setLabel("Edit Notes")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(actionDisabled)
      )
    );
  }

  if (showApprovedActions) {
    actionRows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`review_approve_${selectedId}_${statusFilter}`)
          .setLabel("Rerun Approval Setup")
          .setStyle(ButtonStyle.Success)
          .setDisabled(actionDisabled),
        new ButtonBuilder()
          .setCustomId(`review_setup_${selectedId}_${statusFilter}`)
          .setLabel("Setup Recovery")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(actionDisabled),
        new ButtonBuilder()
          .setCustomId(`review_notes_${selectedId}_${statusFilter}`)
          .setLabel("Edit Notes")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(actionDisabled)
      )
    );
  }

  if (showRejectedActions) {
    actionRows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`review_pending_${selectedId}_${statusFilter}`)
          .setLabel("Return Pending")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(actionDisabled),
        new ButtonBuilder()
          .setCustomId(`review_approve_${selectedId}_${statusFilter}`)
          .setLabel("Approve")
          .setStyle(ButtonStyle.Success)
          .setDisabled(actionDisabled),
        new ButtonBuilder()
          .setCustomId(`review_notes_${selectedId}_${statusFilter}`)
          .setLabel("Edit Notes")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(actionDisabled)
      )
    );
  }

  const previousSubmissionId =
    hasPrevious && filteredSubmissions[effectiveIndex - 1]
      ? filteredSubmissions[effectiveIndex - 1].id
      : selectedId;
  const nextSubmissionId =
    hasNext && filteredSubmissions[effectiveIndex + 1]
      ? filteredSubmissions[effectiveIndex + 1].id
      : selectedId;

  actionRows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`review_back_queue_${statusFilter}`)
        .setLabel("Back To Queue")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`review_prev_${previousSubmissionId}_${statusFilter}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasPrevious),
      new ButtonBuilder()
        .setCustomId(`review_next_${nextSubmissionId}_${statusFilter}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasNext),
      new ButtonBuilder()
        .setCustomId(`review_refresh_${selectedId}_${statusFilter}`)
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(actionDisabled)
    )
  );

  return {
    embeds: [embed],
    components: actionRows,
  };
}

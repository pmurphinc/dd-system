import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { BotCommand } from "./types";
import { getRegistrationSummary } from "../storage/registrations";
import {
  listRecentRegistrationSyncIssues,
  listRegistrationSyncSourceStates,
} from "../storage/registrationSync";
import {
  getRegistrationSyncConfig,
  isRegistrationSyncAuthConfigured,
} from "../services/registrationSheetSync";

export const syncstatusCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("syncstatus")
    .setDescription("Shows Google Sheets registration sync status"),

  async execute(interaction: ChatInputCommandInteraction) {
    const [summary, sourceStates, issues] = await Promise.all([
      getRegistrationSummary(),
      listRegistrationSyncSourceStates(),
      listRecentRegistrationSyncIssues(5),
    ]);
    const config = getRegistrationSyncConfig();
    const stateByKey = new Map(sourceStates.map((state) => [state.sourceKey, state]));
    const sourceSummary = config.sources
      .map((source) => {
        const state = stateByKey.get(source.sourceKey);
        let parsedSummary: Record<string, number> | null = null;
        if (state?.lastSummaryJson) {
          try {
            parsedSummary = JSON.parse(state.lastSummaryJson) as Record<string, number>;
          } catch {
            parsedSummary = null;
          }
        }
        const detailedLine = parsedSummary
          ? [
              `Teams +${parsedSummary.teamsCreated ?? 0} / updated ${parsedSummary.teamsUpdated ?? 0}`,
              `Name changes ${parsedSummary.teamNameChanges ?? 0}`,
              `Community changes ${parsedSummary.communityMetadataChanges ?? 0}`,
              `Warnings ${parsedSummary.warnings ?? 0}, blocking errors ${parsedSummary.blockingErrors ?? 0}`,
              `Roles created ${parsedSummary.discordRolesCreated ?? 0}, renamed ${parsedSummary.discordRolesRenamed ?? 0}`,
              `Channels created ${parsedSummary.discordChannelsCreated ?? 0}, renamed ${parsedSummary.discordChannelsRenamed ?? 0}`,
              "Tournament instance assignments changed: 0 (admin-controlled only)",
            ].join(" | ")
          : "Detailed summary unavailable for the last run.";

        return [
          `${source.sourceLabel}`,
          `Spreadsheet: ${source.spreadsheetId}`,
          `Configured Tab: ${source.worksheetTitle ?? "auto"}`,
          `Resolved Range: ${state?.lastResolvedRange ?? "not resolved yet"}`,
          `Last success: ${state?.lastSuccessfulSyncAt?.toISOString() ?? "never"}`,
          `Last run: +${state?.lastImportedCount ?? 0} / =${state?.lastDuplicateCount ?? 0} / errors ${state?.lastInvalidCount ?? 0} / warnings ${state?.lastWarningCount ?? 0}`,
          detailedLine,
          `Last error: ${state?.lastError ?? "none"}`,
        ].join("\n");
      })
      .join("\n\n");
    const warningSummary = issues
      .filter((issue) => issue.severity === "warning")
      .map(
        (issue) =>
          `${issue.sourceLabel} row ${issue.rowNumber}: ${issue.reason}${
            issue.rawTeamName ? ` (${issue.rawTeamName})` : ""
          }`
      )
      .join("\n");
    const errorSummary = issues
      .filter((issue) => issue.severity === "error")
      .map(
        (issue) =>
          `${issue.sourceLabel} row ${issue.rowNumber}: ${issue.reason}${
            issue.rawTeamName ? ` (${issue.rawTeamName})` : ""
          }`
      )
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("Registration Sync Status")
      .addFields(
        {
          name: "Polling",
          value: config.enabled
            ? `Enabled every ${Math.round(config.intervalMs / 1000)}s`
            : "Disabled",
          inline: true,
        },
        {
          name: "Auth Config",
          value: isRegistrationSyncAuthConfigured(config) ? "Initialized" : "Missing service account env",
          inline: true,
        },
        {
          name: "Sources Configured",
          value: `${config.sources.filter((source) => source.enabled).length}/${config.sources.length}`,
          inline: true,
        },
        {
          name: "Pending Review",
          value: `${summary.pendingCount}`,
          inline: true,
        },
        {
          name: "Scopes",
          value: config.scopes.join("\n").slice(0, 1024),
          inline: false,
        },
        {
          name: "Watched Source",
          value: sourceSummary.slice(0, 1024),
          inline: false,
        },
        {
          name: "Recent Blocking Errors",
          value: (errorSummary || "No recent blocking row errors.").slice(0, 1024),
          inline: false,
        },
        {
          name: "Recent Warnings",
          value: (warningSummary || "No recent warnings.").slice(0, 1024),
          inline: false,
        }
      );

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};

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

        return [
          `${source.sourceLabel}`,
          `Spreadsheet: ${source.spreadsheetId}`,
          `Configured Tab: ${source.worksheetTitle ?? "auto"}`,
          `Resolved Range: ${state?.lastResolvedRange ?? "not resolved yet"}`,
          `Last success: ${state?.lastSuccessfulSyncAt?.toISOString() ?? "never"}`,
          `Last run: +${state?.lastImportedCount ?? 0} / =${state?.lastDuplicateCount ?? 0} / !${state?.lastInvalidCount ?? 0}`,
          `Last error: ${state?.lastError ?? "none"}`,
        ].join("\n");
      })
      .join("\n\n");
    const issueSummary =
      issues.length > 0
        ? issues
            .map(
              (issue) =>
                `${issue.sourceLabel} row ${issue.rowNumber}: ${issue.reason}${
                  issue.rawTeamName ? ` (${issue.rawTeamName})` : ""
                }`
            )
            .join("\n")
        : "No recent validation issues.";

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
          name: "Recent Invalid Rows",
          value: issueSummary.slice(0, 1024),
          inline: false,
        }
      );

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};

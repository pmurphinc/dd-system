import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { BotCommand } from "./types";
import { hasAdminCommandAccess } from "../helpers/permissions";
import {
  CycleResultDuplicateAuditReport,
  CycleResultDuplicateComponent,
  CycleResultDuplicateGroup,
  CycleResultDuplicateRepairAction,
  repairCycleResultDuplicates,
  scanCycleResultDuplicates,
  StoredCycleResult,
} from "../storage/cycleResults";

const data = new SlashCommandBuilder();

data
  .setName("cycleresultaudit")
  .setDescription("Audit or repair duplicate cycle-result rows")
  .addStringOption((option) =>
    option
      .setName("mode")
      .setDescription("Choose audit-only or guarded repair")
      .setRequired(true)
      .addChoices(
        { name: "audit", value: "audit" },
        { name: "repair", value: "repair" }
      )
  );

function formatCycleResultRow(row: StoredCycleResult): string {
  return (
    `#${row.id} assignment=${row.matchAssignmentId} report=${row.reportSubmissionId} ` +
    `cycle=${row.cycleNumber} recorded=${row.recordedAt.toISOString()}`
  );
}

function formatDuplicateGroup(group: CycleResultDuplicateGroup): string {
  const conflictingRowIds = group.rows.map((row) => `#${row.id}`).join(", ");
  const rows = group.rows.map(formatCycleResultRow).join("\n");

  return (
    `${group.key}=${group.value}\n` +
    `Conflicting row ids: ${conflictingRowIds}\n` +
    `${rows}`
  );
}

function formatComponent(component: CycleResultDuplicateComponent): string {
  const header =
    `Canonical candidate #${component.canonicalRow.id}` +
    (component.reason ? ` | ${component.reason}` : "");
  const rows = component.rows.map(formatCycleResultRow).join("\n");

  return `${header}\n${rows}`;
}

function formatRepairAction(action: CycleResultDuplicateRepairAction): string {
  const removedRowIds = action.removedRows.map((row) => `#${row.id}`).join(", ");

  return (
    `Kept #${action.canonicalRow.id}\n` +
    `Removed: ${removedRowIds}\n` +
    `Why kept: ${action.selectionReason}\n` +
    `${formatCycleResultRow(action.canonicalRow)}`
  );
}

function truncateForDiscord(content: string): string {
  const maxLength = 1900;

  if (content.length <= maxLength) {
    return content;
  }

  return `${content.slice(0, maxLength - 32)}\n\n[output truncated]`;
}

function formatAuditReport(audit: CycleResultDuplicateAuditReport): string {
  if (!audit.hasDuplicates) {
    return "CycleResult duplicate audit\nNo duplicate CycleResult rows found.";
  }

  const sections = [
    "CycleResult duplicate audit",
    `Duplicate matchAssignmentId groups: ${audit.duplicateAssignmentGroups.length}`,
    ...audit.duplicateAssignmentGroups.map((group, index) => {
      return `Assignment group ${index + 1}\n${formatDuplicateGroup(group)}`;
    }),
    `Duplicate reportSubmissionId groups: ${audit.duplicateReportSubmissionGroups.length}`,
    ...audit.duplicateReportSubmissionGroups.map((group, index) => {
      return `Report group ${index + 1}\n${formatDuplicateGroup(group)}`;
    }),
    `Connected duplicate components: ${audit.components.length}`,
    ...audit.components.map((component, index) => {
      return `Component ${index + 1}\n${formatComponent(component)}`;
    }),
  ];

  return truncateForDiscord(sections.join("\n\n"));
}

export const cycleresultauditCommand: BotCommand = {
  data,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!hasAdminCommandAccess(interaction)) {
      await interaction.reply({
        content: "You do not have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    const mode = interaction.options.getString("mode", true);

    if (mode === "repair") {
      const repairResult = await repairCycleResultDuplicates();
      const sections = [
        "CycleResult duplicate repair",
        `Deleted row ids: ${
          repairResult.deletedRowIds.length > 0
            ? repairResult.deletedRowIds.join(", ")
            : "none"
        }`,
        `Repaired groups: ${repairResult.repairedComponents.length}`,
        `Skipped unsafe groups: ${repairResult.skippedComponents.length}`,
        ...repairResult.repairedComponents.map((action, index) => {
          return `Repair ${index + 1}\n${formatRepairAction(action)}`;
        }),
        ...repairResult.skippedComponents.map((component, index) => {
          return `Skipped ${index + 1}\n${formatComponent(component)}`;
        }),
        formatAuditReport(repairResult.audit),
      ];

      await interaction.reply({
        content: truncateForDiscord(sections.join("\n\n")),
        ephemeral: true,
      });
      return;
    }

    const audit = await scanCycleResultDuplicates();

    await interaction.reply({
      content: formatAuditReport(audit),
      ephemeral: true,
    });
  },
};

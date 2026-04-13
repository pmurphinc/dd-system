import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import {
  listImportedTeamsForTournamentInstance,
  listImportedTeams,
  listUnassignedImportedTeams,
} from "../storage/teams";
import {
  getTournamentInstanceById,
  getTournamentInstanceLabel,
  listTournamentInstancesForGuild,
  syncTournamentInstancesForGuild,
} from "../storage/tournamentInstances";

function formatInstanceStatus(status: string): string {
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCycleLabel(cycle: number | null): string {
  return cycle ? `Cycle ${cycle}` : "Cycle -";
}

function formatEditLockLabel(isLocked: boolean): string {
  return isLocked ? "Locked" : "Editable";
}

export async function buildAdminInstancePicker(
  guildId: string,
  customId = "admin:select_instance"
) {
  const instances = await syncTournamentInstancesForGuild(guildId);

  if (instances.length === 0) {
    return {
      content: "No tournament instances are available yet.",
      components: [],
    };
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Select a tournament instance")
    .addOptions(
      instances.map((instance) => ({
        label: getTournamentInstanceLabel(instance).slice(0, 100),
        description: `${formatInstanceStatus(instance.status)} | ${formatCycleLabel(
          instance.currentCycle
        )} | ${formatEditLockLabel(instance.isLocked)}`.slice(0, 100),
        value: `${instance.id}`,
      }))
    );

  return {
    content: "Select a tournament instance to manage.",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  };
}

export async function buildAdminPanel(
  guildId: string,
  tournamentInstanceId?: number
) {
  await syncTournamentInstancesForGuild(guildId);
  const instances = await listTournamentInstancesForGuild(guildId);
  const resolvedId = tournamentInstanceId ?? instances[0]?.id;

  if (!resolvedId) {
    return {
      content: "No tournament instances are available yet.",
      components: [],
    };
  }

  const [instance, assignedTeams, allTeams, unassignedTeams] = await Promise.all([
    getTournamentInstanceById(resolvedId),
    listImportedTeamsForTournamentInstance(resolvedId),
    listImportedTeams(),
    listUnassignedImportedTeams(),
  ]);

  if (!instance) {
    return {
      content: "Tournament instance not found.",
      components: [],
    };
  }

  const otherInstances = instances.filter((row) => row.id !== instance.id);

  const embed = new EmbedBuilder()
    .setTitle(`Founder Admin: ${getTournamentInstanceLabel(instance)}`)
    .setDescription("Founder-only instance management panel.")
    .addFields(
      { name: "Org Name", value: instance.orgName ?? "-", inline: true },
      { name: "Display Name", value: instance.displayName ?? "-", inline: true },
      { name: "Internal Key", value: instance.internalKey ?? instance.name, inline: true },
      { name: "Pod Number", value: `${instance.podNumber ?? "-"}`, inline: true },
      { name: "Locked", value: instance.isLocked ? "Yes" : "No", inline: true },
      { name: "Teams Assigned", value: `${assignedTeams.length}/${instance.maxTeams}`, inline: true },
      {
        name: "Assigned Teams",
        value:
          assignedTeams.length > 0
            ? assignedTeams.map((team) => team.teamName).join("\n")
            : "No teams assigned.",
        inline: false,
      },
      {
        name: "Unassigned Teams",
        value:
          unassignedTeams.length > 0
            ? unassignedTeams.map((team) => team.teamName).join("\n").slice(0, 1024)
            : "None",
        inline: false,
      },
      {
        name: "Other Instances",
        value:
          otherInstances.length > 0
            ? otherInstances
                .map((row) => getTournamentInstanceLabel(row))
                .join("\n")
                .slice(0, 1024)
            : "None",
        inline: false,
      },
      {
        name: "Imported Teams Total",
        value: `${allTeams.length}`,
        inline: true,
      }
    );

  const rowOne = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder()
    .setCustomId(`admin:${instance.id}:edit_name`)
    .setLabel("Edit Instance Name")
    .setStyle(ButtonStyle.Primary),

  new ButtonBuilder()
    .setCustomId(`admin:${instance.id}:create_instance`)
    .setLabel("Create Instance")
    .setStyle(ButtonStyle.Success),

  new ButtonBuilder()
    .setCustomId(`admin:${instance.id}:delete_instance`)
    .setLabel("Delete Empty Instance")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(assignedTeams.length > 0),

  new ButtonBuilder()
    .setCustomId(`admin:${instance.id}:reset_instance`)
    .setLabel("Reset Instance")
    .setStyle(ButtonStyle.Danger)
);

  const rowTwo = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`admin:${instance.id}:assign_team`)
      .setLabel("Assign Team")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`admin:${instance.id}:move_team`)
      .setLabel("Move Team")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`admin:${instance.id}:delete_team`)
      .setLabel("Delete Team")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`admin:${instance.id}:toggle_lock`)
      .setLabel(instance.isLocked ? "Unlock Instance" : "Lock Instance")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`admin:${instance.id}:refresh`)
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary)
  );

  const rowThree = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("admin:change_instance")
      .setLabel("Select Instance")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [rowOne, rowTwo, rowThree],
  };
}

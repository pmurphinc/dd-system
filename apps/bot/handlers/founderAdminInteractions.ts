import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { buildAdminInstancePicker, buildAdminPanel } from "../helpers/adminPanel";
import { hasFounderInteractionAccess } from "../helpers/permissions";
import {
  createEmptyTournamentInstance,
  deleteEmptyTournamentInstance,
  getTournamentInstanceById,
  listTournamentInstancesForGuild,
  resetTournamentInstance,
  updateTournamentInstanceMetadata,
} from "../storage/tournamentInstances";
import {
  assignTeamToTournamentInstance,
  listImportedTeams,
  listImportedTeamsForTournamentInstance,
} from "../storage/teams";

function parseAdminButton(customId: string) {
  const [, instanceIdRaw, action] = customId.split(":");
  return {
    instanceId: Number(instanceIdRaw),
    action,
  };
}

function getGuildIdFromInteraction(
  interaction:
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ModalSubmitInteraction
): string | null {
  return interaction.inCachedGuild() ? interaction.guildId : null;
}

export async function handleFounderAdminButton(
  interaction: ButtonInteraction
): Promise<boolean> {
  if (interaction.customId === "admin:change_instance") {
    const guildId = getGuildIdFromInteraction(interaction);

    if (!guildId) {
      return true;
    }

    const picker = await buildAdminInstancePicker(guildId);
    await interaction.reply({
      ...picker,
      ephemeral: true,
    });
    return true;
  }

  if (!interaction.customId.startsWith("admin:")) {
    return false;
  }

  if (!(await hasFounderInteractionAccess(interaction))) {
    await interaction.reply({
      content: "Only the Founder role can use this panel.",
      ephemeral: true,
    });
    return true;
  }

  const guildId = getGuildIdFromInteraction(interaction);

  if (!guildId) {
    await interaction.reply({
      content: "This admin panel can only be used inside a server.",
      ephemeral: true,
    });
    return true;
  }

  const { instanceId, action } = parseAdminButton(interaction.customId);

  if (action === "refresh") {
    const panel = await buildAdminPanel(guildId, instanceId);
    await interaction.reply({
      ...panel,
      ephemeral: true,
    });
    return true;
  }

  if (action === "edit_name") {
    const instance = await getTournamentInstanceById(instanceId);

    if (!instance) {
      await interaction.reply({
        content: "Tournament instance not found.",
        ephemeral: true,
      });
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(`admin:edit_name_modal:${instanceId}`)
      .setTitle("Edit Tournament Instance");

    const orgName = new TextInputBuilder()
      .setCustomId("org_name")
      .setLabel("Org Name")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(instance.orgName ?? "");

    const displayName = new TextInputBuilder()
      .setCustomId("display_name")
      .setLabel("Display Name")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(instance.displayName ?? "");

    const internalKey = new TextInputBuilder()
      .setCustomId("internal_key")
      .setLabel("Internal Key / Slug")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(instance.internalKey ?? "");

    const podNumber = new TextInputBuilder()
      .setCustomId("pod_number")
      .setLabel("Pod Number")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(instance.podNumber ? `${instance.podNumber}` : "");

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(orgName),
      new ActionRowBuilder<TextInputBuilder>().addComponents(displayName),
      new ActionRowBuilder<TextInputBuilder>().addComponents(internalKey),
      new ActionRowBuilder<TextInputBuilder>().addComponents(podNumber)
    );

    await interaction.showModal(modal);
    return true;
  }

  if (action === "create_instance") {
    const modal = new ModalBuilder()
      .setCustomId("admin:create_instance_modal")
      .setTitle("Create Tournament Instance");

    const orgName = new TextInputBuilder()
      .setCustomId("org_name")
      .setLabel("Org Name")
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const displayName = new TextInputBuilder()
      .setCustomId("display_name")
      .setLabel("Display Name")
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const internalKey = new TextInputBuilder()
      .setCustomId("internal_key")
      .setLabel("Internal Key / Slug")
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const podNumber = new TextInputBuilder()
      .setCustomId("pod_number")
      .setLabel("Pod Number")
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(orgName),
      new ActionRowBuilder<TextInputBuilder>().addComponents(displayName),
      new ActionRowBuilder<TextInputBuilder>().addComponents(internalKey),
      new ActionRowBuilder<TextInputBuilder>().addComponents(podNumber)
    );

    await interaction.showModal(modal);
    return true;
  }

  if (action === "delete_instance") {
    try {
      await deleteEmptyTournamentInstance(instanceId, interaction.user.id);
      const picker = await buildAdminInstancePicker(guildId);
      await interaction.reply({
        content: "Empty tournament instance deleted. Select another instance to continue.",
        components: picker.components,
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : "Delete failed.",
        ephemeral: true,
      });
    }
    return true;
  }

  if (action === "assign_team") {
    const candidates = (await listImportedTeams()).filter(
      (team) => team.tournamentInstanceId !== instanceId
    );

    if (candidates.length === 0) {
      await interaction.reply({
        content: "No imported teams are available.",
        ephemeral: true,
      });
      return true;
    }

const instances = await listTournamentInstancesForGuild(guildId);

const getInstanceLabelForTeam = (tournamentInstanceId: number | null) => {
  if (!tournamentInstanceId) {
    return "Unassigned";
  }

  const instance = instances.find((row) => row.id === tournamentInstanceId);
  return instance
    ? `Currently in ${instance.displayName ?? instance.orgName ?? instance.name}`
    : `Currently in instance ${tournamentInstanceId}`;
};

const menu = new StringSelectMenuBuilder()
  .setCustomId(`admin:assign_team_select:${instanceId}`)
  .setPlaceholder("Select a team")
  .addOptions(
    candidates.slice(0, 25).map((team) => ({
      label: team.teamName.slice(0, 100),
      description: getInstanceLabelForTeam(team.tournamentInstanceId).slice(0, 100),
      value: `${team.id}`,
    }))
  );

    await interaction.reply({
      content: "Select a team to assign.",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      ephemeral: true,
    });

    return true;
  }

  if (action === "move_team") {
    const assignedTeams = await listImportedTeamsForTournamentInstance(instanceId);

    if (assignedTeams.length === 0) {
      await interaction.reply({
        content: "No teams available to move.",
        ephemeral: true,
      });
      return true;
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`admin:move_team_select_team:${instanceId}`)
      .setPlaceholder("Select a team to move")
      .addOptions(
        assignedTeams.slice(0, 25).map((team) => ({
          label: team.teamName.slice(0, 100),
          value: `${team.id}`,
        }))
      );

    await interaction.reply({
      content: "Select the team you want to move.",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      ephemeral: true,
    });

    return true;
  }

  if (action === "reset_instance") {
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`admin:${instanceId}:confirm_reset`)
        .setLabel("Confirm Reset")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`admin:${instanceId}:cancel_reset`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content:
        "This will clear standings, results, assignments, cashout placements, and unassign all teams from this instance. Are you sure?",
      components: [confirmRow],
      ephemeral: true,
    });
    return true;
  }

  if (action === "confirm_reset") {
    try {
      await resetTournamentInstance(instanceId, interaction.user.id);
      const panel = await buildAdminPanel(guildId, instanceId);
      await interaction.reply({
        content: "Tournament instance has been reset.",
        ...panel,
        ephemeral: true,
      });
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : "Reset failed.",
        ephemeral: true,
      });
    }
    return true;
  }

  if (action === "cancel_reset") {
    const panel = await buildAdminPanel(guildId, instanceId);
    await interaction.reply({
      content: "Reset cancelled.",
      ...panel,
      ephemeral: true,
    });
    return true;
  }

  if (action === "toggle_lock") {
    const instance = await getTournamentInstanceById(instanceId);

    if (!instance) {
      await interaction.reply({
        content: "Instance not found.",
        ephemeral: true,
      });
      return true;
    }

    await updateTournamentInstanceMetadata(
      instanceId,
      { isLocked: !instance.isLocked },
      interaction.user.id
    );

    const panel = await buildAdminPanel(guildId, instanceId);
    await interaction.reply({
      content: `Instance ${instance.isLocked ? "unlocked" : "locked"}.`,
      ...panel,
      ephemeral: true,
    });
    return true;
  }

  return false;
}

export async function handleFounderAdminSelectMenu(
  interaction: StringSelectMenuInteraction
): Promise<boolean> {
  if (!(await hasFounderInteractionAccess(interaction))) {
    await interaction.reply({
      content: "Only the Founder role can use this panel.",
      ephemeral: true,
    });
    return true;
  }

  const guildId = getGuildIdFromInteraction(interaction);

  if (!guildId) {
    await interaction.reply({
      content: "Server only.",
      ephemeral: true,
    });
    return true;
  }

  if (interaction.customId === "admin:select_instance") {
    const panel = await buildAdminPanel(guildId, Number(interaction.values[0]));
    await interaction.reply({
      ...panel,
      ephemeral: true,
    });
    return true;
  }

  if (interaction.customId.startsWith("admin:assign_team_select:")) {
    const instanceId = Number(interaction.customId.split(":")[2]);
    const teamId = Number(interaction.values[0]);

    await assignTeamToTournamentInstance(teamId, instanceId, interaction.user.id);

    const panel = await buildAdminPanel(guildId, instanceId);
    await interaction.reply({
      content: `Team ${teamId} assigned.`,
      ...panel,
      ephemeral: true,
    });
    return true;
  }

  if (interaction.customId.startsWith("admin:move_team_select_team:")) {
    const instanceId = Number(interaction.customId.split(":")[2]);
    const teamId = interaction.values[0];

    const instances = await listTournamentInstancesForGuild(guildId);
    const destinationOptions = instances
      .filter((row) => row.id !== instanceId)
      .slice(0, 25)
      .map((row) => ({
        label: (row.displayName ?? row.name).slice(0, 100),
        description: `${row.id}: ${row.orgName ?? row.name}`.slice(0, 100),
        value: `${row.id}`,
      }));

    if (destinationOptions.length === 0) {
      await interaction.reply({
        content: "No other destination instances are available.",
        ephemeral: true,
      });
      return true;
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`admin:move_team_select_target:${instanceId}:${teamId}`)
      .setPlaceholder("Select destination instance")
      .addOptions(destinationOptions);

    await interaction.reply({
      content: "Select destination instance.",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      ephemeral: true,
    });

    return true;
  }

  if (interaction.customId.startsWith("admin:move_team_select_target:")) {
    const [, , sourceInstanceIdRaw, teamIdRaw] = interaction.customId.split(":");
    const sourceInstanceId = Number(sourceInstanceIdRaw);
    const teamId = Number(teamIdRaw);
    const targetInstanceId = Number(interaction.values[0]);

    await assignTeamToTournamentInstance(teamId, targetInstanceId, interaction.user.id);

    const panel = await buildAdminPanel(guildId, sourceInstanceId);
    await interaction.reply({
      content: `Moved team ${teamId} to instance ${targetInstanceId}.`,
      ...panel,
      ephemeral: true,
    });

    return true;
  }

  return false;
}

export async function handleFounderAdminModal(
  interaction: ModalSubmitInteraction
): Promise<boolean> {
  if (interaction.customId.startsWith("admin:edit_name_modal:")) {
    if (!(await hasFounderInteractionAccess(interaction))) {
      await interaction.reply({
        content: "Only the Founder role can use this panel.",
        ephemeral: true,
      });
      return true;
    }

    const guildId = getGuildIdFromInteraction(interaction);

    if (!guildId) {
      await interaction.reply({
        content: "This admin panel can only be used inside a server.",
        ephemeral: true,
      });
      return true;
    }

    const instanceId = Number(interaction.customId.split(":")[2]);
    const podRaw = interaction.fields.getTextInputValue("pod_number").trim();

    await updateTournamentInstanceMetadata(
      instanceId,
      {
        orgName: interaction.fields.getTextInputValue("org_name").trim() || null,
        displayName: interaction.fields.getTextInputValue("display_name").trim() || null,
        internalKey: interaction.fields.getTextInputValue("internal_key").trim() || null,
        podNumber: podRaw ? Number(podRaw) : null,
      },
      interaction.user.id
    );

    const panel = await buildAdminPanel(guildId, instanceId);
    await interaction.reply({
      content: "Tournament instance metadata updated.",
      ...panel,
      ephemeral: true,
    });
    return true;
  }

  if (interaction.customId === "admin:create_instance_modal") {
    if (!(await hasFounderInteractionAccess(interaction))) {
      await interaction.reply({
        content: "Only the Founder role can use this panel.",
        ephemeral: true,
      });
      return true;
    }

    const guildId = getGuildIdFromInteraction(interaction);

    if (!guildId) {
      await interaction.reply({
        content: "This admin panel can only be used inside a server.",
        ephemeral: true,
      });
      return true;
    }

    const podRaw = interaction.fields.getTextInputValue("pod_number").trim();

    const created = await createEmptyTournamentInstance(
      guildId,
      {
        orgName: interaction.fields.getTextInputValue("org_name").trim() || null,
        displayName: interaction.fields.getTextInputValue("display_name").trim() || null,
        internalKey: interaction.fields.getTextInputValue("internal_key").trim() || null,
        podNumber: podRaw ? Number(podRaw) : null,
      },
      interaction.user.id
    );

    const panel = await buildAdminPanel(guildId, created.id);
    await interaction.reply({
      content: "New empty tournament instance created.",
      ...panel,
      ephemeral: true,
    });
    return true;
  }

  return false;
}
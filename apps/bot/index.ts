import "dotenv/config";
import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { initializePanelAutoUpdateService, unregisterPanelMessage } from "./services/panelAutoUpdateService";

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token) throw new Error("Missing DISCORD_BOT_TOKEN");
if (!clientId) throw new Error("Missing DISCORD_CLIENT_ID");
if (!guildId) throw new Error("Missing DISCORD_GUILD_ID");

const config = {
  token,
  clientId,
  guildId,
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

import { pingCommand } from "./commands/ping";
import { registerCommand } from "./commands/register";
import { teamCommand } from "./commands/team";
import { matchCommand } from "./commands/match";
import { helpCommand } from "./commands/help";
import { statusCommand } from "./commands/status";
import { tournamentCommand } from "./commands/tournament";
import { adminCommand } from "./commands/admin";
import { checkinCommand } from "./commands/checkin";
import { reviewCommand } from "./commands/review";
import { reportCommand } from "./commands/report";
import { reportsCommand } from "./commands/reports";
import { standingsCommand } from "./commands/standings";
import { cycleresultsCommand } from "./commands/cycleresults";
import { syncstatusCommand } from "./commands/syncstatus";
import { handleButtonInteraction } from "./handlers/buttonHandler";
import { handleCommandInteraction } from "./handlers/commandHandler";
import { handleModalInteraction } from "./handlers/modalHandler";
import { handleSelectMenuInteraction } from "./handlers/selectMenuHandler";
import { startRegistrationSheetSyncPolling } from "./services/registrationSheetSync";
const commandList = [
  pingCommand,
  registerCommand,
  teamCommand,
  matchCommand,
  helpCommand,
  statusCommand,
  tournamentCommand,
  adminCommand,
  checkinCommand,
  reviewCommand,
  reportCommand,
  reportsCommand,
  standingsCommand,
  cycleresultsCommand,
  syncstatusCommand,
];

const commands = commandList.map((cmd) => cmd.data.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

async function registerCommands() {
  try {
    console.log("Clearing old global commands...");
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: [],
    });

    console.log("Registering guild slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );

    console.log("Guild slash commands registered.");
  } catch (error) {
    console.error("Failed to register commands:", error);
  }
}

initializePanelAutoUpdateService(client);

client.once("ready", async () => {
  console.log(`Bot is online as ${client.user?.tag}`);
  await registerCommands();
  startRegistrationSheetSyncPolling(client);
});


client.on("messageDelete", async (message) => {
  if (!message.guildId) return;
  unregisterPanelMessage(message.channelId, message.id);
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    await handleSelectMenuInteraction(interaction);
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleModalInteraction(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  await handleCommandInteraction(interaction, commandList);
});

client.login(config.token);

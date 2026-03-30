import { ChatInputCommandInteraction } from "discord.js";
import { BotCommand } from "../commands/types";
import { authorizeSlashCommand } from "../helpers/permissions";

export async function handleCommandInteraction(
  interaction: ChatInputCommandInteraction,
  commandList: BotCommand[]
) {
  const command = commandList.find(
    (cmd) => cmd.data.name === interaction.commandName
  );

  if (!command) return;

  const isAuthorized = await authorizeSlashCommand(interaction);

  if (!isAuthorized) {
    return;
  }

  await command.execute(interaction);
}

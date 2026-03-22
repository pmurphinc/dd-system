import { ChatInputCommandInteraction } from "discord.js";
import { BotCommand } from "../commands/types";

export async function handleCommandInteraction(
  interaction: ChatInputCommandInteraction,
  commandList: BotCommand[]
) {
  const command = commandList.find(
    (cmd) => cmd.data.name === interaction.commandName
  );

  if (!command) return;

  await command.execute(interaction);
}

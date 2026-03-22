import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export interface BotCommand {
  data: SlashCommandBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

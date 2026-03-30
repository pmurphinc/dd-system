import { ChatInputCommandInteraction } from "discord.js";

export interface BotCommand {
  data: {
    name: string;
    toJSON(): unknown;
  };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

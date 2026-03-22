import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { BotCommand } from "./types";

export const registerCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("register")
    .setDescription("Shows the Development Division registration link"),

  async execute(interaction: ChatInputCommandInteraction) {
    const registrationUrl = "https://forms.gle/PASTE-YOUR-GOOGLE-FORM-LINK-HERE";

    const embed = new EmbedBuilder()
      .setTitle("Development Division Registration")
      .setDescription(
        `Use the Google Form below to register your team for Development Division.\n\n${registrationUrl}`
      );

    const row =
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("Open Registration Form")
          .setStyle(ButtonStyle.Link)
          .setURL(registrationUrl)
      );

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
  },
};

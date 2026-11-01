/**
 * Discord Interactions endpoint for **wooper** only (before/after photo upload).
 *
 * Quote requests use a separate Discord app → `discord-interactions`.
 *
 * Secrets: DISCORD_PUBLIC_KEY, DISCORD_ADMIN_USER_IDS
 * Injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import {
  InteractionType,
  ephemeralReply,
  openDiscordInteraction,
  type Json,
} from "../_shared/discord.ts";
import {
  WOOPER_MODAL_PREFIX,
  handleWooperCommand,
  handleWooperModal,
} from "./wooper.ts";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

const waitUntil = (promise: Promise<unknown>) => EdgeRuntime.waitUntil(promise);

Deno.serve(async (req) => {
  const opened = await openDiscordInteraction(req, "DISCORD_PUBLIC_KEY");
  if ("response" in opened) return opened.response;

  const { interaction } = opened;
  const type = Number(interaction.type);
  const data = (interaction.data ?? {}) as Json;
  const customId = String(data.custom_id ?? "");

  if (type === InteractionType.APPLICATION_COMMAND) {
    const commandName = String(data.name ?? "");
    if (commandName === "wooper") {
      return await handleWooperCommand(interaction);
    }
    return ephemeralReply(`Unknown command \`${commandName}\`.`);
  }

  if (type === InteractionType.MODAL_SUBMIT) {
    if (customId.startsWith(WOOPER_MODAL_PREFIX)) {
      return handleWooperModal(interaction, waitUntil);
    }
    return ephemeralReply("Unknown form.");
  }

  return ephemeralReply("Unsupported interaction.");
});

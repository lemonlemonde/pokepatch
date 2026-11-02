/**
 * Discord Interactions endpoint for the **quotes** Discord app.
 *
 * Routes:
 * - `quote:<cardId>` button → per-card quote modal (quote.ts)
 * - `notify:<orderId>` button → Save & notify modal (notifyCustomer.ts)
 *
 * Wooper lives on a separate Discord app → `discord-photos`.
 *
 * Secrets: DISCORD_QUOTES_PUBLIC_KEY, DISCORD_ADMIN_USER_IDS, DISCORD_QUOTES_BOT_TOKEN
 * Injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import {
  InteractionType,
  ephemeralReply,
  openDiscordInteraction,
  type Json,
} from "../_shared/discord.ts";
import {
  NOTIFY_BUTTON_PREFIX,
  QUOTE_BUTTON_PREFIX,
} from "../_shared/discordOrderMessages.ts";
import {
  handleNotifyButton,
  handleNotifyModal,
} from "./notifyCustomer.ts";
import { handleQuoteButton, handleQuoteModal } from "./quote.ts";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

const waitUntil = (promise: Promise<unknown>) => EdgeRuntime.waitUntil(promise);

Deno.serve(async (req) => {
  const opened = await openDiscordInteraction(req, "DISCORD_QUOTES_PUBLIC_KEY");
  if ("response" in opened) return opened.response;

  const { interaction } = opened;
  const type = Number(interaction.type);
  const data = (interaction.data ?? {}) as Json;
  const customId = String(data.custom_id ?? "");

  if (type === InteractionType.MESSAGE_COMPONENT) {
    if (customId.startsWith(QUOTE_BUTTON_PREFIX)) {
      return await handleQuoteButton(interaction);
    }
    if (customId.startsWith(NOTIFY_BUTTON_PREFIX)) {
      return await handleNotifyButton(interaction);
    }
    return ephemeralReply("Unknown button.");
  }

  if (type === InteractionType.MODAL_SUBMIT) {
    if (customId.startsWith(QUOTE_BUTTON_PREFIX)) {
      return handleQuoteModal(interaction, waitUntil);
    }
    if (customId.startsWith(NOTIFY_BUTTON_PREFIX)) {
      return handleNotifyModal(interaction, waitUntil);
    }
    return ephemeralReply("Unknown form.");
  }

  return ephemeralReply("Unsupported interaction.");
});

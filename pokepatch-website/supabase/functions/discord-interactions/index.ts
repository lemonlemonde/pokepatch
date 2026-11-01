/**
 * Discord Interactions endpoint for the PokePatch app.
 *
 * Routes:
 * - `wooper` message command → before/after photo upload (wooper.ts)
 * - `quote:<cardId>` button → per-card quote modal (quote.ts)
 *
 * Secrets: DISCORD_PUBLIC_KEY, DISCORD_ADMIN_USER_IDS, DISCORD_BOT_TOKEN
 * Injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import {
  CallbackType,
  InteractionType,
  deniedResponse,
  ephemeralReply,
  interactionUserId,
  isAllowedUser,
  json,
  verifyDiscordRequest,
  type Interaction,
  type Json,
} from "../_shared/discord.ts";
import { QUOTE_BUTTON_PREFIX } from "../_shared/discordOrderMessages.ts";
import { handleQuoteButton, handleQuoteModal } from "./quote.ts";
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
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const publicKey = Deno.env.get("DISCORD_PUBLIC_KEY") ?? "";
  if (!publicKey) {
    console.error("DISCORD_PUBLIC_KEY not set");
    return new Response("Server misconfigured", { status: 500 });
  }

  const signature = req.headers.get("X-Signature-Ed25519") ?? "";
  const timestamp = req.headers.get("X-Signature-Timestamp") ?? "";
  const body = await req.text();

  const valid = await verifyDiscordRequest(publicKey, signature, timestamp, body);
  if (!valid) {
    return new Response("Invalid request signature", { status: 401 });
  }

  let interaction: Interaction;
  try {
    interaction = JSON.parse(body) as Interaction;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const type = Number(interaction.type);

  if (type === InteractionType.PING) {
    return json({ type: CallbackType.PONG });
  }

  if (!isAllowedUser(interactionUserId(interaction))) {
    return deniedResponse();
  }

  const data = (interaction.data ?? {}) as Json;
  const customId = String(data.custom_id ?? "");

  if (type === InteractionType.APPLICATION_COMMAND) {
    const commandName = String(data.name ?? "");
    if (commandName === "wooper") {
      return await handleWooperCommand(interaction);
    }
    return ephemeralReply(`Unknown command \`${commandName}\`.`);
  }

  if (type === InteractionType.MESSAGE_COMPONENT) {
    if (customId.startsWith(QUOTE_BUTTON_PREFIX)) {
      return await handleQuoteButton(interaction);
    }
    return ephemeralReply("Unknown button.");
  }

  if (type === InteractionType.MODAL_SUBMIT) {
    if (customId.startsWith(WOOPER_MODAL_PREFIX)) {
      return handleWooperModal(interaction, waitUntil);
    }
    if (customId.startsWith(QUOTE_BUTTON_PREFIX)) {
      return handleQuoteModal(interaction, waitUntil);
    }
    return ephemeralReply("Unknown form.");
  }

  return ephemeralReply("Unsupported interaction.");
});

/**
 * Discord Interactions endpoint for the **clamperl** Discord app.
 *
 * Slash command `/clamperl order:<n> card:<n>` → catalog select → carousel PNGs.
 *
 * The function also calls **itself**: each carousel pair is stitched in its
 * own worker (Edge CPU cap), handed off via a POST signed with the service role
 * key (`x-clamperl-hop`). Those requests bypass Discord signature checks.
 *
 * Quotes → `discord-interactions`. Wooper uploads → `discord-photos`.
 *
 * Secrets: DISCORD_CLAMPERL_PUBLIC_KEY, DISCORD_ADMIN_USER_IDS
 * Injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import {
  InteractionType,
  ephemeralReply,
  openDiscordInteraction,
  type Json,
} from "../_shared/discord.ts";
import {
  HOP_HEADER,
  PICK_CUSTOM_ID_PREFIX,
  handleClamperlCommandDeferred,
  handleClamperlHop,
  handleClamperlPickDeferred,
} from "./clamperl.ts";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

const waitUntil = (promise: Promise<unknown>) => EdgeRuntime.waitUntil(promise);

Deno.serve(async (req) => {
  if (req.method === "POST" && req.headers.has(HOP_HEADER)) {
    return handleClamperlHop(req, waitUntil);
  }

  const opened = await openDiscordInteraction(
    req,
    "DISCORD_CLAMPERL_PUBLIC_KEY"
  );
  if ("response" in opened) return opened.response;

  const { interaction } = opened;
  const type = Number(interaction.type);
  const data = (interaction.data ?? {}) as Json;

  if (type === InteractionType.MESSAGE_COMPONENT) {
    const customId = String(data.custom_id ?? "");
    if (customId.startsWith(PICK_CUSTOM_ID_PREFIX)) {
      return handleClamperlPickDeferred(interaction, waitUntil);
    }
    return ephemeralReply("Unknown clamperl control.");
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const commandName = String(data.name ?? "");
    if (commandName === "clamperl") {
      return handleClamperlCommandDeferred(interaction, waitUntil);
    }
    return ephemeralReply(`Unknown command \`${commandName}\`.`);
  }

  return ephemeralReply("Unsupported interaction.");
});

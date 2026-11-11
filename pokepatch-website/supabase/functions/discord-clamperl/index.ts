/**
 * Discord Interactions endpoint for the **clamperl** Discord app.
 *
 * Slash command `/clamperl order:<n> card:<n>` → carousel 4:5 before/after PNGs.
 *
 * Consecutive hops ping-pong to `discord-clamperl-hop` (and back) so a spent
 * isolate never receives the next stitch/gallery request. Hops are POSTs signed
 * with the service role key (`x-clamperl-hop`) and bypass Discord signature
 * checks.
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
  configureClamperlHopFunction,
  handleClamperlCommandDeferred,
  handleClamperlHop,
} from "./clamperl.ts";

configureClamperlHopFunction("discord-clamperl");

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

  if (type === InteractionType.APPLICATION_COMMAND) {
    const commandName = String(data.name ?? "");
    if (commandName === "clamperl") {
      return handleClamperlCommandDeferred(interaction, waitUntil);
    }
    return ephemeralReply(`Unknown command \`${commandName}\`.`);
  }

  return ephemeralReply("Unsupported interaction.");
});

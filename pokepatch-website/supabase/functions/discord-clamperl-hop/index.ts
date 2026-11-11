/**
 * Hop-only worker for clamperl. `/clamperl` Discord entry lives on
 * `discord-clamperl`; consecutive stitch/gallery hops ping-pong here so a
 * spent isolate never receives the next heavy request.
 *
 * Injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import {
  HOP_HEADER,
  configureClamperlHopFunction,
  handleClamperlHop,
} from "../discord-clamperl/clamperl.ts";

configureClamperlHopFunction("discord-clamperl-hop");

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

const waitUntil = (promise: Promise<unknown>) => EdgeRuntime.waitUntil(promise);

Deno.serve(async (req) => {
  if (req.method === "POST" && req.headers.has(HOP_HEADER)) {
    return handleClamperlHop(req, waitUntil);
  }
  return new Response("Not a clamperl hop", { status: 404 });
});

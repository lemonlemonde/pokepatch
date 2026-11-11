/**
 * `/clamperl` — generate Instagram carousel (4:5) before/after PNGs for one
 * order card (`order` + required `card`).
 *
 * Chip title/thumb come from the order card’s catalog fields (enforced when the
 * order enters To do). Each hop stitches ONE pair in a new HTTP request (CPU
 * time is per request), then gallery-publishes ONE source pair (+ required
 * thumbs) per hop. The final hop posts Discord attachments and deletes scratch
 * files.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceClient } from "../_shared/adminSession.ts";
import {
  CallbackType,
  EPHEMERAL,
  editOriginal,
  followupWithFiles,
  json,
  type DiscordUploadFile,
  type Interaction,
  type Json,
} from "../_shared/discord.ts";
import { BUCKET } from "../_shared/discordOrderMessages.ts";
import {
  SKIP_OVERVIEW_PAIRS,
  prepareCarouselOverlay,
  preloadInstaAssets,
  stitchCarouselPairPng,
  type CarouselOverlay,
} from "../_shared/instaCarousel.ts";
import {
  OWNER_ORDER_DISPLAY_ID,
  isAllowedOrderDisplayId,
  isOwnerOrderDisplayId,
} from "../_shared/ownerOrder.ts";
import { sanitizeDamageTags } from "../_shared/damageTags.ts";
import {
  cleanupGalleryItem,
  createPublishedGalleryItem,
  publishGalleryPairWithThumbs,
  setGalleryItemCatalogThumbnail,
  touchGalleryItemUpdatedAt,
} from "../_shared/publishGalleryFromCardPairs.ts";

const SIDE_IMAGE_TYPES: Record<"before" | "after", string[]> = {
  before: ["before", "progress_front", "progress_back"],
  after: ["after", "final_front", "final_back"],
};

/** Discord allows at most 10 attachments per message — hard fail above this. */
const FILES_PER_MESSAGE = 10;

/** Orphans older than this are safe to delete (avoids racing a concurrent /clamperl). */
const SCRATCH_MAX_AGE_MS = 60 * 60 * 1000;

/** Storage `.remove()` batch size. */
const REMOVE_BATCH = 100;

/** Header carrying the HMAC of a hop request body (signed with the service role key). */
export const HOP_HEADER = "x-clamperl-hop";

/** Hop handoff retries for gateway 502/546 and network blips. */
const HOP_MAX_ATTEMPTS = 6;
const HOP_RETRY_DELAY_MS = 1500;

type CardImageRow = {
  id: number;
  storage_path: string;
  image_type: string;
};

type CardRow = {
  id: string;
  card_name: string | null;
  set_name: string | null;
  damage_tags?: unknown;
  tcg_card_id?: string | null;
  catalog_card_name?: string | null;
  catalog_set_name?: string | null;
  catalog_image_url?: string | null;
};

type StagedPng = {
  path: string;
  filename: string;
};

/** Everything one hop needs; travels as the signed JSON body between workers. */
type ClamperlJob = {
  v: 1;
  jobId: string;
  applicationId: string;
  token: string;
  orderDisplayId: number;
  cardIndex: number;
  cardLabel: string;
  setLabel: string;
  /** Catalog art as base64 (fetched once at job start; avoids re-fetch per hop). */
  catalogFrontBase64: string | null;
  /** Order-card damage tags → gallery item damage section. */
  damageTags: string[];
  tcgCardId: string | null;
  sizeLimit: number;
  beforeCount: number;
  afterCount: number;
  /** Storage paths per pair: last N of each side (N = after count), overview skipped. */
  pairs: { before: string; after: string }[];
  /** Index into `pairs` for the next hop to stitch. */
  next: number;
  /**
   * Gallery publish phase (after all stitches). One pair + required thumbs per
   * hop so ImageScript stays under the Edge CPU cap.
   */
  galleryItemId: string | null;
  galleryNext: number;
  galleryAdminUrl: string | null;
  galleryPairCount: number;
  /** Set when gallery publish fails after cleanup — Discord PNGs still deliver. */
  galleryError: string | null;
  /** Hops dispatched so far (loop guard). */
  hops: number;
  staged: StagedPng[];
  skippedLarge: string[];
  notes: string[];
};

function optionValue(
  options: unknown,
  name: string
): string | number | null {
  if (!Array.isArray(options)) return null;
  for (const option of options) {
    if (!option || typeof option !== "object") continue;
    const record = option as Json;
    if (record.name === name && "value" in record) {
      return record.value as string | number;
    }
  }
  return null;
}

function parsePositiveInt(value: string | number | null): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

/** Positive display ids, or owner portfolio `#-1`. */
function parseOrderDisplayId(value: string | number | null): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!isAllowedOrderDisplayId(n)) return null;
  return n;
}

function orderLabel(orderDisplayId: number): string {
  return isOwnerOrderDisplayId(orderDisplayId)
    ? `My cards (**#${OWNER_ORDER_DISPLAY_ID}**)`
    : `Order **#${orderDisplayId}**`;
}

function attachmentSizeLimit(interaction: Interaction): number {
  const raw = Number(interaction.attachment_size_limit);
  if (Number.isFinite(raw) && raw > 0) return raw;
  // Bot baseline when the field is missing.
  return 10 * 1024 * 1024;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Supabase reads / Storage

async function downloadStorageBytes(
  supabase: SupabaseClient,
  path: string
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new Error(`storage download failed: ${path}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * N = after count. Take the last N photos on each side (extra prefix befores
 * are dropped), then skip the first SKIP_OVERVIEW_PAIRS of that slice.
 */
function selectClamperlPairs(
  beforeRows: CardImageRow[],
  afterRows: CardImageRow[]
): {
  alignedCount: number;
  pairs: { before: string; after: string }[];
} {
  const n = afterRows.length;
  const beforeAligned = beforeRows.slice(-n);
  const afterAligned = afterRows.slice(-n);
  const alignedCount = Math.min(beforeAligned.length, afterAligned.length);
  const pairs: { before: string; after: string }[] = [];
  for (let i = SKIP_OVERVIEW_PAIRS; i < alignedCount; i += 1) {
    pairs.push({
      before: beforeAligned[i].storage_path,
      after: afterAligned[i].storage_path,
    });
  }
  return { alignedCount, pairs };
}

async function loadSideImages(
  supabase: SupabaseClient,
  cardId: string,
  side: "before" | "after"
): Promise<CardImageRow[]> {
  const { data, error } = await supabase
    .from("card_images")
    .select("id, storage_path, image_type")
    .eq("card_id", cardId)
    .in("image_type", SIDE_IMAGE_TYPES[side])
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CardImageRow[];
}

async function loadOrderCards(
  supabase: SupabaseClient,
  orderId: string
): Promise<CardRow[]> {
  const full = await supabase
    .from("cards")
    .select(
      "id, card_name, set_name, sort_order, damage_tags, tcg_card_id, catalog_card_name, catalog_set_name, catalog_image_url"
    )
    .eq("order_id", orderId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (
    full.error &&
    /catalog_card_name|catalog_set_name|catalog_image_url|damage_tags|tcg_card_id|42703/i.test(
      full.error.message ?? ""
    )
  ) {
    const basic = await supabase
      .from("cards")
      .select("id, card_name, set_name, sort_order, damage_tags")
      .eq("order_id", orderId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (basic.error) throw basic.error;
    return (basic.data ?? []) as CardRow[];
  }
  if (full.error) throw full.error;
  return (full.data ?? []) as CardRow[];
}

/** @returns error message on failure, otherwise null */
async function removePaths(
  supabase: SupabaseClient,
  paths: string[]
): Promise<string | null> {
  if (paths.length === 0) return null;
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const batch = paths.slice(i, i + REMOVE_BATCH);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) {
      return error.message;
    }
  }
  return null;
}

/**
 * Delete stale objects under `clamperl/` (scratch prefix). Catches orphans left
 * when a worker is killed mid-hop, without wiping in-flight jobs.
 */
async function sweepClamperlScratch(supabase: SupabaseClient): Promise<void> {
  const paths: string[] = [];
  const cutoff = Date.now() - SCRATCH_MAX_AGE_MS;

  async function walk(prefix: string): Promise<void> {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: 1000,
    });
    if (error) return;
    for (const entry of data ?? []) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Folders from list() have id null / no metadata in some API versions.
      const isFile =
        entry.id != null || (entry.metadata && entry.metadata.size != null);
      if (!isFile) {
        await walk(full);
        continue;
      }
      const created = entry.created_at
        ? Date.parse(String(entry.created_at))
        : NaN;
      // Missing timestamps: treat as stale so old orphans still get cleared.
      if (Number.isFinite(created) && created > cutoff) continue;
      paths.push(full);
    }
  }

  await walk("clamperl");
  if (paths.length === 0) return;
  await removePaths(supabase, paths);
}

// ---------------------------------------------------------------------------
// Hop transport (function → itself)

function hopSecret(): string {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return key;
}

async function hopSignature(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(hopSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function selfUrl(): string {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  if (!base) throw new Error("SUPABASE_URL not set");
  return `${base.replace(/\/$/, "")}/functions/v1/discord-clamperl`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Hand the job to the next hop request. Resolves once that request has accepted (202). */
async function dispatchHop(job: ClamperlJob): Promise<void> {
  job.hops += 1;
  // Stitch hops + gallery hops (one pair each) + finalize slack.
  if (job.hops > job.pairs.length * 2 + 5) {
    throw new Error(`hop loop guard tripped (${job.hops} hops)`);
  }
  const body = JSON.stringify(job);
  const signature = await hopSignature(body);
  const url = selfUrl();
  const secret = hopSecret();

  let lastError = "";
  for (let attempt = 1; attempt <= HOP_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // verify_jwt is off for this function; bearer keeps hops working if it flips.
          Authorization: `Bearer ${secret}`,
          apikey: secret,
          [HOP_HEADER]: signature,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 202) return;
      lastError = `${res.status} ${await res.text().catch(() => "")}`.trim();
      // Transient gateway / isolate-boot errors are worth a retry.
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(HOP_RETRY_DELAY_MS);
  }
  throw new Error(
    `Could not dispatch the next hop after ${HOP_MAX_ATTEMPTS} attempts: ${lastError}`
  );
}

/**
 * Entry for hop requests (identified by `HOP_HEADER`). Verifies the HMAC,
 * accepts with 202, and runs the hop in the background.
 *
 * Do not 503 when this isolate already stitched: `/clamperl` is low-traffic,
 * so the self-POST often lands on the same warm worker. CPU time is per
 * request (not per isolate), and returning 503 while the dispatcher is still
 * blocked on fetch() keeps that worker alive and retries it until the job
 * fails.
 */
export async function handleClamperlHop(
  req: Request,
  waitUntil: (promise: Promise<unknown>) => void
): Promise<Response> {
  const signature = req.headers.get(HOP_HEADER) ?? "";
  const body = await req.text();
  const expected = await hopSignature(body);
  if (!signature || !timingSafeEqual(signature, expected)) {
    return new Response("Invalid hop signature", { status: 401 });
  }

  let job: ClamperlJob;
  try {
    job = JSON.parse(body) as ClamperlJob;
  } catch {
    return new Response("Bad hop JSON", { status: 400 });
  }
  if (
    job.v !== 1 ||
    !job.jobId ||
    !job.applicationId ||
    !job.token ||
    !Array.isArray(job.pairs) ||
    typeof job.next !== "number" ||
    job.next < 0 ||
    job.next > job.pairs.length ||
    typeof job.galleryNext !== "number" ||
    job.galleryNext < 0 ||
    job.galleryNext > job.pairs.length
  ) {
    return new Response("Unsupported hop payload", { status: 400 });
  }

  waitUntil(runHop(job));
  return json({ accepted: true, hop: job.hops, next: job.next }, 202);
}

// ---------------------------------------------------------------------------
// Job steps

async function setStatus(job: ClamperlJob, content: string): Promise<void> {
  await editOriginal(job.applicationId, job.token, content);
}

async function buildOverlay(job: ClamperlJob): Promise<CarouselOverlay> {
  const overlay: CarouselOverlay = {
    card: job.cardLabel,
    set: job.setLabel,
    frontBytes: job.catalogFrontBase64
      ? base64ToBytes(job.catalogFrontBase64)
      : null,
  };
  await prepareCarouselOverlay(overlay);
  return overlay;
}

/** Stitch `job.pairs[job.next]` in this request and stage it; advances `job.next`. */
async function stitchNextPair(
  job: ClamperlJob,
  supabase: SupabaseClient
): Promise<void> {
  const index = job.next;
  const pairNum = index + 1;
  const { before: beforePath, after: afterPath } = job.pairs[index];

  const [, overlay, beforeBytes, afterBytes] = await Promise.all([
    preloadInstaAssets(),
    buildOverlay(job),
    downloadStorageBytes(supabase, beforePath),
    downloadStorageBytes(supabase, afterPath),
  ]);

  const png = await stitchCarouselPairPng(beforeBytes, afterBytes, overlay);

  const filename = `pokepatch-pair-${pairNum}.png`;
  if (png.byteLength > job.sizeLimit) {
    job.skippedLarge.push(
      `${filename} (${Math.ceil(png.byteLength / (1024 * 1024))}MB > limit)`
    );
    job.next = index + 1;
    return;
  }

  const path =
    `clamperl/${job.orderDisplayId}/card${job.cardIndex}/${job.jobId}/${filename}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, png, { contentType: "image/png", upsert: true });
  if (uploadError) {
    throw new Error(`Failed to stage ${filename} to storage: ${uploadError.message}`);
  }
  job.staged.push({ path, filename });
  job.next = index + 1;
}

/**
 * One gallery hop: create the item on the first call, then copy + thumb-encode
 * exactly one source pair. On failure, delete any partial gallery item, record
 * `galleryError`, and skip remaining gallery hops (Discord finalize still runs).
 */
async function publishNextGalleryPair(
  job: ClamperlJob,
  supabase: SupabaseClient
): Promise<void> {
  const pairIndex = job.galleryNext;
  const pairNum = pairIndex + 1;
  const total = job.pairs.length;

  try {
    if (!job.galleryItemId) {
      await setStatus(
        job,
        `${orderLabel(job.orderDisplayId)} · card ${job.cardIndex} · publishing gallery…`
      );
      const created = await createPublishedGalleryItem(supabase, {
        title: job.cardLabel,
        setName: job.setLabel,
        damageTags: job.damageTags ?? [],
        tcgCardId: job.tcgCardId ?? null,
        tcgLookupTitle: job.cardLabel,
        tcgLookupSetName: job.setLabel,
      });
      job.galleryItemId = created.id;
      job.galleryAdminUrl = created.adminUrl;
    }

    await setStatus(
      job,
      `${orderLabel(job.orderDisplayId)} · card ${job.cardIndex} · gallery pair **${pairNum}/${total}**`
    );

    const pair = job.pairs[pairIndex];
    await publishGalleryPairWithThumbs(supabase, {
      itemId: job.galleryItemId,
      sortOrder: pairIndex,
      pair: { beforePath: pair.before, afterPath: pair.after },
      sourceBucket: BUCKET,
    });

    job.galleryNext = pairIndex + 1;
    job.galleryPairCount = job.galleryNext;

    if (job.galleryNext >= total) {
      if (job.catalogFrontBase64) {
        await setGalleryItemCatalogThumbnail(
          supabase,
          job.galleryItemId,
          base64ToBytes(job.catalogFrontBase64)
        );
      } else {
        await touchGalleryItemUpdatedAt(supabase, job.galleryItemId);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (job.galleryItemId) {
      await cleanupGalleryItem(supabase, job.galleryItemId);
    }
    job.galleryItemId = null;
    job.galleryAdminUrl = null;
    job.galleryPairCount = 0;
    job.galleryError = message;
    job.galleryNext = job.pairs.length;
  }
}

/** Last hop: post staged PNGs + Done/Edit status, delete scratch. */
async function finalizeJob(
  job: ClamperlJob,
  supabase: SupabaseClient
): Promise<void> {
  const { staged, cardIndex, cardLabel, orderDisplayId } = job;
  const prefix = `${orderLabel(orderDisplayId)} · card **${cardIndex}**`;

  try {
    if (staged.length === 0) {
      await setStatus(
        job,
        [
          `Nothing to generate — ${prefix}.`,
          `• ${cardLabel}: ${
            job.skippedLarge.length > 0
              ? "generated but all over Discord size limit"
              : "no posts generated"
          }`,
        ].join("\n")
      );
      return;
    }
    if (staged.length > FILES_PER_MESSAGE) {
      await setStatus(
        job,
        `${prefix} · Discord allows at most **${FILES_PER_MESSAGE}** attachments per message; this card has **${staged.length}**.`
      );
      return;
    }

    const galleryLine = job.galleryError
      ? `Gallery publish failed: ${job.galleryError}`
      : job.galleryItemId && job.galleryAdminUrl
        ? [
            `Gallery · **${job.galleryPairCount}** source pair(s) published`,
            `Edit: ${job.galleryAdminUrl}`,
          ].join("\n")
        : "";

    // Finished PNGs are small (1080×1350); reloading them is network, not CPU.
    const files: DiscordUploadFile[] = [];
    for (const item of staged) {
      files.push({
        filename: item.filename,
        bytes: await downloadStorageBytes(supabase, item.path),
        contentType: "image/png",
      });
    }
    await followupWithFiles(
      job.applicationId,
      job.token,
      { content: `Card ${cardIndex} · ${cardLabel} · **${files.length}** PNG(s)` },
      files
    );

    await setStatus(
      job,
      [
        `Done · ${orderLabel(orderDisplayId)} · card ${cardIndex} · ${cardLabel}`,
        `Skipped first **${SKIP_OVERVIEW_PAIRS}** overview pairs · **${staged.length}** of **${job.pairs.length}** PNG(s) (before ${job.beforeCount}/after ${job.afterCount})`,
        job.skippedLarge.length > 0
          ? `Omitted (too large):\n${job.skippedLarge.join("\n")}`
          : "",
        job.notes.length > 0
          ? `Notes:\n${job.notes.map((line) => `• ${line}`).join("\n")}`
          : "",
        galleryLine,
        `_PNGs are in the follow-up message._`,
      ]
        .filter(Boolean)
        .join("\n")
    );
  } finally {
    await removePaths(
      supabase,
      staged.map((item) => item.path)
    );
  }
}

async function failJob(
  job: ClamperlJob,
  supabase: SupabaseClient | null,
  err: unknown
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  if (supabase) {
    if (job.galleryItemId) {
      await cleanupGalleryItem(supabase, job.galleryItemId);
      job.galleryItemId = null;
      job.galleryAdminUrl = null;
      job.galleryPairCount = 0;
    }
    await removePaths(
      supabase,
      job.staged.map((item) => item.path)
    );
  }
  await setStatus(job, `Generate failed: ${message}`);
}

/**
 * One hop: stitch next pair, or publish next gallery pair (with required
 * thumbs), or finalize Discord delivery.
 */
async function runHop(job: ClamperlJob): Promise<void> {
  let supabase: SupabaseClient | null = null;
  try {
    supabase = getServiceClient();
    if (job.next < job.pairs.length) {
      await stitchNextPair(job, supabase);
      await dispatchHop(job);
      return;
    }
    if (job.galleryNext < job.pairs.length) {
      await publishNextGalleryPair(job, supabase);
      await dispatchHop(job);
      return;
    }
    await finalizeJob(job, supabase);
  } catch (err) {
    await failJob(job, supabase, err);
  }
}

// ---------------------------------------------------------------------------
// Slash command entry

async function fetchImageBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return bytesToBase64(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Resolve order/card, build the job, and dispatch hop 1. Cheap on CPU. */
async function startClamperlJob(params: {
  interaction: Interaction;
  orderDisplayId: number;
  /** 1-based card index within the order. */
  cardIndex: number;
}): Promise<void> {
  const { interaction, orderDisplayId, cardIndex } = params;
  const applicationId = String(interaction.application_id ?? "");
  const token = String(interaction.token ?? "");
  const reply = (content: string) => editOriginal(applicationId, token, content);

  try {
    const supabase = getServiceClient();

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, display_id")
      .eq("display_id", orderDisplayId)
      .maybeSingle();
    if (orderError) throw orderError;
    const label = orderLabel(orderDisplayId);
    if (!order) {
      await reply(
        isOwnerOrderDisplayId(orderDisplayId)
          ? `My cards order (#${OWNER_ORDER_DISPLAY_ID}) is missing. Run migrations.`
          : `Order #${orderDisplayId} not found.`
      );
      return;
    }

    const cards = await loadOrderCards(supabase, String(order.id));
    if (cards.length === 0) {
      await reply(`${label} has no cards.`);
      return;
    }
    const card = cards[cardIndex - 1];
    if (!card) {
      await reply(
        `${label} has ${cards.length} card(s); card ${cardIndex} is out of range.`
      );
      return;
    }

    const cardLabel = (
      card.catalog_card_name ||
      card.card_name ||
      `Card ${cardIndex}`
    ).trim();
    const setLabel = (card.catalog_set_name || card.set_name || "").trim();

    const [beforeRows, afterRows] = await Promise.all([
      loadSideImages(supabase, String(card.id), "before"),
      loadSideImages(supabase, String(card.id), "after"),
    ]);
    const beforeCount = beforeRows.length;
    const afterCount = afterRows.length;
    const prefix = `Nothing to generate — ${label} · card **${cardIndex}**.`;
    if (beforeCount === 0 || afterCount === 0) {
      await reply(
        `${prefix}\n• ${cardLabel}: before **${beforeCount}**, after **${afterCount}** (need both sides)`
      );
      return;
    }
    const { alignedCount, pairs } = selectClamperlPairs(beforeRows, afterRows);
    if (alignedCount <= SKIP_OVERVIEW_PAIRS) {
      await reply(
        `${prefix}\n• ${cardLabel}: only **${alignedCount}** pair(s); first **${SKIP_OVERVIEW_PAIRS}** of the last **${alignedCount}** are overview (before **${beforeCount}**, after **${afterCount}**)`
      );
      return;
    }
    if (pairs.length > FILES_PER_MESSAGE) {
      await reply(
        `${label} · card **${cardIndex}** · Discord allows at most **${FILES_PER_MESSAGE}** attachments per message; this card would produce **${pairs.length}**.`
      );
      return;
    }

    const notes: string[] = [];
    if (beforeCount !== afterCount) {
      notes.push(
        `before **${beforeCount}** ≠ after **${afterCount}** — used last **${alignedCount}**, skipped first **${SKIP_OVERVIEW_PAIRS}** overview → **${pairs.length}** post(s)`
      );
    }

    let catalogFrontBase64: string | null = null;
    if (card.catalog_image_url) {
      catalogFrontBase64 = await fetchImageBase64(String(card.catalog_image_url));
    }

    const job: ClamperlJob = {
      v: 1,
      jobId: crypto.randomUUID(),
      applicationId,
      token,
      orderDisplayId,
      cardIndex,
      cardLabel,
      setLabel,
      catalogFrontBase64,
      damageTags: sanitizeDamageTags(card.damage_tags),
      tcgCardId: (card.tcg_card_id ?? "").trim() || null,
      sizeLimit: attachmentSizeLimit(interaction),
      beforeCount,
      afterCount,
      pairs,
      next: 0,
      galleryItemId: null,
      galleryNext: 0,
      galleryAdminUrl: null,
      galleryPairCount: 0,
      galleryError: null,
      hops: 0,
      staged: [],
      skippedLarge: [],
      notes,
    };

    await sweepClamperlScratch(supabase);
    await reply(
      `Generating ${label} · card **${cardIndex}** · **${pairs.length}** pair(s)…`
    );
    await dispatchHop(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await reply(`Generate failed: ${message}`);
  }
}

/** Parse slash options and kick off the deferred job via waitUntil. */
export function handleClamperlCommandDeferred(
  interaction: Interaction,
  waitUntil: (promise: Promise<unknown>) => void
): Response {
  const data = (interaction.data ?? {}) as Json;
  const orderDisplayId = parseOrderDisplayId(optionValue(data.options, "order"));
  const cardIndex = parsePositiveInt(optionValue(data.options, "card"));

  if (orderDisplayId == null) {
    return json({
      type: CallbackType.CHANNEL_MESSAGE,
      data: {
        content: `Order must be a positive whole number (e.g. \`42\`) or \`${OWNER_ORDER_DISPLAY_ID}\` for my cards.`,
        flags: EPHEMERAL,
      },
    });
  }
  if (cardIndex == null) {
    return json({
      type: CallbackType.CHANNEL_MESSAGE,
      data: {
        content:
          "Card is required — use the 1-based index within the order (1, 2, 3…).",
        flags: EPHEMERAL,
      },
    });
  }

  waitUntil(startClamperlJob({ interaction, orderDisplayId, cardIndex }));

  // Public channel reply so PNGs stay visible for download by anyone.
  return json({ type: CallbackType.DEFERRED_CHANNEL_MESSAGE });
}

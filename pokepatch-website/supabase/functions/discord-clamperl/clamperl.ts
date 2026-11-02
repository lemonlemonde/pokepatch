/**
 * `/clamperl` — generate Instagram carousel (4:5) before/after PNGs for an
 * order card (or every card in the order when `card` is omitted).
 *
 * Loads before/after photos (sorted by id), skips the first two overview pairs,
 * index-pairs the rest, stitches lossless PNGs matching Studio's carousel layout,
 * and replies with downloadable attachments.
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
  preloadInstaAssets,
  stitchCarouselPairPng,
  type CarouselOverlay,
} from "../_shared/instaCarousel.ts";

const SIDE_IMAGE_TYPES: Record<"before" | "after", string[]> = {
  before: ["before", "progress_front", "progress_back"],
  after: ["after", "final_front", "final_back"],
};

/** Discord allows at most 10 files per message. */
const FILES_PER_MESSAGE = 10;
/**
 * Keep each multipart under this so Edge + Discord don't hang/OOM on a
 * multi-PNG upload (lossless 1080×1350 frames are multi‑MB each).
 */
const MAX_BATCH_BYTES = 8 * 1024 * 1024;

function chunkFilesForDiscord(files: DiscordUploadFile[]): DiscordUploadFile[][] {
  const batches: DiscordUploadFile[][] = [];
  let current: DiscordUploadFile[] = [];
  let currentBytes = 0;
  for (const file of files) {
    const nextBytes = currentBytes + file.bytes.byteLength;
    if (
      current.length > 0 &&
      (current.length >= FILES_PER_MESSAGE || nextBytes > MAX_BATCH_BYTES)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.bytes.byteLength;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

type CardImageRow = {
  id: number;
  storage_path: string;
  image_type: string;
};

type CardRow = {
  id: string;
  card_name: string | null;
  set_name: string | null;
  catalog_card_name?: string | null;
  catalog_set_name?: string | null;
  catalog_image_url?: string | null;
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

function attachmentSizeLimit(interaction: Interaction): number {
  const raw = Number(interaction.attachment_size_limit);
  if (Number.isFinite(raw) && raw > 0) return raw;
  // Bot baseline when the field is missing.
  return 10 * 1024 * 1024;
}

async function loadOrderCards(
  supabase: SupabaseClient,
  orderId: string
): Promise<CardRow[]> {
  const full = await supabase
    .from("cards")
    .select(
      "id, card_name, set_name, sort_order, catalog_card_name, catalog_set_name, catalog_image_url"
    )
    .eq("order_id", orderId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (
    full.error &&
    /catalog_card_name|catalog_set_name|catalog_image_url|42703/i.test(
      full.error.message ?? ""
    )
  ) {
    const basic = await supabase
      .from("cards")
      .select("id, card_name, set_name, sort_order")
      .eq("order_id", orderId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (basic.error) throw basic.error;
    return (basic.data ?? []) as CardRow[];
  }
  if (full.error) throw full.error;
  return (full.data ?? []) as CardRow[];
}

type CardGenerateResult =
  | {
      ok: true;
      cardIndex: number;
      cardLabel: string;
      posted: number;
      beforeCount: number;
      afterCount: number;
      workCount: number;
      skippedLarge: string[];
      notes: string[];
    }
  | {
      ok: false;
      cardIndex: number;
      cardLabel: string;
      reason: string;
    };

/**
 * Download + stitch pairs one at a time (never parallel ImageScript), then
 * post every PNG for this card in as few Discord messages as possible.
 */
async function generateForCard(params: {
  supabase: SupabaseClient;
  card: CardRow;
  cardIndex: number;
  orderDisplayId: number;
  sizeLimit: number;
  multiCard: boolean;
  applicationId: string;
  token: string;
  onPairProgress: (state: {
    pair: number;
    total: number;
  }) => Promise<void>;
  onStatus: (content: string) => Promise<void>;
}): Promise<CardGenerateResult> {
  const {
    supabase,
    card,
    cardIndex,
    orderDisplayId,
    sizeLimit,
    multiCard,
    applicationId,
    token,
    onPairProgress,
    onStatus,
  } = params;
  const cardId = String(card.id);
  const cardLabel = (
    card.catalog_card_name ||
    card.card_name ||
    `Card ${cardIndex}`
  ).trim();
  const setLabel = (card.catalog_set_name || card.set_name || "").trim();

  const [beforeRows, afterRows] = await Promise.all([
    loadSideImages(supabase, cardId, "before"),
    loadSideImages(supabase, cardId, "after"),
  ]);

  if (beforeRows.length === 0 || afterRows.length === 0) {
    return {
      ok: false,
      cardIndex,
      cardLabel,
      reason: `before **${beforeRows.length}**, after **${afterRows.length}** (need both sides)`,
    };
  }

  const beforeCount = beforeRows.length;
  const afterCount = afterRows.length;
  const pairCount = Math.min(beforeCount, afterCount);
  if (pairCount <= SKIP_OVERVIEW_PAIRS) {
    return {
      ok: false,
      cardIndex,
      cardLabel,
      reason: `only **${pairCount}** pair(s); first **${SKIP_OVERVIEW_PAIRS}** are overview (before **${beforeCount}**, after **${afterCount}**)`,
    };
  }

  const workCount = pairCount - SKIP_OVERVIEW_PAIRS;
  const notes: string[] = [];
  if (beforeCount !== afterCount) {
    notes.push(
      `before **${beforeCount}** ≠ after **${afterCount}** — paired **${pairCount}**, skipped first **${SKIP_OVERVIEW_PAIRS}** overview → **${workCount}** post(s)`
    );
  }

  const overlay: CarouselOverlay = {
    card: cardLabel,
    set: setLabel,
    frontBytes: null,
  };
  if (card.catalog_image_url) {
    try {
      const res = await fetch(String(card.catalog_image_url));
      if (res.ok) {
        overlay.frontBytes = new Uint8Array(await res.arrayBuffer());
      }
    } catch {
      overlay.frontBytes = null;
    }
  }

  const files: DiscordUploadFile[] = [];
  const skippedLarge: string[] = [];

  for (let offset = 0; offset < workCount; offset += 1) {
    const i = SKIP_OVERVIEW_PAIRS + offset;
    const pairNum = offset + 1;
    await onPairProgress({ pair: pairNum, total: workCount });

    const [beforeBytes, afterBytes] = await Promise.all([
      downloadStorageBytes(supabase, beforeRows[i].storage_path),
      downloadStorageBytes(supabase, afterRows[i].storage_path),
    ]);

    // One stitch at a time — concurrent ImageScript freezes on Edge.
    const png = await stitchCarouselPairPng(beforeBytes, afterBytes, overlay);
    const filename = multiCard
      ? `pokepatch-card${cardIndex}-pair-${pairNum}.png`
      : `pokepatch-pair-${pairNum}.png`;

    if (png.byteLength > sizeLimit) {
      skippedLarge.push(
        `${filename} (${Math.ceil(png.byteLength / (1024 * 1024))}MB > limit)`
      );
      continue;
    }

    files.push({
      filename,
      bytes: png,
      contentType: "image/png",
    });
  }

  if (files.length === 0) {
    return {
      ok: false,
      cardIndex,
      cardLabel,
      reason:
        skippedLarge.length > 0
          ? `generated but all over Discord size limit`
          : `no posts generated`,
    };
  }

  const totalMb = (
    files.reduce((sum, file) => sum + file.bytes.byteLength, 0) /
    (1024 * 1024)
  ).toFixed(1);
  await onStatus(
    `Order **#${orderDisplayId}** · Card ${cardIndex} · uploading **${files.length}** PNG(s) (${totalMb} MB)…`
  );

  // Prefer fewer messages, but split by size. If a multi-file post fails,
  // fall back to one PNG per message (that path is proven on Discord/Edge).
  const batches = chunkFilesForDiscord(files);
  let posted = 0;
  for (let b = 0; b < batches.length; b += 1) {
    const batch = batches[b];
    const label =
      batches.length === 1
        ? `Card ${cardIndex} · ${cardLabel} · **${files.length}** PNG(s)`
        : `Card ${cardIndex} · ${cardLabel} · PNGs (${b + 1}/${batches.length})`;
    try {
      console.log(
        "clamperl upload batch",
        JSON.stringify({
          cardIndex,
          batch: b + 1,
          files: batch.length,
          bytes: batch.reduce((sum, file) => sum + file.bytes.byteLength, 0),
        })
      );
      await followupWithFiles(
        applicationId,
        token,
        { content: label },
        batch
      );
      posted += batch.length;
    } catch (batchErr) {
      console.error("clamperl multi-file upload failed; falling back", batchErr);
      if (batch.length === 1) throw batchErr;
      for (const file of batch) {
        await followupWithFiles(
          applicationId,
          token,
          {
            content: `Card ${cardIndex} · ${cardLabel} · ${file.filename}`,
          },
          [file]
        );
        posted += 1;
      }
      notes.push(
        `multi-file Discord upload failed for card ${cardIndex}; posted PNGs one-by-one instead`
      );
    }
  }

  return {
    ok: true,
    cardIndex,
    cardLabel,
    posted,
    beforeCount,
    afterCount,
    workCount,
    skippedLarge,
    notes,
  };
}

export async function runClamperlJob(params: {
  interaction: Interaction;
  orderDisplayId: number;
  /** 1-based card index, or null to generate every card in the order. */
  cardIndex: number | null;
}): Promise<void> {
  const { interaction, orderDisplayId, cardIndex } = params;
  const applicationId = String(interaction.application_id ?? "");
  const token = String(interaction.token ?? "");
  const sizeLimit = attachmentSizeLimit(interaction);

  try {
    const supabase = getServiceClient();

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, display_id")
      .eq("display_id", orderDisplayId)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) {
      await editOriginal(
        applicationId,
        token,
        `Order #${orderDisplayId} not found.`
      );
      return;
    }

    const cards = await loadOrderCards(supabase, String(order.id));
    if (cards.length === 0) {
      await editOriginal(
        applicationId,
        token,
        `Order #${orderDisplayId} has no cards.`
      );
      return;
    }

    const targets: { card: CardRow; cardIndex: number }[] = [];
    if (cardIndex == null) {
      for (let i = 0; i < cards.length; i += 1) {
        targets.push({ card: cards[i], cardIndex: i + 1 });
      }
    } else {
      const card = cards[cardIndex - 1];
      if (!card) {
        await editOriginal(
          applicationId,
          token,
          `Order #${orderDisplayId} has ${cards.length} card(s); card ${cardIndex} is out of range.`
        );
        return;
      }
      targets.push({ card, cardIndex });
    }

    const multiCard = targets.length > 1;
    await Promise.all([
      preloadInstaAssets(),
      editOriginal(
        applicationId,
        token,
        multiCard
          ? `Generating Order **#${orderDisplayId}** · **${targets.length}** cards…\n(each card posts as one message when ready)`
          : `Generating Order **#${orderDisplayId}** · card **${targets[0].cardIndex}**…`
      ),
    ]);

    const skippedLarge: string[] = [];
    const skippedCards: string[] = [];
    const okCards: string[] = [];
    const notes: string[] = [];
    let postedFiles = 0;

    // One card at a time; stitch pairs sequentially, then upload that card's PNGs together.
    for (let t = 0; t < targets.length; t += 1) {
      const target = targets[t];
      const result = await generateForCard({
        supabase,
        card: target.card,
        cardIndex: target.cardIndex,
        sizeLimit,
        multiCard,
        applicationId,
        token,
        orderDisplayId,
        onStatus: async (content) => {
          await editOriginal(applicationId, token, content);
        },
        onPairProgress: async ({ pair, total }) => {
          await editOriginal(
            applicationId,
            token,
            [
              `Order **#${orderDisplayId}**`,
              multiCard
                ? `Card **${target.cardIndex}/${targets.length}** · stitching pair **${pair}/${total}**`
                : `Card ${target.cardIndex} · stitching pair **${pair}/${total}**`,
              okCards.length > 0
                ? `Done:\n${okCards.map((line) => `• ${line}`).join("\n")}`
                : "",
              skippedCards.length > 0
                ? `Skipped:\n${skippedCards.map((line) => `• ${line}`).join("\n")}`
                : "",
            ]
              .filter(Boolean)
              .join("\n")
          );
        },
      });

      if (!result.ok) {
        skippedCards.push(
          `card ${result.cardIndex} · ${result.cardLabel}: ${result.reason}`
        );
      } else {
        okCards.push(
          `card ${result.cardIndex} · ${result.cardLabel} (**${result.posted}** of **${result.workCount}** · before ${result.beforeCount}/after ${result.afterCount})`
        );
        skippedLarge.push(...result.skippedLarge);
        notes.push(...result.notes);
        postedFiles += result.posted;
      }
    }

    if (postedFiles === 0) {
      await editOriginal(
        applicationId,
        token,
        [
          `Nothing to generate — Order **#${orderDisplayId}**.`,
          skippedCards.length > 0
            ? `Skipped:\n${skippedCards.map((line) => `• ${line}`).join("\n")}`
            : "",
          skippedLarge.length > 0
            ? `Too large:\n${skippedLarge.join("\n")}`
            : "",
          notes.length > 0 ? notes.join("\n") : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
      return;
    }

    const scope =
      cardIndex == null
        ? `all cards (${okCards.length}/${targets.length} generated)`
        : okCards[0] ?? `card ${cardIndex}`;
    await editOriginal(
      applicationId,
      token,
      [
        `Done · Order **#${orderDisplayId}** · ${scope}`,
        `Skipped first **${SKIP_OVERVIEW_PAIRS}** overview pairs · **${postedFiles}** PNG(s)`,
        okCards.length > 0
          ? `Cards:\n${okCards.map((line) => `• ${line}`).join("\n")}`
          : "",
        skippedCards.length > 0
          ? `Skipped cards:\n${skippedCards.map((line) => `• ${line}`).join("\n")}`
          : "",
        skippedLarge.length > 0
          ? `Omitted (too large):\n${skippedLarge.join("\n")}`
          : "",
        notes.length > 0 ? `Notes:\n${notes.map((line) => `• ${line}`).join("\n")}` : "",
        `_PNGs are in the follow-up message(s)._`,
      ]
        .filter(Boolean)
        .join("\n")
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("clamperl job failed", err);
    await editOriginal(applicationId, token, `Generate failed: ${message}`);
  }
}

/** Parse slash options and kick off the deferred job via waitUntil. */
export function handleClamperlCommandDeferred(
  interaction: Interaction,
  waitUntil: (promise: Promise<unknown>) => void
): Response {
  const data = (interaction.data ?? {}) as Json;
  const orderDisplayId = parsePositiveInt(optionValue(data.options, "order"));
  const cardRaw = optionValue(data.options, "card");
  const cardIndex =
    cardRaw == null || String(cardRaw).trim() === ""
      ? null
      : parsePositiveInt(cardRaw);

  if (orderDisplayId == null) {
    return json({
      type: CallbackType.CHANNEL_MESSAGE,
      data: {
        content: "Order must be a positive whole number (e.g. `42`).",
        flags: EPHEMERAL,
      },
    });
  }
  if (cardRaw != null && String(cardRaw).trim() !== "" && cardIndex == null) {
    return json({
      type: CallbackType.CHANNEL_MESSAGE,
      data: {
        content:
          "Card must be a 1-based index within the order (1, 2, 3…), or leave blank for every card.",
        flags: EPHEMERAL,
      },
    });
  }

  waitUntil(
    runClamperlJob({
      interaction,
      orderDisplayId,
      cardIndex,
    })
  );

  // Public channel reply so PNGs stay visible for download by anyone.
  return json({
    type: CallbackType.DEFERRED_CHANNEL_MESSAGE,
  });
}

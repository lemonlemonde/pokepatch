/**
 * `/clamperl` — generate Instagram carousel (4:5) before/after PNGs for one
 * order card (`order` + required `card`).
 *
 * Loads before/after photos (sorted by id), skips the first two overview pairs,
 * index-pairs the rest, stitches lossless PNGs matching Studio's carousel layout,
 * stages each PNG to Storage, and replies with one Discord message (embeds + links).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceClient } from "../_shared/adminSession.ts";
import {
  CallbackType,
  EPHEMERAL,
  editOriginal,
  followup,
  json,
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

/** Discord allows at most 10 embeds per message — hard fail above this. */
const MAX_EMBED_IMAGES = 10;
/** Keep staged PNGs browsable from Discord history. */
const SIGNED_URL_EXPIRES_IN = 60 * 60 * 24 * 365;

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

type StagedPng = {
  path: string;
  filename: string;
  byteLength: number;
};

/**
 * Stitch pairs one at a time. Holding multiple finished PNGs in Edge memory
 * OOMs/hangs ImageScript on later pairs, so each PNG is staged to Storage
 * immediately, then the card is posted as one Discord message (embeds + links).
 */
async function generateForCard(params: {
  supabase: SupabaseClient;
  card: CardRow;
  cardIndex: number;
  orderDisplayId: number;
  sizeLimit: number;
  applicationId: string;
  token: string;
  onPairProgress: (state: {
    pair: number;
    total: number;
    phase: "stitching" | "staged";
  }) => Promise<void>;
  onStatus: (content: string) => Promise<void>;
}): Promise<CardGenerateResult> {
  const {
    supabase,
    card,
    cardIndex,
    orderDisplayId,
    sizeLimit,
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

  const jobId = crypto.randomUUID();
  const staged: StagedPng[] = [];
  const skippedLarge: string[] = [];

  for (let offset = 0; offset < workCount; offset += 1) {
    const i = SKIP_OVERVIEW_PAIRS + offset;
    const pairNum = offset + 1;
    await onPairProgress({
      pair: pairNum,
      total: workCount,
      phase: "stitching",
    });

    const [beforeBytes, afterBytes] = await Promise.all([
      downloadStorageBytes(supabase, beforeRows[i].storage_path),
      downloadStorageBytes(supabase, afterRows[i].storage_path),
    ]);

    // One stitch at a time — concurrent ImageScript freezes on Edge.
    const png = await stitchCarouselPairPng(beforeBytes, afterBytes, overlay);
    const filename = `pokepatch-pair-${pairNum}.png`;

    if (png.byteLength > sizeLimit) {
      skippedLarge.push(
        `${filename} (${Math.ceil(png.byteLength / (1024 * 1024))}MB > limit)`
      );
      continue;
    }

    const path =
      `clamperl/${orderDisplayId}/card${cardIndex}/${jobId}/${filename}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, png, {
        contentType: "image/png",
        upsert: true,
      });
    if (uploadError) {
      throw new Error(
        `Failed to stage ${filename} to storage: ${uploadError.message}`
      );
    }
    staged.push({ path, filename, byteLength: png.byteLength });
    console.log(
      "clamperl staged",
      JSON.stringify({
        cardIndex,
        pair: pairNum,
        bytes: png.byteLength,
        path,
      })
    );
    await onPairProgress({
      pair: pairNum,
      total: workCount,
      phase: "staged",
    });
  }

  if (staged.length === 0) {
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

  if (staged.length > MAX_EMBED_IMAGES) {
    return {
      ok: false,
      cardIndex,
      cardLabel,
      reason: `Discord allows at most **${MAX_EMBED_IMAGES}** images per message; this card has **${staged.length}**`,
    };
  }

  const totalMb = (
    staged.reduce((sum, file) => sum + file.byteLength, 0) /
    (1024 * 1024)
  ).toFixed(1);
  await onStatus(
    `Order **#${orderDisplayId}** · Card ${cardIndex} · posting **${staged.length}** PNG(s) (${totalMb} MB)…`
  );

  // Embed title `url` is the download target — keep content short (Discord 2000 cap).
  const embeds: Json[] = [];
  for (let i = 0; i < staged.length; i += 1) {
    const item = staged[i];
    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(item.path, SIGNED_URL_EXPIRES_IN);
    if (signError || !signed?.signedUrl) {
      throw new Error(
        `Failed to sign ${item.filename}: ${signError?.message ?? "no url"}`
      );
    }
    embeds.push({
      title: `Pair ${i + 1} · ${item.filename}`,
      url: signed.signedUrl,
      image: { url: signed.signedUrl },
    });
  }

  await followup(applicationId, token, {
    content: `Card ${cardIndex} · ${cardLabel} · **${staged.length}** PNG(s)\n_Click a pair title (or open the image) to download._`,
    embeds,
  });

  return {
    ok: true,
    cardIndex,
    cardLabel,
    posted: staged.length,
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
  /** 1-based card index within the order. */
  cardIndex: number;
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

    const card = cards[cardIndex - 1];
    if (!card) {
      await editOriginal(
        applicationId,
        token,
        `Order #${orderDisplayId} has ${cards.length} card(s); card ${cardIndex} is out of range.`
      );
      return;
    }

    await Promise.all([
      preloadInstaAssets(),
      editOriginal(
        applicationId,
        token,
        `Generating Order **#${orderDisplayId}** · card **${cardIndex}**…`
      ),
    ]);

    const result = await generateForCard({
      supabase,
      card,
      cardIndex,
      sizeLimit,
      applicationId,
      token,
      orderDisplayId,
      onStatus: async (content) => {
        await editOriginal(applicationId, token, content);
      },
      onPairProgress: async ({ pair, total, phase }) => {
        const step =
          phase === "stitching"
            ? `stitching pair **${pair}/${total}**`
            : `staged pair **${pair}/${total}**`;
        await editOriginal(
          applicationId,
          token,
          `Order **#${orderDisplayId}**\nCard ${cardIndex} · ${step}`
        );
      },
    });

    if (!result.ok) {
      await editOriginal(
        applicationId,
        token,
        [
          `Nothing to generate — Order **#${orderDisplayId}** · card **${cardIndex}**.`,
          `• ${result.cardLabel}: ${result.reason}`,
        ].join("\n")
      );
      return;
    }

    await editOriginal(
      applicationId,
      token,
      [
        `Done · Order **#${orderDisplayId}** · card ${result.cardIndex} · ${result.cardLabel}`,
        `Skipped first **${SKIP_OVERVIEW_PAIRS}** overview pairs · **${result.posted}** of **${result.workCount}** PNG(s) (before ${result.beforeCount}/after ${result.afterCount})`,
        result.skippedLarge.length > 0
          ? `Omitted (too large):\n${result.skippedLarge.join("\n")}`
          : "",
        result.notes.length > 0
          ? `Notes:\n${result.notes.map((line) => `• ${line}`).join("\n")}`
          : "",
        `_PNGs are in the follow-up — click a pair title to download._`,
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
  const cardIndex = parsePositiveInt(optionValue(data.options, "card"));

  if (orderDisplayId == null) {
    return json({
      type: CallbackType.CHANNEL_MESSAGE,
      data: {
        content: "Order must be a positive whole number (e.g. `42`).",
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

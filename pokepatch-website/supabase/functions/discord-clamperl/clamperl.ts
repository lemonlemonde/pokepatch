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
      skippedLarge: string[];
    }
  | {
      ok: false;
      cardIndex: number;
      cardLabel: string;
      reason: string;
    };

/**
 * Download → stitch → post one pair at a time (never parallel ImageScript).
 * Posts each PNG as a follow-up as soon as that pair is ready.
 */
async function generateForCard(params: {
  supabase: SupabaseClient;
  card: CardRow;
  cardIndex: number;
  sizeLimit: number;
  multiCard: boolean;
  applicationId: string;
  token: string;
  onPairProgress: (done: number, total: number) => Promise<void>;
}): Promise<CardGenerateResult> {
  const {
    supabase,
    card,
    cardIndex,
    sizeLimit,
    multiCard,
    applicationId,
    token,
    onPairProgress,
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

  const pairCount = Math.min(beforeRows.length, afterRows.length);
  if (pairCount <= SKIP_OVERVIEW_PAIRS) {
    return {
      ok: false,
      cardIndex,
      cardLabel,
      reason: `only **${pairCount}** pair(s); first **${SKIP_OVERVIEW_PAIRS}** are overview`,
    };
  }

  const workCount = pairCount - SKIP_OVERVIEW_PAIRS;
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

  const skippedLarge: string[] = [];
  let posted = 0;

  for (let offset = 0; offset < workCount; offset += 1) {
    const i = SKIP_OVERVIEW_PAIRS + offset;
    await onPairProgress(offset, workCount);

    const [beforeBytes, afterBytes] = await Promise.all([
      downloadStorageBytes(supabase, beforeRows[i].storage_path),
      downloadStorageBytes(supabase, afterRows[i].storage_path),
    ]);

    const png = await stitchCarouselPairPng(beforeBytes, afterBytes, overlay);
    const pairNum = offset + 1;
    const filename = multiCard
      ? `pokepatch-card${cardIndex}-pair-${pairNum}.png`
      : `pokepatch-pair-${pairNum}.png`;

    if (png.byteLength > sizeLimit) {
      skippedLarge.push(
        `${filename} (${Math.ceil(png.byteLength / (1024 * 1024))}MB > limit)`
      );
      continue;
    }

    const file: DiscordUploadFile = {
      filename,
      bytes: png,
      contentType: "image/png",
    };
    const label =
      workCount === 1
        ? `Card ${cardIndex} · ${cardLabel}`
        : `Card ${cardIndex} · ${cardLabel} · pair ${pairNum}/${workCount}`;
    await followupWithFiles(applicationId, token, { content: label }, [file]);
    posted += 1;
  }

  if (posted === 0) {
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

  return {
    ok: true,
    cardIndex,
    cardLabel,
    posted,
    skippedLarge,
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
          ? `Generating Order **#${orderDisplayId}** · **${targets.length}** cards…\n(PNGs post as each pair finishes)`
          : `Generating Order **#${orderDisplayId}** · card **${targets[0].cardIndex}**…`
      ),
    ]);

    const skippedLarge: string[] = [];
    const skippedCards: string[] = [];
    const okCards: string[] = [];
    let postedFiles = 0;

    // One card at a time; within each card, one pair at a time.
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
        onPairProgress: async (done, total) => {
          await editOriginal(
            applicationId,
            token,
            [
              `Carousel **4:5 PNG** · Order **#${orderDisplayId}**`,
              multiCard
                ? `Card **${target.cardIndex}/${targets.length}** · pair **${done + 1}/${total}** · **${postedFiles}** posted`
                : `Card ${target.cardIndex} · pair **${done + 1}/${total}** · **${postedFiles}** posted`,
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
          `card ${result.cardIndex} · ${result.cardLabel} (**${result.posted}**)`
        );
        skippedLarge.push(...result.skippedLarge);
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
        `Done · Carousel **4:5 PNG** · Order **#${orderDisplayId}** · ${scope}`,
        `Skipped first **${SKIP_OVERVIEW_PAIRS}** overview pairs · **${postedFiles}** post(s)`,
        okCards.length > 0
          ? `Cards:\n${okCards.map((line) => `• ${line}`).join("\n")}`
          : "",
        skippedCards.length > 0
          ? `Skipped cards:\n${skippedCards.map((line) => `• ${line}`).join("\n")}`
          : "",
        skippedLarge.length > 0
          ? `Omitted (too large):\n${skippedLarge.join("\n")}`
          : "",
        `_PNGs are in the follow-up messages._`,
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

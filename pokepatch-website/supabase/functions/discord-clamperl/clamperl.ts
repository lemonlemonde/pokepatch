/**
 * `/clamperl` — generate Instagram carousel (4:5) before/after PNGs for an order card.
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
  editOriginalWithFiles,
  followupWithFiles,
  json,
  type DiscordUploadFile,
  type Interaction,
  type Json,
} from "../_shared/discord.ts";
import { BUCKET } from "../_shared/discordOrderMessages.ts";
import {
  SKIP_OVERVIEW_PAIRS,
  stitchCarouselPairs,
  type CarouselOverlay,
} from "../_shared/instaCarousel.ts";

const SIDE_IMAGE_TYPES: Record<"before" | "after", string[]> = {
  before: ["before", "progress_front", "progress_back"],
  after: ["after", "final_front", "final_back"],
};

/** Discord allows at most 10 files per message. */
const FILES_PER_MESSAGE = 10;

type CardImageRow = {
  id: number;
  storage_path: string;
  image_type: string;
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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function runClamperlJob(params: {
  interaction: Interaction;
  orderDisplayId: number;
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

    type CardRow = {
      id: string;
      card_name: string | null;
      set_name: string | null;
      catalog_card_name?: string | null;
      catalog_set_name?: string | null;
      catalog_image_url?: string | null;
    };

    let cards: CardRow[] | null = null;
    {
      const full = await supabase
        .from("cards")
        .select(
          "id, card_name, set_name, sort_order, catalog_card_name, catalog_set_name, catalog_image_url"
        )
        .eq("order_id", order.id)
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
          .eq("order_id", order.id)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true });
        if (basic.error) throw basic.error;
        cards = (basic.data ?? []) as CardRow[];
      } else if (full.error) {
        throw full.error;
      } else {
        cards = (full.data ?? []) as CardRow[];
      }
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
      await editOriginal(
        applicationId,
        token,
        [
          `Nothing to generate — Order **#${orderDisplayId}** · ${cardLabel} (card ${cardIndex}).`,
          `Before: **${beforeRows.length}**, after: **${afterRows.length}**. Need photos on both sides.`,
        ].join("\n")
      );
      return;
    }

    const pairCount = Math.min(beforeRows.length, afterRows.length);
    if (pairCount <= SKIP_OVERVIEW_PAIRS) {
      await editOriginal(
        applicationId,
        token,
        [
          `Nothing to generate — Order **#${orderDisplayId}** · ${cardLabel} (card ${cardIndex}).`,
          `Found **${pairCount}** index-paired photo(s); the first **${SKIP_OVERVIEW_PAIRS}** are overview and are skipped.`,
        ].join("\n")
      );
      return;
    }

    const pairBytes = await Promise.all(
      Array.from({ length: pairCount - SKIP_OVERVIEW_PAIRS }, async (_, offset) => {
        const i = SKIP_OVERVIEW_PAIRS + offset;
        const [beforeBytes, afterBytes] = await Promise.all([
          downloadStorageBytes(supabase, beforeRows[i].storage_path),
          downloadStorageBytes(supabase, afterRows[i].storage_path),
        ]);
        return { beforeBytes, afterBytes };
      })
    );

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

    const outputs = await stitchCarouselPairs(pairBytes, overlay);

    const files: DiscordUploadFile[] = [];
    const skipped: string[] = [];
    for (const output of outputs) {
      const filename = `pokepatch-${output.key}.png`;
      if (output.png.byteLength > sizeLimit) {
        skipped.push(
          `${filename} (${Math.ceil(output.png.byteLength / (1024 * 1024))}MB > limit)`
        );
        continue;
      }
      files.push({
        filename,
        bytes: output.png,
        contentType: "image/png",
      });
    }

    if (files.length === 0) {
      await editOriginal(
        applicationId,
        token,
        [
          `Generated **${outputs.length}** carousel PNG(s) for Order **#${orderDisplayId}** · ${cardLabel}, but none fit Discord's attachment limit.`,
          skipped.length > 0 ? skipped.join("\n") : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
      return;
    }

    const batches = chunk(files, FILES_PER_MESSAGE);
    const header = [
      `Carousel **4:5 PNG** · Order **#${orderDisplayId}** · ${cardLabel} (card ${cardIndex})`,
      `Skipped first **${SKIP_OVERVIEW_PAIRS}** overview pairs · **${files.length}** post(s)`,
      skipped.length > 0 ? `Omitted (too large):\n${skipped.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const [first, ...rest] = batches;
    await editOriginalWithFiles(
      applicationId,
      token,
      { content: header, flags: EPHEMERAL },
      first
    );

    for (let i = 0; i < rest.length; i += 1) {
      await followupWithFiles(
        applicationId,
        token,
        {
          content: `Carousel batch ${i + 2}/${batches.length}`,
          flags: EPHEMERAL,
        },
        rest[i]
      );
    }
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
          "Card must be a 1-based index within the order (1, 2, 3…).",
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

  return json({
    type: CallbackType.DEFERRED_CHANNEL_MESSAGE,
    data: { flags: EPHEMERAL },
  });
}

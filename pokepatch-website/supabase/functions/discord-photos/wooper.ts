/**
 * "wooper" — upload before/after restoration photos onto an order card.
 *
 * Flow: post images in chat → right-click message → Apps → wooper → modal
 * (order / card / side). Each upload replaces that side's existing photos.
 * Side is optional: blank → `before` when the card has no before photos,
 * otherwise `after`; if both sides are filled the upload is rejected.
 *
 * DB triggers flip card/order status on first before → in_progress and first
 * after → completed (order → ready when all active cards are done). The
 * customer is emailed only when the *order* status changes (not per-card flips).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceClient } from "../_shared/adminSession.ts";
import {
  CallbackType,
  EPHEMERAL,
  collectModalFields,
  editOriginal,
  ephemeralReply,
  fieldValue,
  json,
  labeled,
  textInput,
  type Interaction,
  type Json,
} from "../_shared/discord.ts";
import {
  customerOrderStatusLabel,
  notifyOrderStatusAfterChange,
  snapshotFromOrderRow,
} from "../_shared/orderStatusNotify.ts";
import { BUCKET } from "../_shared/discordOrderMessages.ts";
import {
  OWNER_ORDER_DISPLAY_ID,
  isAllowedOrderDisplayId,
  isOwnerOrderDisplayId,
} from "../_shared/ownerOrder.ts";

const PENDING_PREFIX = "wooper-pending/";
const MAX_IMAGE_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Match admin MAX_ADMIN_PHOTOS_PER_CARD — per side (before or after). */
const MAX_PHOTOS_PER_SIDE = 20;
/** Cap auto-created slots on the owner portfolio so a typo can't flood cards. */
const MAX_OWNER_CARD_INDEX = 100;
const IMMUTABLE_CACHE_CONTROL = "604800";

export const WOOPER_MODAL_PREFIX = "wooper:";

/** Uploading to a side replaces everything in that group, legacy types included. */
const SIDE_IMAGE_TYPES: Record<string, string[]> = {
  before: ["before", "progress_front", "progress_back"],
  after: ["after", "final_front", "final_back"],
};

/** Customer-facing labels — keep in sync with src/lib/orderStatus.js. */
const CARD_STATUS_LABEL: Record<string, string> = {
  todo: "In queue",
  in_progress: "In progress",
  completed: "Completed",
  canceled: "Canceled",
};

type DiscordAttachment = {
  id: string;
  filename: string;
  url: string;
  content_type?: string | null;
  size?: number | null;
};

function normalizeCardStatus(value: unknown): string {
  const status = String(value ?? "").trim().toLowerCase();
  if (status === "cancelled") return "canceled";
  if (
    status === "todo" ||
    status === "in_progress" ||
    status === "completed" ||
    status === "canceled"
  ) {
    return status;
  }
  return "todo";
}

function cardStatusLabel(status: string): string {
  return CARD_STATUS_LABEL[normalizeCardStatus(status)] ?? status;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

/** Storage objects to remove for a photo: the original plus any derived thumb. */
function storagePathsFor(storagePath: string): string[] {
  if (storagePath.endsWith(".thumb.webp")) return [storagePath];
  return [storagePath, `${storagePath}.thumb.webp`];
}

/** Delete every existing photo on this side of the card. Returns how many were removed. */
async function clearSide(
  supabase: SupabaseClient,
  cardId: string,
  side: string
): Promise<number> {
  const { data: existing, error: selectError } = await supabase
    .from("card_images")
    .select("id, storage_path")
    .eq("card_id", cardId)
    .in("image_type", SIDE_IMAGE_TYPES[side]);
  if (selectError) throw selectError;
  if (!existing || existing.length === 0) return 0;

  const { error: deleteError } = await supabase
    .from("card_images")
    .delete()
    .in(
      "id",
      existing.map((row) => row.id)
    );
  if (deleteError) throw deleteError;

  const paths = existing.flatMap((row) =>
    storagePathsFor(String(row.storage_path))
  );
  const { error: removeError } = await supabase.storage
    .from(BUCKET)
    .remove(paths);
  if (removeError) {
    // Rows are gone; orphaned objects are harmless. Log so they can be swept.
    console.error("wooper storage remove failed", removeError, paths);
  }
  return existing.length;
}

/**
 * Blank side → pick one from what the card already has:
 *   no before photos → `before`; before filled, after empty → `after`;
 *   both filled → null (caller rejects so nothing is silently replaced).
 */
async function defaultSideForCard(
  supabase: SupabaseClient,
  cardId: string
): Promise<{ side: string | null; beforeCount: number; afterCount: number }> {
  const { data, error } = await supabase
    .from("card_images")
    .select("image_type")
    .eq("card_id", cardId)
    .in("image_type", [...SIDE_IMAGE_TYPES.before, ...SIDE_IMAGE_TYPES.after]);
  if (error) throw error;

  let beforeCount = 0;
  let afterCount = 0;
  for (const row of data ?? []) {
    if (SIDE_IMAGE_TYPES.before.includes(String(row.image_type))) {
      beforeCount += 1;
    } else {
      afterCount += 1;
    }
  }

  if (beforeCount === 0) return { side: "before", beforeCount, afterCount };
  if (afterCount === 0) return { side: "after", beforeCount, afterCount };
  return { side: null, beforeCount, afterCount };
}

function imageAttachmentsFromMessage(
  message: Json | undefined
): DiscordAttachment[] {
  const raw = (message?.attachments ?? []) as DiscordAttachment[];
  return raw.filter((attachment) => {
    const type = String(attachment.content_type ?? "").toLowerCase();
    if (type) return type.startsWith("image/");
    return /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(attachment.filename ?? "");
  });
}

function wooperModal(pendingId: string, imageCount: number): Json {
  return {
    type: CallbackType.MODAL,
    data: {
      custom_id: `${WOOPER_MODAL_PREFIX}${pendingId}`,
      title: `Upload ${imageCount} photo(s)`,
      components: [
        labeled(
          "Order number",
          textInput({
            customId: "order",
            required: true,
            placeholder: "e.g. 42 or -1 (my cards)",
            maxLength: 10,
          })
        ),
        labeled(
          "Card number in order",
          textInput({
            customId: "card",
            required: true,
            placeholder: "1 = first card",
            maxLength: 4,
          }),
          "1 = first card in the order"
        ),
        labeled(
          "Side (optional)",
          textInput({
            customId: "side",
            required: false,
            placeholder: "before or after",
            maxLength: 6,
          }),
          "Blank = before, or after once before is filled"
        ),
      ],
    },
  };
}

async function savePendingAttachments(
  files: DiscordAttachment[]
): Promise<string> {
  const pendingId = crypto.randomUUID();
  const supabase = getServiceClient();
  const path = `${PENDING_PREFIX}${pendingId}.json`;
  const payload = JSON.stringify({
    attachments: files.map((file) => ({
      id: file.id,
      filename: file.filename,
      url: file.url,
      content_type: file.content_type ?? null,
      size: file.size ?? null,
    })),
  });
  const { error } = await supabase.storage.from(BUCKET).upload(
    path,
    new TextEncoder().encode(payload),
    {
      upsert: false,
      contentType: "application/json",
      cacheControl: "60",
    }
  );
  if (error) throw error;
  return pendingId;
}

async function loadPendingAttachments(
  pendingId: string
): Promise<DiscordAttachment[]> {
  const supabase = getServiceClient();
  const path = `${PENDING_PREFIX}${pendingId}.json`;
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new Error("Upload session expired. Right-click the photos again.");
  }
  const text = await data.text();
  const parsed = JSON.parse(text) as { attachments?: DiscordAttachment[] };
  return parsed.attachments ?? [];
}

async function clearPending(pendingId: string): Promise<void> {
  const supabase = getServiceClient();
  await supabase.storage
    .from(BUCKET)
    .remove([`${PENDING_PREFIX}${pendingId}.json`])
    .catch(() => {});
}

async function uploadAttachments(params: {
  applicationId: string;
  token: string;
  orderDisplayId: number;
  cardIndex: number;
  /** `before` / `after`, or "" to pick from the card's existing photos. */
  side: string;
  files: DiscordAttachment[];
}): Promise<void> {
  const {
    applicationId,
    token,
    orderDisplayId,
    cardIndex,
    side: requestedSide,
    files,
  } = params;

  try {
    if (!isAllowedOrderDisplayId(orderDisplayId)) {
      await editOriginal(applicationId, token, "Invalid order number.");
      return;
    }
    if (
      !Number.isFinite(cardIndex) ||
      cardIndex < 1 ||
      !Number.isInteger(cardIndex)
    ) {
      await editOriginal(
        applicationId,
        token,
        "Card must be a 1-based index within the order (1, 2, 3…)."
      );
      return;
    }
    if (requestedSide && !(requestedSide in SIDE_IMAGE_TYPES)) {
      await editOriginal(
        applicationId,
        token,
        "Side must be `before`, `after`, or left blank."
      );
      return;
    }
    if (files.length === 0) {
      await editOriginal(applicationId, token, "No images found on that message.");
      return;
    }

    const supabase = getServiceClient();
    const ownerPortfolio = isOwnerOrderDisplayId(orderDisplayId);

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        "id, display_id, status, pending_kind, delivery_method, customer_email, user_id"
      )
      .eq("display_id", orderDisplayId)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) {
      await editOriginal(
        applicationId,
        token,
        ownerPortfolio
          ? `My cards order (#${OWNER_ORDER_DISPLAY_ID}) is missing. Run migrations.`
          : `Order #${orderDisplayId} not found.`
      );
      return;
    }

    const fromOrder = snapshotFromOrderRow(order);
    const fromOrderLabel = customerOrderStatusLabel(
      order.status,
      order.pending_kind,
      order.delivery_method,
    );

    let { data: cards, error: cardsError } = await supabase
      .from("cards")
      .select("id, card_name, sort_order, status")
      .eq("order_id", order.id)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (cardsError) throw cardsError;

    const orderLabel = ownerPortfolio
      ? `My cards (**#${OWNER_ORDER_DISPLAY_ID}**)`
      : `Order **#${orderDisplayId}**`;

    // Owner portfolio: create missing card slots through N so Discord-only
    // uploads never need a pre-created customer order.
    if (ownerPortfolio && cardIndex > (cards?.length ?? 0)) {
      if (cardIndex > MAX_OWNER_CARD_INDEX) {
        await editOriginal(
          applicationId,
          token,
          `Card number too high for my cards (max ${MAX_OWNER_CARD_INDEX}).`
        );
        return;
      }
      const existingCount = cards?.length ?? 0;
      const toInsert = [];
      for (let n = existingCount + 1; n <= cardIndex; n += 1) {
        toInsert.push({
          id: crypto.randomUUID(),
          order_id: order.id,
          card_name: `My card ${n}`,
          sort_order: n - 1,
          damage_tags: [],
          status: "todo",
        });
      }
      const { error: insertCardsError } = await supabase
        .from("cards")
        .insert(toInsert);
      if (insertCardsError) throw insertCardsError;

      const reloaded = await supabase
        .from("cards")
        .select("id, card_name, sort_order, status")
        .eq("order_id", order.id)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });
      if (reloaded.error) throw reloaded.error;
      cards = reloaded.data;
    }

    const card = (cards ?? [])[cardIndex - 1];
    if (!card) {
      await editOriginal(
        applicationId,
        token,
        `${orderLabel} has ${cards?.length ?? 0} card(s); card ${cardIndex} is out of range.`
      );
      return;
    }

    const cardLabel = (card.card_name || `Card ${cardIndex}`).trim();
    const cardId = String(card.id);
    const fromCardStatus = normalizeCardStatus(card.status);

    let side = requestedSide;
    let sideWasDefaulted = false;
    if (!side) {
      const picked = await defaultSideForCard(supabase, cardId);
      if (!picked.side) {
        await editOriginal(
          applicationId,
          token,
          [
            `Nothing uploaded — ${orderLabel} · ${cardLabel} (card ${cardIndex}) already has **${picked.beforeCount}** before and **${picked.afterCount}** after photo(s).`,
            "Re-run wooper and type `before` or `after` to replace that side.",
          ].join("\n")
        );
        return;
      }
      side = picked.side;
      sideWasDefaulted = true;
    }

    // Old photos are cleared lazily, once the first new one has downloaded,
    // so a dead CDN link can't leave the side empty.
    let replaced: number | null = null;
    let nextIndex = 1;
    let uploaded = 0;
    const errors: string[] = [];
    const toUpload = files.slice(0, MAX_PHOTOS_PER_SIDE);
    if (files.length > toUpload.length) {
      errors.push(
        `max ${MAX_PHOTOS_PER_SIDE} ${side} photos; skipped ${files.length - toUpload.length}`
      );
    }

    for (const attachment of toUpload) {
      const filename = attachment.filename || `photo-${nextIndex}.jpg`;
      try {
        const declaredType = String(attachment.content_type ?? "");
        if (declaredType && !declaredType.startsWith("image/")) {
          errors.push(`${filename}: not an image`);
          continue;
        }
        if (
          typeof attachment.size === "number" &&
          attachment.size > MAX_IMAGE_UPLOAD_BYTES
        ) {
          errors.push(`${filename}: too large (max 15MB)`);
          continue;
        }

        const download = await fetch(attachment.url);
        if (!download.ok) {
          errors.push(`${filename}: download failed (${download.status})`);
          continue;
        }
        const bytes = new Uint8Array(await download.arrayBuffer());
        if (bytes.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
          errors.push(`${filename}: too large (max 15MB)`);
          continue;
        }

        if (replaced === null) {
          replaced = await clearSide(supabase, cardId, side);
        }

        const path =
          `order-${order.id}/card-${card.id}/${side}-${nextIndex}-${sanitizeFilename(filename)}`;
        const contentType =
          declaredType ||
          download.headers.get("content-type") ||
          "application/octet-stream";

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, bytes, {
            // Side was just cleared; overwrite in case an old object lingered.
            upsert: true,
            contentType,
            cacheControl: IMMUTABLE_CACHE_CONTROL,
          });
        if (uploadError) throw uploadError;

        const { error: insertError } = await supabase.from("card_images").insert({
          card_id: card.id,
          image_type: side,
          storage_path: path,
        });
        if (insertError) {
          await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
          throw insertError;
        }

        uploaded += 1;
        nextIndex += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${filename}: ${message}`);
      }
    }

    const lines = [
      uploaded > 0
        ? `Uploaded **${uploaded}** ${side} photo(s) → ${orderLabel} · ${cardLabel} (card ${cardIndex}).`
        : `No photos uploaded for ${orderLabel} · ${cardLabel}.`,
    ];

    // DB triggers flip card/order status on before → in_progress (only when
    // the card has no after photos yet) and after → completed (order → ready
    // when every active card is done). Replacing photos on a card that already
    // has afters is an edit only. Customer email only when the *order* status
    // changes — not for mid-job per-card flips.
    if (uploaded > 0) {
      const [{ data: cardAfter }, { data: orderAfter }] = await Promise.all([
        supabase.from("cards").select("status").eq("id", cardId).maybeSingle(),
        supabase
          .from("orders")
          .select(
            "id, display_id, status, pending_kind, delivery_method, customer_email, user_id"
          )
          .eq("id", String(order.id))
          .maybeSingle(),
      ]);
      const toCardStatus = normalizeCardStatus(cardAfter?.status);
      const toOrderLabel = customerOrderStatusLabel(
        orderAfter?.status ?? order.status,
        orderAfter?.pending_kind ?? order.pending_kind,
        orderAfter?.delivery_method ?? order.delivery_method,
      );

      if (fromCardStatus !== toCardStatus) {
        lines.push(
          `Card **${cardStatusLabel(fromCardStatus)}** → **${cardStatusLabel(toCardStatus)}**.`
        );
      }
      if (fromOrderLabel !== toOrderLabel) {
        lines.push(
          `Order **${fromOrderLabel}** → **${toOrderLabel}**.`
        );
      }

      if (fromOrderLabel !== toOrderLabel && !ownerPortfolio) {
        const notifyResult = await notifyOrderStatusAfterChange(
          supabase,
          String(order.id),
          fromOrder,
        );
        if (notifyResult.error) {
          lines.push(`Customer notify failed: ${notifyResult.error}`);
        } else if (
          notifyResult.sent ||
          notifyResult.skipped === "already_notified"
        ) {
          lines.push("Customer notified.");
        } else if (notifyResult.skipped === "no_email") {
          lines.push("Customer not notified (no email on order).");
        }
      }
    }

    if (sideWasDefaulted) {
      lines.push(`Side left blank → defaulted to **${side}**.`);
    }
    if (replaced) {
      lines.push(`Replaced ${replaced} previous ${side} photo(s).`);
    }
    if (errors.length > 0) {
      lines.push(`Issues: ${errors.join("; ")}`);
    }
    await editOriginal(applicationId, token, lines.join("\n"));
  } catch (err) {
    console.error("wooper failed", err);
    const message = err instanceof Error ? err.message : String(err);
    await editOriginal(applicationId, token, `Upload failed: ${message}`);
  }
}

/** Message command (right-click message → Apps → wooper) or legacy slash. */
export async function handleWooperCommand(interaction: Interaction): Promise<Response> {
  const data = (interaction.data ?? {}) as Json;
  const commandType = Number(data.type ?? 1);

  if (commandType !== 3) {
    return ephemeralReply(
      "Post your photos in chat, then **right-click the message → Apps → wooper** and enter order / card / side."
    );
  }

  const targetId = String(data.target_id ?? "");
  const resolved = (data.resolved ?? {}) as Json;
  const messages = (resolved.messages ?? {}) as Record<string, Json>;
  const message = messages[targetId];
  const files = imageAttachmentsFromMessage(message);

  if (files.length === 0) {
    return ephemeralReply(
      "That message has no images. Attach photos in chat first, then right-click → Apps → wooper."
    );
  }

  try {
    const pendingId = await savePendingAttachments(files);
    return json(wooperModal(pendingId, files.length));
  } catch (err) {
    console.error("wooper pending save failed", err);
    return ephemeralReply("Couldn't start upload. Try again.");
  }
}

async function processWooperModal(interaction: Interaction): Promise<void> {
  const applicationId = String(interaction.application_id ?? "");
  const token = String(interaction.token ?? "");
  const data = (interaction.data ?? {}) as Json;
  const customId = String(data.custom_id ?? "");
  const pendingId = customId.startsWith(WOOPER_MODAL_PREFIX)
    ? customId.slice(WOOPER_MODAL_PREFIX.length)
    : "";

  try {
    if (!pendingId) {
      await editOriginal(applicationId, token, "Invalid upload session.");
      return;
    }

    const fields = collectModalFields(data.components);
    const orderDisplayId = Number(fieldValue(fields, "order"));
    const cardIndex = Number(fieldValue(fields, "card"));
    const side = fieldValue(fields, "side").toLowerCase();

    const files = await loadPendingAttachments(pendingId);
    await clearPending(pendingId);

    await uploadAttachments({
      applicationId,
      token,
      orderDisplayId,
      cardIndex,
      side,
      files,
    });
  } catch (err) {
    console.error("wooper modal failed", err);
    const message = err instanceof Error ? err.message : String(err);
    await editOriginal(applicationId, token, `Upload failed: ${message}`);
  }
}

/** Modal submit: ACK now, upload in the background. */
export function handleWooperModal(
  interaction: Interaction,
  waitUntil: (promise: Promise<unknown>) => void
): Response {
  waitUntil(
    processWooperModal(interaction).catch((err) => {
      console.error("wooper modal background failed", err);
    })
  );
  return json({
    type: CallbackType.DEFERRED_CHANNEL_MESSAGE,
    data: { flags: EPHEMERAL },
  });
}

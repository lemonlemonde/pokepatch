/**
 * Load an order card's before/after photos into Studio banks.
 */

import { adminGetOrder } from "@/lib/adminApi";
import { fetchTcgCardImageFile } from "@/lib/tcgCardImage";

const FETCH_TIMEOUT_MS = 45_000;
const FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 700;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function filenameFromUrl(url, fallback) {
  try {
    const path = new URL(url, "https://example.invalid").pathname;
    const base = path.split("/").pop();
    if (base) return decodeURIComponent(base);
  } catch {
    // fall through
  }
  return fallback;
}

async function fetchBlobOnce(url, fallbackName) {
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    : null;

  try {
    const response = await fetch(url, {
      signal: controller?.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Couldn't download ${fallbackName}.`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) {
      throw new Error(`${fallbackName} is not an image.`);
    }
    return blob;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Timed out downloading ${fallbackName}.`);
    }
    throw err instanceof Error
      ? err
      : new Error(`Couldn't download ${fallbackName}.`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fileFromUrl(url, fallbackName) {
  if (!url) return null;

  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const blob = await fetchBlobOnce(url, fallbackName);
      const name = filenameFromUrl(url, fallbackName);
      return new File([blob], name, {
        type: blob.type || "image/webp",
        lastModified: Date.now(),
      });
    } catch (err) {
      lastError = err;
      const message = (err instanceof Error ? err.message : "").toLowerCase();
      if (message.includes("not an image")) break;
      if (attempt < FETCH_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Couldn't download ${fallbackName}.`);
}

function studioItemFromFile(file) {
  return {
    id: crypto.randomUUID(),
    file,
    crop: null,
    annotations: null,
  };
}

function imageUrl(image) {
  return image?.signed_url || image?.signed_thumb_url || null;
}

function sortImages(images) {
  return [...images].sort((a, b) => {
    const aId = Number(a?.id) || 0;
    const bId = Number(b?.id) || 0;
    return aId - bId;
  });
}

/**
 * Fetch an order card and build Studio before/after banks + card meta.
 * @param {{ orderId: string, cardId: string }} params
 */
export async function buildStudioSeedFromOrderCard({ orderId, cardId }) {
  const oid = String(orderId ?? "").trim();
  const cid = String(cardId ?? "").trim();
  if (!oid || !cid) {
    throw new Error("Missing order or card id.");
  }

  const order = await adminGetOrder(oid);
  if (!order) {
    throw new Error("Order not found.");
  }

  const card = (order.cards ?? []).find(
    (entry) => String(entry.id) === cid
  );
  if (!card) {
    throw new Error("Order card not found.");
  }

  const images = Array.isArray(card.images) ? card.images : [];
  const beforeImages = sortImages(
    images.filter((image) => image?.image_type === "before")
  );
  const afterImages = sortImages(
    images.filter((image) => image?.image_type === "after")
  );

  if (beforeImages.length === 0 || afterImages.length === 0) {
    throw new Error(
      "This card needs at least one before and one after photo before opening in Studio.",
    );
  }

  const beforeItems = [];
  const afterItems = [];
  const pairs = [];
  const failures = [];

  const pairCount = Math.min(beforeImages.length, afterImages.length);
  for (let index = 0; index < pairCount; index += 1) {
    const beforeUrl = imageUrl(beforeImages[index]);
    const afterUrl = imageUrl(afterImages[index]);
    const label = `pair-${index + 1}`;
    if (!beforeUrl || !afterUrl) {
      failures.push(label);
      continue;
    }
    try {
      const [beforeFile, afterFile] = await Promise.all([
        fileFromUrl(beforeUrl, `${label}-before.webp`),
        fileFromUrl(afterUrl, `${label}-after.webp`),
      ]);
      if (!beforeFile || !afterFile) {
        failures.push(label);
        continue;
      }
      const beforeItem = studioItemFromFile(beforeFile);
      const afterItem = studioItemFromFile(afterFile);
      beforeItems.push(beforeItem);
      afterItems.push(afterItem);
      pairs.push({
        id: crypto.randomUUID(),
        before: beforeItem.id,
        after: afterItem.id,
      });
    } catch (err) {
      failures.push(
        err instanceof Error ? `${label} (${err.message})` : label,
      );
    }
  }

  for (let index = pairCount; index < beforeImages.length; index += 1) {
    const url = imageUrl(beforeImages[index]);
    if (!url) continue;
    try {
      const file = await fileFromUrl(url, `before-extra-${index + 1}.webp`);
      if (file) beforeItems.push(studioItemFromFile(file));
    } catch (err) {
      failures.push(
        err instanceof Error
          ? `before-extra-${index + 1} (${err.message})`
          : `before-extra-${index + 1}`,
      );
    }
  }
  for (let index = pairCount; index < afterImages.length; index += 1) {
    const url = imageUrl(afterImages[index]);
    if (!url) continue;
    try {
      const file = await fileFromUrl(url, `after-extra-${index + 1}.webp`);
      if (file) afterItems.push(studioItemFromFile(file));
    } catch (err) {
      failures.push(
        err instanceof Error
          ? `after-extra-${index + 1} (${err.message})`
          : `after-extra-${index + 1}`,
      );
    }
  }

  if (pairs.length === 0) {
    throw new Error(
      failures.length > 0
        ? `Could not load card photos: ${failures.join("; ")}`
        : "Could not load before/after photos for Studio.",
    );
  }

  const title =
    (card.catalog_card_name || card.card_name || "").trim() || "Card";
  const setName = (card.catalog_set_name || card.set_name || "").trim();

  let frontFile = null;
  if (card.catalog_image_url) {
    try {
      frontFile = await fileFromUrl(
        card.catalog_image_url,
        `${title}-thumb.webp`,
      );
    } catch {
      frontFile = null;
    }
  }
  if (!frontFile && card.tcg_card_id) {
    try {
      frontFile = await fetchTcgCardImageFile({
        id: card.tcg_card_id,
        name: title,
      });
    } catch {
      frontFile = null;
    }
  }

  return {
    beforeItems,
    afterItems,
    pairs,
    cardMeta: {
      card: title,
      set: setName,
      frontFile,
      tcg_card_id: (card.tcg_card_id ?? "").trim(),
      card_number: "",
      tcg_lookup_title: title,
      tcg_lookup_set_name: setName,
    },
  };
}

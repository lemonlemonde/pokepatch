"use client";

import Link from "next/link";
import { CONTACT_TYPES } from "@/lib/contacts";
import { normalizeDamageTags } from "@/lib/damageTags";

/** Copy a FileList (or array-like) into a plain File[]. */
export function copyFileList(fileList) {
  if (!fileList) return [];
  const copied = [];
  for (let i = 0; i < fileList.length; i += 1) {
    copied.push(fileList[i]);
  }
  return copied;
}

export function emptyContactValues() {
  return CONTACT_TYPES.reduce(
    (acc, type) => ({ ...acc, [type.value]: "" }),
    {}
  );
}

export function hasAdditionalContact(contactValues) {
  return CONTACT_TYPES.some(
    (type) => (contactValues[type.value] ?? "").trim() !== ""
  );
}

/**
 * Note under account-locked fields — shared by quote + order edit forms.
 */
export function AccountFieldNote({ children }) {
  return (
    <p className="mt-1 text-xs text-ink/60">
      {children}{" "}
      <Link href="/account" className="font-semibold text-ink hover:underline">
        Manage account
      </Link>
    </p>
  );
}

/**
 * Human-readable "Card N needs …" lines for per-card field errors, so the
 * validation banner names what's missing instead of reading like "no cards".
 * `cardErrorsById` is `{ [cardId]: { cardName, damageTags, files } }`.
 */
export function describeCardFieldErrors(cardErrorsById, cards) {
  if (!cardErrorsById) return [];
  const lines = [];
  cards.forEach((card, index) => {
    const errors = cardErrorsById[card.id];
    if (!errors) return;
    const missing = [];
    if (errors.cardName) missing.push("a card name");
    if (errors.damageTags) missing.push("a damage type");
    if (errors.files) missing.push("a photo");
    if (missing.length === 0) return;
    const list =
      missing.length === 1
        ? missing[0]
        : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
    lines.push(`Card ${index + 1} needs ${list}.`);
  });
  return lines;
}

/**
 * Full validation banner lines for quote / order-edit forms.
 * `errors.email` may be true (legacy), "required", or "invalid".
 */
export function describeQuoteValidationErrors(errors, cards) {
  if (!errors) return [];
  const lines = [];

  if (errors.firstName) lines.push("Enter your first name.");
  if (errors.lastName) lines.push("Enter your last name.");
  if (errors.email === "invalid") {
    lines.push("Enter a valid email address (like you@example.com).");
  } else if (errors.email) {
    lines.push("Enter your email address.");
  }
  if (errors.deliveryMethod) {
    lines.push("Choose a delivery method (local drop-off or shipping).");
  }
  if (errors.contacts) {
    lines.push(
      "Enter at least one other contact method (phone, Discord, or Instagram)."
    );
  }
  if (errors.noCards) {
    lines.push("Add at least one card.");
  }
  lines.push(...describeCardFieldErrors(errors.cards, cards));
  return lines;
}

/** Short inline copy under a single marked-invalid field. */
export function inlineFieldErrorMessage(key, detail) {
  switch (key) {
    case "firstName":
      return "Enter your first name.";
    case "lastName":
      return "Enter your last name.";
    case "email":
      return detail === "invalid"
        ? "Enter a valid email address (like you@example.com)."
        : "Enter your email address.";
    case "deliveryMethod":
      return "Choose local drop-off or shipping.";
    case "contacts":
      return "Enter at least one: phone, Discord, or Instagram.";
    case "cardName":
      return "Enter a card name.";
    case "damageTags":
      return "Select at least one damage type.";
    case "files":
      return "Add at least one photo.";
    case "noCards":
      return "Add at least one card to continue.";
    default:
      return null;
  }
}

/**
 * Turn upload / RPC failures into a clear customer-facing sentence.
 * Raw Postgres / storage messages are mapped when we recognize them.
 */
export function friendlySubmitError(err, phase = "submit") {
  const raw = String(err?.message ?? err?.error_description ?? "").trim();
  const lower = raw.toLowerCase();

  if (phase === "upload" || /storage|upload|bucket|object/i.test(lower)) {
    if (/heic|heif/i.test(lower)) {
      return "One of your photos is in HEIC format and couldn't be processed. Export it as JPEG or PNG and try again.";
    }
    if (/process this image|couldn't process|timed out/i.test(lower)) {
      return raw.length <= 160
        ? raw
        : "Couldn't process one of your photos. Try JPEG or PNG and submit again.";
    }
    return "Couldn't upload your photos. Check your connection and try again.";
  }

  if (/at least one card is required/i.test(lower)) {
    return "Add at least one complete card (name, damage type, and photo) before submitting.";
  }
  if (/damage_tag/i.test(lower)) {
    return "Each card needs at least one damage type selected.";
  }
  if (/card_name is required/i.test(lower)) {
    return "Each card needs a name.";
  }
  if (/additional contact|contact value|contact_type/i.test(lower)) {
    return "Enter at least one other contact method (phone, Discord, or Instagram).";
  }
  if (/delivery_method/i.test(lower)) {
    return "Choose a delivery method (local drop-off or shipping).";
  }
  if (/email/i.test(lower) && /required|invalid|format/i.test(lower)) {
    return "Check that your email address is valid and try again.";
  }
  if (/network|fetch|failed to fetch|timeout|timed out/i.test(lower)) {
    return "Network error — check your connection and try again.";
  }
  if (/preparing your cards/i.test(lower)) {
    return raw;
  }

  // Prefer a short known message over dumping raw SQL / PostgREST noise.
  if (raw && raw.length <= 160 && !/^[A-Z_]{3,}$/.test(raw) && !/^\{/.test(raw)) {
    return raw;
  }
  return "Something went wrong submitting your request. Please try again in a moment.";
}

/** Accept real images, including empty MIME (common on some mobile pickers). */
export function isLikelyImageFile(file) {
  if (!file) return false;
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  if (type && type !== "application/octet-stream") return false;
  // Empty or octet-stream: trust image-like names; also allow extension-less
  // picks (some mobile cameras omit both MIME and extension).
  const name = file.name || "";
  if (!name || !/\.[a-z0-9]+$/i.test(name)) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/i.test(name);
}

/** New-quote card: complete when name, damage tags, and staged files exist. */
export function isQuoteCardComplete(card) {
  return (
    card.cardName.trim() !== "" &&
    normalizeDamageTags(card.damageTags).length > 0 &&
    card.files.length > 0
  );
}

export function isQuoteCardEmpty(card) {
  return (
    card.cardName.trim() === "" &&
    card.setName.trim() === "" &&
    normalizeDamageTags(card.damageTags).length === 0 &&
    card.description.trim() === "" &&
    card.files.length === 0
  );
}

/**
 * Order-edit card: photos may already be saved (`existingImages`) or staged
 * as `newFiles`.
 */
export function isOrderEditCardComplete(card) {
  return (
    card.cardName.trim() !== "" &&
    normalizeDamageTags(card.damageTags).length > 0 &&
    card.existingImages.length + card.newFiles.length > 0
  );
}

export function isOrderEditCardEmpty(card) {
  return (
    card.cardName.trim() === "" &&
    card.setName.trim() === "" &&
    normalizeDamageTags(card.damageTags).length === 0 &&
    card.description.trim() === "" &&
    card.existingImages.length === 0 &&
    card.newFiles.length === 0
  );
}

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

/**
 * Bundle a card's before/after photos into a zip:
 *
 *   <folder>/before/01-<filename>
 *   <folder>/after/01-<filename>
 *
 * Used by both My Orders (customer) and the admin order editor.
 */

import JSZip from "jszip";
import { signPaths } from "@/lib/customerOrderMedia";
import { photoFilename } from "@/lib/cardPhotoGroups";

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** `order-42-card-1-charizard` — stable, filesystem-safe folder name. */
export function restorationFolderName({ orderDisplayId, cardIndex, cardName }) {
  const parts = [`order-${orderDisplayId}`, `card-${cardIndex}`];
  const name = slug(cardName);
  if (name) parts.push(name);
  return parts.join("-");
}

async function resolveUrls(images) {
  const missing = images
    .filter((image) => !image.signed_url)
    .map((image) => image.storage_path);
  const signed = missing.length > 0 ? await signPaths(missing) : {};
  return images.map((image) => image.signed_url || signed[image.storage_path]);
}

async function addSide(zip, side, images, urls) {
  const folder = zip.folder(side);
  const width = String(images.length).length;
  const failures = [];
  await Promise.all(
    images.map(async (image, index) => {
      const name = `${String(index + 1).padStart(Math.max(2, width), "0")}-${photoFilename(image.storage_path)}`;
      const url = urls[index];
      if (!url) {
        failures.push(name);
        return;
      }
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        folder.file(name, await res.blob());
      } catch {
        failures.push(name);
      }
    })
  );
  return failures;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Download `<folderName>.zip` with `before/` and `after/` subfolders.
 * Resolves to the list of files that could not be fetched (empty on full success).
 */
export async function downloadRestorationZip({ folderName, before, after }) {
  if (before.length === 0 && after.length === 0) {
    throw new Error("No before or after photos yet.");
  }

  const [beforeUrls, afterUrls] = await Promise.all([
    resolveUrls(before),
    resolveUrls(after),
  ]);

  const zip = new JSZip();
  const root = zip.folder(folderName);
  const failures = [
    ...(await addSide(root, "before", before, beforeUrls)),
    ...(await addSide(root, "after", after, afterUrls)),
  ];

  if (failures.length === before.length + after.length) {
    throw new Error("Couldn't download any photos. Try again.");
  }

  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, `${folderName}.zip`);
  return failures;
}

/**
 * Save a card's before/after photos as a folder:
 *
 *   <folder>/before/01-<filename>
 *   <folder>/after/01-<filename>
 *
 * Preferred path writes straight into a user-chosen directory via the File
 * System Access API (Chromium desktop). Everywhere else falls back to a zip
 * with the same layout. Used by My Orders and the admin order editor.
 */

import JSZip from "jszip";
import { signPaths } from "@/lib/customerOrderMedia";
import { photoFilename } from "@/lib/cardPhotoGroups";

const SIDES = ["before", "after"];
/** Give the browser time to start the download before the blob URL is released. */
const REVOKE_OBJECT_URL_DELAY_MS = 1000;

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

/** True when the browser can write into a user-picked directory. */
export function supportsFolderSave() {
  return (
    typeof window !== "undefined" &&
    typeof window.showDirectoryPicker === "function" &&
    window.isSecureContext
  );
}

async function resolveUrls(images) {
  const missing = images
    .filter((image) => !image.signed_url)
    .map((image) => image.storage_path);
  const signed = missing.length > 0 ? await signPaths(missing) : {};
  return images.map((image) => image.signed_url || signed[image.storage_path]);
}

function entryName(image, index, total) {
  const width = Math.max(2, String(total).length);
  return `${String(index + 1).padStart(width, "0")}-${photoFilename(image.storage_path)}`;
}

async function fetchBlob(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

/**
 * Fetch one side's photos, preserving upload order.
 * Resolves to `{ files: [{ name, blob }], failures: [name] }`; a failed fetch
 * never rejects, it just lands in `failures`.
 */
async function fetchSide(images) {
  const urls = await resolveUrls(images);
  const blobs = await Promise.all(urls.map(fetchBlob));
  const files = [];
  const failures = [];
  images.forEach((image, index) => {
    const name = entryName(image, index, images.length);
    if (blobs[index]) files.push({ name, blob: blobs[index] });
    else failures.push(name);
  });
  return { files, failures };
}

async function fetchAllSides({ before, after }) {
  const total = before.length + after.length;
  if (total === 0) throw new Error("No before or after photos yet.");

  const [beforeResult, afterResult] = await Promise.all([
    fetchSide(before),
    fetchSide(after),
  ]);
  const failures = [...beforeResult.failures, ...afterResult.failures];
  if (failures.length === total) {
    throw new Error("Couldn't download any photos. Try again.");
  }
  return {
    sides: { before: beforeResult.files, after: afterResult.files },
    failures,
  };
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_OBJECT_URL_DELAY_MS);
}

/**
 * Download `<folderName>.zip` with `before/` and `after/` subfolders.
 * Resolves to `{ failures }` — names that could not be fetched.
 */
export async function downloadRestorationZip({ folderName, before, after }) {
  const { sides, failures } = await fetchAllSides({ before, after });

  const zip = new JSZip();
  const root = zip.folder(folderName);
  for (const side of SIDES) {
    const dir = root.folder(side);
    for (const { name, blob } of sides[side]) dir.file(name, blob);
  }

  triggerDownload(await zip.generateAsync({ type: "blob" }), `${folderName}.zip`);
  return { failures };
}

async function writeFile(dirHandle, name, blob) {
  const handle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/**
 * Ask for a destination directory and write `<folderName>/before|after/...` into it.
 * Resolves to `{ cancelled: true }` if the user dismisses the picker,
 * `{ unavailable: true }` if the picker itself refuses to open (caller should
 * fall back to the zip), otherwise `{ failures, location }` where `location`
 * is "<picked dir>/<folderName>".
 */
export async function saveRestorationToFolder({ folderName, before, after }) {
  let picked;
  try {
    picked = await window.showDirectoryPicker({
      id: "pokepatch-restoration",
      mode: "readwrite",
      startIn: "downloads",
    });
  } catch (err) {
    if (err?.name === "AbortError") return { cancelled: true };
    console.warn("directory picker unavailable, falling back to zip", err);
    return { unavailable: true };
  }

  const { sides, failures } = await fetchAllSides({ before, after });

  const root = await picked.getDirectoryHandle(folderName, { create: true });
  for (const side of SIDES) {
    if (sides[side].length === 0) continue;
    const dir = await root.getDirectoryHandle(side, { create: true });
    await Promise.all(
      sides[side].map(({ name, blob }) => writeFile(dir, name, blob))
    );
  }

  return { failures, location: `${picked.name}/${folderName}` };
}

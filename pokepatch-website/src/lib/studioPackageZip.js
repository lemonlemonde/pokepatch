import JSZip from "jszip";
import { renderStudioSlotBlob } from "@/lib/studioSlotImage";
import { downloadBlob } from "@/lib/downloadFile";

export const DEFAULT_PACKAGE_CAPTION = `Restoration Performed
• Edge lifting
• Water damage
• Dents
• Creases
• Scratch removal
• Surface cleaning

Restore your collection with PokePatch.cards

🔗 link in bio`;

function extForBlob(blob, fallback = "jpg") {
  if (blob.type === "image/png") return "png";
  if (blob.type === "image/webp") return "webp";
  if (blob.type === "image/jpeg") return "jpg";
  return fallback;
}

function slugify(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Builds and downloads a zip containing:
 * - gallery/: every slot image (crop + annotations baked in), deduped by item id
 * - insta/: every generated pair output, one alt-text .txt per pair, and one caption.txt
 *
 * @param outputs [{ key, label, url, filename }] — generated pair images
 * @param outputSources [[{ item, previewUrl, label }]] — parallel to outputs, slot inputs per pair
 * @param exporters Map<key, () => Promise<{blob, filename}>> — optional annotated-output exporters
 * @param altTextByKey { [outputKey]: string }
 * @param caption string
 */
export async function downloadStudioPackageZip({
  outputs,
  outputSources,
  exporters = new Map(),
  altTextByKey = {},
  caption = "",
}) {
  const zip = new JSZip();
  const gallery = zip.folder("gallery");
  const insta = zip.folder("insta");

  const seenSlotIds = new Set();
  for (const sources of outputSources ?? []) {
    for (const source of sources ?? []) {
      const item = source?.item;
      if (!item?.file || !source.previewUrl || seenSlotIds.has(item.id)) {
        continue;
      }
      seenSlotIds.add(item.id);
      const blob = await renderStudioSlotBlob(item, source.previewUrl);
      const ext = extForBlob(blob);
      const baseName = (item.file.name || "image").replace(/\.[^.]+$/, "");
      const prefix = slugify(source.label);
      gallery.file(`${prefix ? `${prefix}-` : ""}${baseName}.${ext}`, blob);
    }
  }

  for (const output of outputs ?? []) {
    const exporter = exporters.get(output.key);
    const { blob, filename } = exporter
      ? await exporter()
      : { blob: await fetch(output.url).then((res) => res.blob()), filename: output.filename };
    insta.file(filename, blob);

    const altText = altTextByKey[output.key]?.trim();
    if (altText) {
      const baseName = filename.replace(/\.[^.]+$/, "");
      insta.file(`${baseName}.alt.txt`, altText);
    }
  }

  insta.file("caption.txt", caption ?? "");

  const zipBlob = await zip.generateAsync({ type: "blob" });
  downloadBlob(zipBlob, "pokepatch-package.zip");
}

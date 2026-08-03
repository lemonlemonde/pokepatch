import JSZip from "jszip";
import {
  imageBaseName,
  renderStudioSlotBlob,
  slotImageFileName,
} from "@/lib/studioSlotImage";
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

/**
 * A repeated name silently overwrites the earlier zip entry, so suffix
 * duplicates rather than dropping an image: two uploads sharing a filename is
 * routine (`IMG_1234.jpg` straight off a phone).
 */
function uniqueName(name, taken) {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  const base = imageBaseName(name);
  const ext = name.slice(base.length);
  let suffix = 2;
  while (taken.has(`${base}-${suffix}${ext}`)) suffix += 1;
  const unique = `${base}-${suffix}${ext}`;
  taken.add(unique);
  return unique;
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
  const galleryNames = new Set();
  for (const sources of outputSources ?? []) {
    for (const source of sources ?? []) {
      const item = source?.item;
      if (!item?.file || !source.previewUrl || seenSlotIds.has(item.id)) {
        continue;
      }
      seenSlotIds.add(item.id);
      const blob = await renderStudioSlotBlob(item, source.previewUrl);
      gallery.file(
        uniqueName(slotImageFileName(item, source.label, blob), galleryNames),
        blob,
      );
    }
  }

  const instaNames = new Set();
  for (const output of outputs ?? []) {
    const exporter = exporters.get(output.key);
    const exported = exporter
      ? await exporter()
      : {
          blob: await fetch(output.url).then((res) => res.blob()),
          filename: output.filename,
        };
    // Alt text has to hang off the *written* name so the pairing survives a
    // suffixed duplicate.
    const name = uniqueName(exported.filename, instaNames);
    insta.file(name, exported.blob);

    const altText = altTextByKey[output.key]?.trim();
    if (altText) {
      insta.file(`${imageBaseName(name)}.alt.txt`, altText);
    }
  }

  insta.file("caption.txt", caption ?? "");

  const zipBlob = await zip.generateAsync({ type: "blob" });
  downloadBlob(zipBlob, "pokepatch-package.zip");
}

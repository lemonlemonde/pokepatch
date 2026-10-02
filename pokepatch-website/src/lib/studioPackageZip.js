import JSZip from "jszip";
import { imageBaseName, slugify } from "@/lib/studioSlotImage";
import { downloadBlob } from "@/lib/downloadFile";

const DEFAULT_PACKAGE_ZIP_NAME = "pokepatch-package.zip";

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
 * `<card>-<set>.zip` off the card-info fields, dropping whichever is blank and
 * falling back to the generic name when both are. Slugified because these are
 * free-text fields — "Sylveon-GX (Secret Rare)" carries parens and spaces that
 * make for an awkward filename.
 */
export function packageZipName({ card = "", set = "" } = {}) {
  const parts = [card, set].map((part) => slugify(part)).filter(Boolean);
  return parts.length ? `${parts.join("-")}.zip` : DEFAULT_PACKAGE_ZIP_NAME;
}

/**
 * Builds and downloads a zip containing:
 * - insta/: every generated (finalized) pair output
 * - insta/text/: optional alt-text .txt per pair, caption.txt, and cardname/cardset
 *   .txt when those fields are filled (folder omitted when empty)
 *
 * @param outputs [{ key, label, url, filename }] — generated pair images
 * @param exporters Map<key, () => Promise<{blob, filename}>> — optional output exporters
 * @param altTextByKey { [outputKey]: string }
 * @param caption string
 * @param cardMeta { card, set } — names the zip file and its own .txt files; optional
 */
export async function downloadStudioPackageZip({
  outputs,
  exporters = new Map(),
  altTextByKey = {},
  caption = "",
  cardMeta = null,
}) {
  const zip = new JSZip();
  const insta = zip.folder("insta");
  let instaText = null;

  function textFolder() {
    if (!instaText) instaText = insta.folder("text");
    return instaText;
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
      textFolder().file(`${imageBaseName(name)}.alt.txt`, altText);
    }
  }

  const captionText = (caption ?? "").trim();
  if (captionText) textFolder().file("caption.txt", captionText);

  // Verbatim, not slugified — unlike the zip's own name these are meant to be
  // copy-pasted into a post. Skipped when blank rather than shipping an empty
  // file, matching how alt text is handled.
  const card = cardMeta?.card?.trim();
  const set = cardMeta?.set?.trim();
  if (card) textFolder().file("cardname.txt", card);
  if (set) textFolder().file("cardset.txt", set);

  const zipBlob = await zip.generateAsync({ type: "blob" });
  downloadBlob(zipBlob, packageZipName(cardMeta ?? {}));
}

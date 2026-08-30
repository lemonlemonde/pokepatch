import JSZip from "jszip";

const IMAGE_EXT = /\.(jpe?g|png)$/i;

function mimeFromName(name) {
  return /\.png$/i.test(name) ? "image/png" : "image/jpeg";
}

function baseName(path) {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/** True for .zip by MIME or filename (browsers disagree on zip MIME). */
export function isZipFile(file) {
  if (!file?.name) return false;
  const type = file.type ?? "";
  return (
    type === "application/zip" ||
    type === "application/x-zip-compressed" ||
    type === "multipart/x-zip" ||
    /\.zip$/i.test(file.name)
  );
}

/**
 * Recursively pull JPEG/PNG entries out of a zip into File objects.
 * Skips directories, __MACOSX junk, and non-image paths.
 */
export async function extractImagesFromZip(zipFile) {
  const zip = await JSZip.loadAsync(zipFile);
  const images = [];

  // Sort so drop order is stable (zip entry order is not guaranteed useful).
  const entries = Object.values(zip.files).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  for (const entry of entries) {
    if (entry.dir) continue;
    const name = baseName(entry.name);
    if (!name || name.startsWith(".")) continue;
    if (entry.name.includes("__MACOSX/")) continue;
    if (!IMAGE_EXT.test(name)) continue;

    const blob = await entry.async("blob");
    images.push(
      new File([blob], name, {
        type: mimeFromName(name),
        lastModified: entry.date?.getTime?.() ?? Date.now(),
      }),
    );
  }

  return images;
}

/**
 * Expand any zips in a file list; leave other files as-is.
 * Nested folders inside a zip are flattened into the returned list.
 */
export async function expandDroppedFiles(files) {
  const out = [];
  for (const file of files) {
    if (isZipFile(file)) {
      out.push(...(await extractImagesFromZip(file)));
    } else {
      out.push(file);
    }
  }
  return out;
}

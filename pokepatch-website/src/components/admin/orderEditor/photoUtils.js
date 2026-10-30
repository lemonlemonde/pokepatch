import { photoFilename } from "@/lib/cardPhotoGroups";

export function savedPhotoItems(images) {
  return (images ?? []).map((image) => {
    const label = photoFilename(image.storage_path);
    const full = image.signed_url ?? "";
    const thumb = image.signed_thumb_url || full;
    return {
      id: image.id ?? image.storage_path,
      storagePath: image.storage_path ?? null,
      src: thumb,
      fullSrc: full,
      alt: label,
      label,
      href: full || undefined,
      removeAriaLabel: `Remove ${label}`,
    };
  });
}

function filenameFromStoragePath(path) {
  const base = path.split("/").pop() ?? path;
  return base.replace(
    /^(customer|progress_front|progress_back|final_front|final_back|admin|before|after)-\d+-/,
    ""
  );
}

function imageTypeLabel(type) {
  switch (type) {
    case "before":
      return "Before";
    case "after":
      return "After";
    case "progress_front":
    case "progress_back":
      return "Progress";
    case "final_front":
    case "final_back":
      return "Final";
    default:
      return null;
  }
}

export function savedPhotoItems(images) {
  return (images ?? []).map((image) => {
    const filename = filenameFromStoragePath(image.storage_path);
    const typeLabel = imageTypeLabel(image.image_type);
    const label = typeLabel ? `${typeLabel} · ${filename}` : filename;
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

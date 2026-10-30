function filenameFromStoragePath(path) {
  const base = path.split("/").pop() ?? path;
  return base.replace(
    /^(customer|progress_front|progress_back|final_front|final_back|admin|before|after)-\d+-/,
    ""
  );
}

/** Legacy progress/final types fold into before/after so there are only 3 groups. */
export function photoGroup(type) {
  switch (type) {
    case "before":
    case "progress_front":
    case "progress_back":
      return "before";
    case "after":
    case "final_front":
    case "final_back":
      return "after";
    default:
      return "customer";
  }
}

export function savedPhotoItems(images) {
  return (images ?? []).map((image) => {
    const label = filenameFromStoragePath(image.storage_path);
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

/** Saved photo items split into customer / before / after strips. */
export function groupedSavedPhotoItems(images) {
  const groups = { customer: [], before: [], after: [] };
  for (const image of images ?? []) {
    groups[photoGroup(image.image_type)].push(image);
  }
  return {
    customer: savedPhotoItems(groups.customer),
    before: savedPhotoItems(groups.before),
    after: savedPhotoItems(groups.after),
  };
}

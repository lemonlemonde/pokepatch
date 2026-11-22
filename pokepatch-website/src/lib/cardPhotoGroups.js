/**
 * Bucket `card_images.image_type` into the three groups shown in the UI.
 * Legacy progress/final types fold into before/after.
 */
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

function compareCardImages(a, b) {
  const aOrder = Number(a?.sort_order);
  const bOrder = Number(b?.sort_order);
  const aHasOrder = Number.isFinite(aOrder);
  const bHasOrder = Number.isFinite(bOrder);
  if (aHasOrder && bHasOrder && aOrder !== bOrder) return aOrder - bOrder;
  if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;
  return (Number(a?.id) || 0) - (Number(b?.id) || 0);
}

export function sortCardImages(images) {
  return [...(images ?? [])].sort(compareCardImages);
}

export function groupCardImages(images) {
  const groups = { customer: [], before: [], after: [] };
  for (const image of sortCardImages(images)) {
    groups[photoGroup(image.image_type)].push(image);
  }
  return groups;
}

/** Original upload filename, minus the `<type>-<n>-` prefix added on upload. */
export function photoFilename(storagePath) {
  const base = String(storagePath ?? "").split("/").pop() ?? "";
  return base.replace(
    /^(customer|progress_front|progress_back|final_front|final_back|admin|before|after)-\d+-/,
    ""
  );
}

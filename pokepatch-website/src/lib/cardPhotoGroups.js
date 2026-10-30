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

export function groupCardImages(images) {
  const groups = { customer: [], before: [], after: [] };
  for (const image of images ?? []) {
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

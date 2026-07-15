import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

/** Canonical damage tag bank for gallery cards. */
export const DAMAGE_TAGS = [
  { id: "crease", label: "Crease" },
  { id: "scratching", label: "Scratching" },
  { id: "dent", label: "Dent" },
  { id: "edge_lift", label: "Edge lift" },
  { id: "dirt", label: "Dirt" },
  { id: "water_damage", label: "Water damage" },
];

export const DAMAGE_TAG_IDS = new Set(DAMAGE_TAGS.map((tag) => tag.id));

export function normalizeDamageTags(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const tags = [];
  for (const value of raw) {
    const id = String(value ?? "").trim();
    if (!DAMAGE_TAG_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    tags.push(id);
  }
  return tags;
}

function publicUrlForPath(path) {
  if (!path || !supabase) return null;
  const { data } = supabase.storage.from("gallery").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

const STORAGE_PUBLIC_MARKER = "/storage/v1/object/public/";

/**
 * Return a width-constrained variant of a Supabase Storage image URL using the
 * built-in image transformation endpoint. Non-storage URLs (e.g. local static
 * fallbacks) and empty widths are returned unchanged.
 */
export function galleryImageUrl(src, { width, quality = 70 } = {}) {
  if (!src || typeof src !== "string" || !width) return src;
  const markerIndex = src.indexOf(STORAGE_PUBLIC_MARKER);
  if (markerIndex === -1) return src;
  const rendered = src.replace(
    STORAGE_PUBLIC_MARKER,
    "/storage/v1/render/image/public/"
  );
  const separator = rendered.includes("?") ? "&" : "?";
  return `${rendered}${separator}width=${width}&quality=${quality}`;
}

function detectMediaKind(path) {
  if (!path) return "image";
  return /\.(mp4|webm|mov)(\?|$)/i.test(path) ? "video" : "image";
}

function mapPair(row, urls = {}) {
  const beforePath = row.before_path ?? null;
  const afterPath = row.after_path ?? null;
  const before =
    urls.before ||
    row.before_url ||
    publicUrlForPath(beforePath) ||
    (typeof row.before === "string" && row.before.startsWith("http")
      ? row.before
      : null) ||
    row.before ||
    null;
  const after =
    urls.after ||
    row.after_url ||
    publicUrlForPath(afterPath) ||
    (typeof row.after === "string" && row.after.startsWith("http")
      ? row.after
      : null) ||
    row.after ||
    null;

  const mediaKind =
    row.media_kind ||
    row.mediaKind ||
    row.type ||
    detectMediaKind(beforePath || afterPath || before || after);

  return {
    id: row.id,
    mediaKind,
    type: mediaKind,
    caption: typeof row.caption === "string" ? row.caption : "",
    before,
    after,
    beforePath,
    afterPath,
  };
}

/** Map a DB row (+ nested pairs) into GalleryContent item shape. */
export function mapGalleryRowToItem(row) {
  const pairs = (row.pairs ?? row.gallery_pairs ?? []).map((pair) =>
    mapPair(pair, pair.urls ?? {})
  );

  return {
    id: row.id,
    title: row.title,
    setName: row.set_name ?? row.setName ?? "",
    damageTags: normalizeDamageTags(row.damage_tags ?? row.damageTags),
    pairs,
  };
}

/** Hardcoded gallery used until Supabase has published rows (newest first). */
export const FALLBACK_GALLERY_ITEMS = [
  {
    title: "Team Japan's Pikachu",
    set_name: "XY Promos",
    damage_tags: ["dent"],
    pairs: [
      {
        id: "pikachu-1",
        type: "image",
        before: "/gallery/pikachu-before-front.webp",
        after: "/gallery/pikachu-after-front.webp",
      },
      {
        id: "pikachu-2",
        type: "image",
        before: "/gallery/pikachu-before-back.webp",
        after: "/gallery/pikachu-after-back.webp",
      },
      {
        id: "pikachu-3",
        type: "video",
        before: "/gallery/pikachu-before-front.mp4",
        after: "/gallery/pikachu-after-front.mp4",
      },
      {
        id: "pikachu-4",
        type: "video",
        before: "/gallery/pikachu-before-back.mp4",
        after: "/gallery/pikachu-after-back.mp4",
      },
    ],
  },
  {
    title: "Rayquaza",
    set_name: "Delta Species",
    damage_tags: ["crease"],
    pairs: [
      {
        id: "rayquaza-1",
        type: "image",
        before: "/gallery/rayquaza-before-front.webp",
        after: "/gallery/rayquaza-after-front.webp",
      },
      {
        id: "rayquaza-2",
        type: "image",
        before: "/gallery/rayquaza-before-back.webp",
        after: "/gallery/rayquaza-after-back.webp",
      },
      {
        id: "rayquaza-3",
        type: "video",
        before: "/gallery/rayquaza-before-front.mp4",
        after: "/gallery/rayquaza-after-front.mp4",
      },
      {
        id: "rayquaza-4",
        type: "video",
        before: "/gallery/rayquaza-before-back.mp4",
        after: "/gallery/rayquaza-after-back.mp4",
      },
    ],
  },
  {
    title: "Reshiram Full Art",
    set_name: "Black and White",
    damage_tags: ["edge_lift", "dirt"],
    pairs: [
      {
        id: "reshiram-1",
        type: "image",
        before: "/gallery/reshiram-before-front.webp",
        after: "/gallery/reshiram-after-front.webp",
      },
      {
        id: "reshiram-2",
        type: "image",
        before: "/gallery/reshiram-before-back.webp",
        after: "/gallery/reshiram-after-back.webp",
      },
    ],
  },
  {
    title: "Scizor ex",
    set_name: "Unseen Forces",
    damage_tags: ["edge_lift", "crease"],
    pairs: [
      {
        id: "scizor-1",
        type: "image",
        before: "/gallery/scizor-before-front.webp",
        after: "/gallery/scizor-after-front.webp",
      },
      {
        id: "scizor-2",
        type: "image",
        before: "/gallery/scizor-before-back.webp",
        after: "/gallery/scizor-after-back.webp",
      },
      {
        id: "scizor-3",
        type: "video",
        before: "/gallery/scizor-before-front.mp4",
        after: "/gallery/scizor-after-front.mp4",
      },
      {
        id: "scizor-4",
        type: "video",
        before: "/gallery/scizor-before-back.mp4",
        after: "/gallery/scizor-after-back.mp4",
      },
    ],
  },
  {
    title: "Rocket's Mewtwo",
    set_name: "Gym Challenge",
    damage_tags: ["crease", "scratching"],
    pairs: [
      {
        id: "mewtwo-1",
        type: "image",
        before: "/gallery/mewtwo-before-front.webp",
        after: "/gallery/mewtwo-after-front.webp",
      },
      {
        id: "mewtwo-2",
        type: "image",
        before: "/gallery/mewtwo-before-back.webp",
        after: "/gallery/mewtwo-after-back.webp",
      },
      {
        id: "mewtwo-3",
        type: "video",
        before: "/gallery/mewtwo-before-front.mp4",
        after: "/gallery/mewtwo-after-front.mp4",
      },
      {
        id: "mewtwo-4",
        type: "video",
        before: "/gallery/mewtwo-before-back.mp4",
        after: "/gallery/mewtwo-after-back.mp4",
      },
    ],
  },
].map(mapGalleryRowToItem);

/**
 * Load published gallery items from Supabase.
 * Returns null when Supabase is unset or the query fails (caller can fall back).
 * Returns [] when the table exists but has no published rows.
 */
export async function fetchPublishedGalleryItems() {
  if (!isSupabaseConfigured || !supabase) return null;

  const { data, error } = await supabase
    .from("gallery_items")
    .select(
      `
      id,
      title,
      set_name,
      damage_tags,
      created_at,
      gallery_pairs (
        id,
        sort_order,
        media_kind,
        caption,
        before_path,
        after_path
      )
    `
    )
    .eq("published", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("gallery_items fetch failed", error);
    return null;
  }

  return (data ?? []).map((row) => {
    const pairs = [...(row.gallery_pairs ?? [])].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    );
    return mapGalleryRowToItem({ ...row, pairs });
  });
}

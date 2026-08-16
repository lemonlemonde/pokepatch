/**
 * Damage tag allowlist for edge functions (admin gallery saves, etc.).
 * Keep ids in sync with src/lib/damageTags.js (edit that file first).
 */

export const DAMAGE_TAGS = [
  { id: "crease", label: "Crease" },
  { id: "scratching", label: "Scratching" },
  { id: "dent", label: "Dent" },
  { id: "edge_lift", label: "Edge lift" },
  { id: "edge_peeling", label: "Edge peeling" },
  { id: "dirt", label: "Dirt" },
  { id: "water_damage", label: "Water damage" },
  { id: "warping", label: "Warping" },
  { id: "whitening", label: "Whitening" },
] as const;

export const DAMAGE_TAG_IDS = new Set<string>(
  DAMAGE_TAGS.map((tag) => tag.id),
);

export function sanitizeDamageTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of raw) {
    const id = String(value ?? "").trim();
    if (!DAMAGE_TAG_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    tags.push(id);
  }
  return tags;
}

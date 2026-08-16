/**
 * Canonical damage tag bank for quote requests, gallery filters, and admin.
 * Edit this list first when adding/removing a damage type, then mirror ids in:
 * - supabase/functions/_shared/damageTags.ts
 * - create_order / update_order SQL allowlists (via migration)
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

/** Allowlisted tags with labels, preserving bank order. */
export function labeledDamageTags(raw) {
  const selected = new Set(normalizeDamageTags(raw));
  return DAMAGE_TAGS.filter((tag) => selected.has(tag.id));
}

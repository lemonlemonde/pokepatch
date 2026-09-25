import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Card catalog lookups read from public.tcg_cards — a local mirror of the
 * Pokémon TCG dataset kept fresh by scripts/sync-tcg-catalog.mjs. Nothing here
 * calls api.pokemontcg.io at request time.
 */

/** Matches the search function's clamp; admin UI pages at 100. */
export const CATALOG_MAX_PAGE_SIZE = 100;

type CatalogSearchResult = {
  candidates: TcgCardCandidate[];
  totalCount: number;
  page: number;
  pageSize: number;
  queryUsed: string | null;
};

export type TcgCardCandidate = {
  id: string;
  name: string;
  set_name: string;
  number: string;
  image_small: string;
  image_large: string;
};

type TcgCardRow = {
  id: string;
  name: string | null;
  number: string | null;
  set_name: string | null;
  image_small: string | null;
  image_large: string | null;
};

/** Fold user input for case-insensitive search. */
export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function tcgCardImageSmallUrl(
  cardId: string,
  images?: { small?: string; large?: string } | null
): string {
  const fromApi = images?.small?.trim();
  if (fromApi) return fromApi;
  return `https://images.scrydex.com/pokemon/${cardId.trim()}/small`;
}

function mapRow(row: TcgCardRow): TcgCardCandidate {
  const id = row.id.trim();
  const imageSmall = tcgCardImageSmallUrl(id, {
    small: row.image_small ?? undefined,
  });
  return {
    id,
    name: row.name?.trim() || id,
    set_name: row.set_name?.trim() ?? "",
    number: row.number?.trim() ?? "",
    image_small: imageSmall,
    image_large: row.image_large?.trim() || imageSmall,
  };
}

export async function fetchPokemonTcgCard(
  supabase: SupabaseClient,
  cardId: string
): Promise<TcgCardCandidate | null> {
  const id = cardId.trim();
  if (!id) return null;

  const { data, error } = await supabase
    .from("tcg_cards")
    .select("id, name, number, set_name, image_small, image_large")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as TcgCardRow) : null;
}

/** Paginated, ranked search over the mirrored catalog. */
export async function searchPokemonTcgCatalog(
  supabase: SupabaseClient,
  cardName: string,
  setName: string,
  { page = 1, pageSize = CATALOG_MAX_PAGE_SIZE, number = "" } = {}
): Promise<CatalogSearchResult> {
  const safePage = Math.max(1, page);
  const safeSize = Math.min(Math.max(pageSize, 1), CATALOG_MAX_PAGE_SIZE);
  const name = normalizeSearchText(cardName);
  const set = normalizeSearchText(setName);
  const num = normalizeSearchText(number);

  if (!name && !set && !num) {
    return {
      candidates: [],
      totalCount: 0,
      page: safePage,
      pageSize: safeSize,
      queryUsed: null,
    };
  }

  const { data, error } = await supabase.rpc("search_tcg_cards", {
    p_name: name,
    p_set: set,
    p_number: num,
    p_page: safePage,
    p_page_size: safeSize,
  });
  if (error) throw error;

  const rows = (data ?? []) as (TcgCardRow & { total_count: number | string })[];
  const totalCount = rows.length > 0 ? Number(rows[0].total_count) || rows.length : 0;

  return {
    candidates: rows.map(mapRow),
    totalCount,
    page: safePage,
    pageSize: safeSize,
    queryUsed: [name && `name:${name}`, set && `set:${set}`, num && `number:${num}`]
      .filter(Boolean)
      .join(" "),
  };
}

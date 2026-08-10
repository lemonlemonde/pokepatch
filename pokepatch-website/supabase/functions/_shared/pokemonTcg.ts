const POKEMON_TCG_BASE = "https://api.pokemontcg.io/v2";
const REQUEST_TIMEOUT_MS = 18_000;
const CATALOG_SEARCH_TIMEOUT_MS = 8_000;
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const CATALOG_CACHE_MAX = 80;
const CATALOG_RETRY_ATTEMPTS = 3;
const CATALOG_RETRY_DELAY_MS = 250;
// /sets 5xxs far more often than /cards, and a sync runs off the request
// path, so it can afford to wait the upstream out.
const SET_SYNC_RETRY_ATTEMPTS = 8;
const SET_SYNC_RETRY_DELAY_MS = 600;
const SET_SYNC_MAX_PAGES = 20;

type CatalogSearchResult = {
  candidates: TcgCardCandidate[];
  totalCount: number;
  page: number;
  pageSize: number;
  query_used: string | null;
};

const catalogSearchCache = new Map<
  string,
  { expiresAt: number; result: CatalogSearchResult }
>();

export type TcgCardCandidate = {
  id: string;
  name: string;
  set_name: string;
  number: string;
  image_small: string;
  image_large: string;
};

type TcgApiCard = {
  id?: string;
  name?: string;
  number?: string;
  images?: { small?: string; large?: string };
  set?: { name?: string; id?: string };
};

function apiKeyHeader(): Record<string, string> {
  const key = Deno.env.get("POKEMON_TCG_API_KEY")?.trim();
  return key ? { "X-Api-Key": key } : {};
}

function escapeLuceneWildcard(value: string): string {
  return value.replace(/([\\+\-!():^"[\]{}~?|&/])/g, "\\$1");
}

/** Fold user input for case-insensitive API prefix search. */
export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Thumbnail art for a card, preferring Scrydex over the Pokémon TCG API.
 *
 * Both serve ~245px art, but Scrydex sends JPEG (~34KB) where the TCG API
 * sends PNG (~180KB). The API's own `small` stays as the fallback for cards
 * Scrydex doesn't carry.
 */
export function tcgCardImageSmallUrl(
  cardId: string,
  images?: { small?: string; large?: string } | null
): string {
  const id = cardId.trim();
  if (id) return `https://images.scrydex.com/pokemon/${id}/small`;
  return images?.small?.trim() ?? "";
}

function mapCard(row: TcgApiCard): TcgCardCandidate | null {
  const id = row.id?.trim();
  if (!id) return null;
  // Carry the API's own URLs untouched; callers pick the cheaper Scrydex art
  // via tcgCardImageSmallUrl and keep these as the fallback.
  const imageSmall = row.images?.small?.trim() ?? "";
  return {
    id,
    name: row.name?.trim() ?? id,
    set_name: row.set?.name?.trim() ?? "",
    number: row.number?.trim() ?? "",
    image_small: imageSmall,
    image_large: row.images?.large?.trim() ?? imageSmall,
  };
}

async function tcgFetch(path: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${POKEMON_TCG_BASE}${path}`, {
      headers: apiKeyHeader(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchPokemonTcgCard(
  cardId: string
): Promise<TcgCardCandidate | null> {
  const id = cardId.trim();
  if (!id) return null;

  const select = "id,name,number,images,set";
  const paths = [
    `/cards/${encodeURIComponent(id)}?select=${select}`,
    `/cards?q=id:${encodeURIComponent(id)}&pageSize=1&select=${select}`,
  ];

  for (const path of paths) {
    for (let attempt = 0; attempt < CATALOG_RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await tcgFetch(path, 12_000);
        if (!response.ok) {
          await sleep(350 * (attempt + 1));
          continue;
        }
        const payload = (await response.json()) as {
          data?: TcgApiCard | TcgApiCard[];
        };
        const row = Array.isArray(payload.data)
          ? payload.data[0]
          : payload.data;
        const card = mapCard(row ?? {});
        if (card) return card;
      } catch {
        await sleep(350 * (attempt + 1));
      }
    }
  }

  return null;
}

function catalogCacheKey(
  cardName: string,
  setName: string,
  page: number,
  pageSize: number
): string {
  return `${normalizeSearchText(cardName)}|${normalizeSearchText(setName)}|${page}|${pageSize}`;
}

function readCatalogCache(key: string): CatalogSearchResult | null {
  const hit = catalogSearchCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    catalogSearchCache.delete(key);
    return null;
  }
  return hit.result;
}

function writeCatalogCache(key: string, result: CatalogSearchResult): void {
  if (catalogSearchCache.size >= CATALOG_CACHE_MAX) {
    const oldest = catalogSearchCache.keys().next().value;
    if (oldest) catalogSearchCache.delete(oldest);
  }
  catalogSearchCache.set(key, {
    expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
    result,
  });
}

function emptyCatalogResult(
  page: number,
  pageSize: number,
  queryUsed: string | null = null
): CatalogSearchResult {
  return {
    candidates: [],
    totalCount: 0,
    page,
    pageSize,
    query_used: queryUsed,
  };
}

async function fetchCatalogPage(
  q: string,
  page: number,
  pageSize: number
): Promise<CatalogSearchResult> {
  const params = new URLSearchParams({
    q,
    page: String(page),
    pageSize: String(pageSize),
    select: "id,name,number,images,set",
  });

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < CATALOG_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await tcgFetch(
        `/cards?${params}`,
        CATALOG_SEARCH_TIMEOUT_MS
      );
      if (!response.ok) {
        lastError = new Error(`TCG API ${response.status}`);
        await sleep(CATALOG_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      const payload = (await response.json().catch(() => null)) as {
        data?: TcgApiCard[];
        totalCount?: number;
        page?: number;
        pageSize?: number;
      } | null;
      if (!payload) {
        lastError = new Error("TCG API invalid response");
        await sleep(CATALOG_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      const candidates = (payload.data ?? [])
        .map(mapCard)
        .filter((row): row is TcgCardCandidate => Boolean(row));

      return {
        candidates,
        totalCount: payload.totalCount ?? candidates.length,
        page: payload.page ?? page,
        pageSize: payload.pageSize ?? pageSize,
        query_used: q,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      await sleep(CATALOG_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError ?? new Error("TCG catalog search failed");
}

/** First word prefix — API rejects wildcards inside multi-word terms. */
function firstTokenPrefix(normalizedValue: string): string {
  const token = normalizedValue.split(/\s+/).filter(Boolean)[0] ?? "";
  return token ? escapeLuceneWildcard(token) : "";
}

/** One Lucene query per set word the admin typed (prefix match, case-insensitive). */
function buildCatalogSearchQueries(
  cardName: string,
  setName: string
): string[] {
  const name = normalizeSearchText(cardName);
  const set = normalizeSearchText(setName);
  const namePrefix = firstTokenPrefix(name);
  const setTokens = [
    ...new Set(
      set
        .split(/\s+/)
        .filter((token) => token.length >= 2)
        .map((token) => escapeLuceneWildcard(token))
    ),
  ];

  if (namePrefix.length >= 2 && setTokens.length > 0) {
    return setTokens.map(
      (setPrefix) => `name:${namePrefix}* set.name:${setPrefix}*`
    );
  }
  if (name.length >= 3 && namePrefix.length >= 2) {
    return [`name:${namePrefix}*`];
  }
  if (setTokens.length > 0) {
    return setTokens.map((setPrefix) => `set.name:${setPrefix}*`);
  }
  return [];
}

/** Paginated search across the full Pokémon TCG API catalog. */
export async function searchPokemonTcgCatalog(
  cardName: string,
  setName: string,
  { page = 1, pageSize = 24 } = {}
): Promise<CatalogSearchResult> {
  const safePage = Math.max(1, page);
  const safeSize = Math.min(Math.max(pageSize, 1), 50);
  const cacheKey = catalogCacheKey(cardName, setName, safePage, safeSize);
  const cached = readCatalogCache(cacheKey);
  if (cached) return cached;

  const queries = buildCatalogSearchQueries(cardName, setName);
  if (queries.length === 0) {
    return emptyCatalogResult(safePage, safeSize);
  }

  let lastResult = emptyCatalogResult(safePage, safeSize, queries[0]);

  for (const query of queries) {
    try {
      const result = await fetchCatalogPage(query, safePage, safeSize);
      lastResult = result;
      if (result.candidates.length > 0) {
        writeCatalogCache(cacheKey, result);
        return result;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("TCG catalog search attempt failed:", query, message);
    }
  }

  return lastResult;
}

export type TcgSet = {
  id: string;
  name: string;
  series: string;
  ptcgo_code: string;
  printed_total: number | null;
  total: number | null;
  release_date: string | null;
  symbol_url: string;
  logo_url: string;
};

type TcgApiSet = {
  id?: string;
  name?: string;
  series?: string;
  ptcgoCode?: string;
  printedTotal?: number;
  total?: number;
  releaseDate?: string;
  images?: { symbol?: string; logo?: string };
};

function mapSet(row: TcgApiSet): TcgSet | null {
  const id = row.id?.trim();
  if (!id) return null;
  return {
    id,
    name: row.name?.trim() ?? id,
    series: row.series?.trim() ?? "",
    // Not every set has an official code — promos and older sets often omit
    // it. Blank here means the Set library override has to supply one.
    ptcgo_code: row.ptcgoCode?.trim() ?? "",
    printed_total: typeof row.printedTotal === "number" ? row.printedTotal : null,
    total: typeof row.total === "number" ? row.total : null,
    // Upstream sends "1999/01/09"; normalize to ISO for a Postgres date.
    release_date: row.releaseDate?.trim().replace(/\//g, "-") || null,
    symbol_url: row.images?.symbol?.trim() ?? "",
    logo_url: row.images?.logo?.trim() ?? "",
  };
}

/**
 * Every set in the Pokémon TCG API, for syncing into the local set_catalog.
 *
 * The upstream API returns 5xx for a large share of requests, so this retries
 * hard and paginates defensively. Call it from a sync job, never on a request
 * path — reads should come from the synced table.
 */
export async function fetchAllPokemonTcgSets(): Promise<TcgSet[]> {
  const select = "id,name,series,ptcgoCode,printedTotal,total,releaseDate,images";
  const pageSize = 250;
  const sets: TcgSet[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= SET_SYNC_MAX_PAGES; page++) {
    let pageRows: TcgApiSet[] | null = null;

    for (let attempt = 0; attempt < SET_SYNC_RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await tcgFetch(
          `/sets?page=${page}&pageSize=${pageSize}&select=${select}`
        );
        if (!response.ok) {
          await sleep(SET_SYNC_RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        const payload = (await response.json()) as { data?: TcgApiSet[] };
        pageRows = Array.isArray(payload.data) ? payload.data : [];
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`TCG set sync page ${page} attempt failed:`, message);
        await sleep(SET_SYNC_RETRY_DELAY_MS * (attempt + 1));
      }
    }

    if (pageRows === null) {
      throw new Error(
        `pokemon tcg /sets page ${page} failed after ${SET_SYNC_RETRY_ATTEMPTS} attempts`
      );
    }
    if (pageRows.length === 0) break;

    for (const row of pageRows) {
      const set = mapSet(row);
      if (set && !seen.has(set.id)) {
        seen.add(set.id);
        sets.push(set);
      }
    }

    if (pageRows.length < pageSize) break;
  }

  return sets;
}

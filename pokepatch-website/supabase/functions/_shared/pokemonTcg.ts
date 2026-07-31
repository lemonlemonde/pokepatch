const POKEMON_TCG_BASE = "https://api.pokemontcg.io/v2";
const REQUEST_TIMEOUT_MS = 18_000;
const CATALOG_SEARCH_TIMEOUT_MS = 8_000;
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const CATALOG_CACHE_MAX = 80;
const CATALOG_RETRY_ATTEMPTS = 3;
const CATALOG_RETRY_DELAY_MS = 250;

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

export function tcgCardImageSmallUrl(
  cardId: string,
  images?: { small?: string; large?: string } | null
): string {
  const fromApi = images?.small?.trim();
  if (fromApi) return fromApi;
  return `https://images.scrydex.com/pokemon/${cardId.trim()}/small`;
}

function mapCard(row: TcgApiCard): TcgCardCandidate | null {
  const id = row.id?.trim();
  if (!id) return null;
  const imageSmall = tcgCardImageSmallUrl(id, row.images);
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

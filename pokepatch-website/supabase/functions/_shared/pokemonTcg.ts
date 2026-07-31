const POKEMON_TCG_BASE = "https://api.pokemontcg.io/v2";
const REQUEST_TIMEOUT_MS = 18_000;
const CATALOG_SEARCH_TIMEOUT_MS = 10_000;
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const CATALOG_CACHE_MAX = 80;

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

function escapeLucenePhrase(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}

function escapeLuceneWildcard(value: string): string {
  return value.replace(/([\\+\-!():^"[\]{}~?|&/])/g, "\\$1");
}

/** Informal gallery set labels → Pokémon TCG API set.name values. */
const SET_NAME_ALIASES: Record<string, string> = {
  "xy promos": "XY Black Star Promos",
  "xy black star promos": "XY Black Star Promos",
  "delta species": "EX Delta Species",
  "unseen forces": "EX Unseen Forces",
  "black and white": "Black & White",
  "crown zenith: galarian gallery": "Crown Zenith Galarian Gallery",
  "crown zenith galarian gallery": "Crown Zenith Galarian Gallery",
};

/** Informal gallery set labels → Pokémon TCG API set.id values (most reliable for search). */
const SET_ID_ALIASES: Record<string, string> = {
  "ascended heroes": "me2pt5",
  "guardians rising": "sm2",
  "xy promos": "xyp",
  "xy black star promos": "xyp",
  "ex delta species": "ex11",
  "ex unseen forces": "ex10",
  "black and white": "bw1",
  "black & white": "bw1",
  "gym challenge": "gym2",
  "crown zenith: galarian gallery": "swsh12pt5gg",
  "crown zenith galarian gallery": "swsh12pt5gg",
  "galarian gallery": "swsh12pt5gg",
};

/** Map informal admin set names to API-friendly set.name phrases. */
function normalizeSetNameForTcgSearch(setName: string): string {
  const trimmed = setName.trim().replace(/\s*:\s*/g, " ");
  const key = trimmed.toLowerCase();
  return SET_NAME_ALIASES[key] ?? trimmed;
}

function normalizeSetIdForTcgSearch(setName: string): string | null {
  const trimmed = setName.trim().replace(/\s*:\s*/g, " ");
  const key = trimmed.toLowerCase();
  return SET_ID_ALIASES[key] ?? null;
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
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await tcgFetch(path, 12_000);
        if (!response.ok) {
          await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
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
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
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
  return `${cardName.trim().toLowerCase()}|${setName.trim().toLowerCase()}|${page}|${pageSize}`;
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

  const response = await tcgFetch(
    `/cards?${params}`,
    CATALOG_SEARCH_TIMEOUT_MS
  );
  if (!response.ok) {
    throw new Error(`TCG API ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: TcgApiCard[];
    totalCount?: number;
    page?: number;
    pageSize?: number;
  };

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
}

/** set.name tokens that often 500 on the Pokémon TCG API — try after safer tokens. */
const DEPRIORITIZED_SET_TOKENS = new Set(["gallery", "galarian"]);

function catalogSetSearchClauses(setName: string): string[] {
  const clauses: string[] = [];
  const setId = normalizeSetIdForTcgSearch(setName);
  if (setId) clauses.push(`set.id:${setId}`);

  const tokens = normalizeSetNameForTcgSearch(setName)
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""))
    .filter((t) => t.length > 2);

  const sorted = [...tokens].sort((a, b) => {
    const aRank = DEPRIORITIZED_SET_TOKENS.has(a) ? 1 : 0;
    const bRank = DEPRIORITIZED_SET_TOKENS.has(b) ? 1 : 0;
    return aRank - bRank;
  });

  for (const token of sorted) {
    clauses.push(`set.name:${escapeLuceneWildcard(token)}*`);
  }

  return [...new Set(clauses)];
}

/** Build catalog queries (prefix-based — avoids slow leading wildcards). */
export function buildCatalogSearchQueriesFromFields(
  cardName: string,
  setName: string
): string[] {
  const name = cardName.trim().toLowerCase();
  const set = setName.trim();
  const queries: string[] = [];

  if (name.length >= 2 && set.length >= 2) {
    const nameTokens = name.split(/\s+/).filter(Boolean);
    const firstToken = escapeLuceneWildcard(nameTokens[0] ?? name);
    const setClauses = catalogSetSearchClauses(set);

    for (const setClause of setClauses) {
      queries.push(`name:${firstToken}* ${setClause}`);
    }
    if (nameTokens.length > 1) {
      const phrase = escapeLucenePhrase(name);
      for (const setClause of setClauses.slice(0, 3)) {
        queries.push(`name:"${phrase}" ${setClause}`);
      }
    }
  } else if (name.length >= 3) {
    const nameTokens = name.split(/\s+/).filter(Boolean);
    const firstToken = escapeLuceneWildcard(nameTokens[0] ?? name);
    queries.push(`name:${firstToken}*`);
    if (nameTokens.length > 1) {
      queries.push(`name:"${escapeLucenePhrase(name)}"`);
    }
  } else if (set.length >= 2) {
    for (const setClause of catalogSetSearchClauses(set)) {
      queries.push(setClause);
    }
  }

  return [...new Set(queries.filter(Boolean))];
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

  const attempts = buildCatalogSearchQueriesFromFields(cardName, setName);
  if (attempts.length === 0) {
    return {
      candidates: [],
      totalCount: 0,
      page: safePage,
      pageSize: safeSize,
      query_used: null,
    };
  }

  let lastError: Error | null = null;
  let lastEmpty: CatalogSearchResult | null = null;

  for (const q of attempts) {
    try {
      const result = await fetchCatalogPage(q, safePage, safeSize);
      if (result.candidates.length > 0 || result.totalCount > 0) {
        writeCatalogCache(cacheKey, result);
        return result;
      }
      lastEmpty = result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn("TCG catalog search attempt failed:", q, lastError.message);
    }
  }

  if (lastError) {
    console.error(
      "TCG catalog search exhausted:",
      cardName,
      setName,
      lastError.message
    );
  }

  if (lastEmpty) {
    writeCatalogCache(cacheKey, lastEmpty);
    return lastEmpty;
  }

  return {
    candidates: [],
    totalCount: 0,
    page: safePage,
    pageSize: safeSize,
    query_used: attempts[0] ?? null,
  };
}

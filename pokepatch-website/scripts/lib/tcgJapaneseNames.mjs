/**
 * Map English TCG card names → Japanese so catalog search also matches
 * Japanese input. Species names come from PokeAPI's pokemon_species_names CSV
 * (language 1 = Japanese, 9 = English). Affixes are TCG-specific.
 */

const SPECIES_NAMES_CSV_URL =
  process.env.POKEMON_SPECIES_NAMES_CSV_URL ||
  "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv";

const LANG_JA = "1";
const LANG_EN = "9";

const ENERGY_EN_TO_JA = {
  grass: "草",
  fire: "炎",
  water: "水",
  lightning: "雷",
  psychic: "超",
  fighting: "闘",
  darkness: "悪",
  metal: "鋼",
  fairy: "妖",
  dragon: "竜",
  colorless: "無色",
};

/** Longer tokens first so VSTAR wins over V, Hisuian over Hi, etc. */
const PREFIXES = [
  ["かがやく", "Radiant"],
  ["アメイジング", "Amazing"],
  ["オリジン", "Origin Forme"],
  ["アローラ", "Alolan"],
  ["ガラル", "Galarian"],
  ["ヒスイ", "Hisuian"],
  ["パルデア", "Paldean"],
  ["わるい", "Dark"],
  ["ひかりの", "Light"],
  ["メガ", "Mega"],
];

const SUFFIXES = [
  ["V-UNION", "V-UNION"],
  ["VSTAR", "VSTAR"],
  ["VMAX", "VMAX"],
  ["LV.X", "LV.X"],
  ["BREAK", "BREAK"],
  ["GX", "GX"],
  ["EX", "EX"],
  ["ex", "ex"],
  ["V", "V"],
];

const FORME_EN_TO_JA = {
  "teal mask": "みどりのめん",
  "wellspring mask": "いどのめん",
  "hearthflame mask": "かまどのめん",
  "cornerstone mask": "いしずえのめん",
  bloodmoon: "アカツキ",
};
const PREFIX_EN_TO_JA = Object.fromEntries(
  PREFIXES.map(([ja, en]) => [en, ja])
);

function jaPrefixesFromEnglish(prefixes) {
  return prefixes.map((en) => PREFIX_EN_TO_JA[en] || "").join("");
}

function compact(value) {
  return String(value ?? "").replace(/[\s　]+/g, "");
}

export async function loadSpeciesNameMaps(fetchImpl = fetch) {
  const response = await fetchImpl(SPECIES_NAMES_CSV_URL);
  if (!response.ok) {
    throw new Error(`species names download failed: HTTP ${response.status}`);
  }
  const text = await response.text();
  const byId = new Map();
  for (const line of text.split(/\r?\n/)) {
    const [id, lang, name] = line.split(",");
    if (!id || !lang || !name || id === "pokemon_species_id") continue;
    if (lang !== LANG_JA && lang !== LANG_EN) continue;
    const row = byId.get(id) ?? {};
    if (lang === LANG_JA) row.ja = name.trim();
    if (lang === LANG_EN) row.en = name.trim();
    byId.set(id, row);
  }

  const enToJa = new Map();
  for (const { ja, en } of byId.values()) {
    if (!ja || !en) continue;
    enToJa.set(en.toLowerCase(), ja);
  }

  const enNamesByLength = [...enToJa.keys()].sort((a, b) => b.length - a.length);
  return { enToJa, enNamesByLength };
}

function stripKnownSuffixes(raw) {
  const taken = [];
  let rest = raw;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [token, en] of SUFFIXES) {
      if (rest.endsWith(token)) {
        taken.unshift(en);
        rest = rest.slice(0, -token.length).trim();
        changed = true;
        break;
      }
    }
  }
  return { rest, suffixes: taken };
}

function longestSpeciesMatch(text, namesByLength, lookup) {
  const compactText = compact(text);
  for (const key of namesByLength) {
    if (!key) continue;
    if (text.includes(key) || compactText.includes(compact(key))) {
      return { key, value: lookup.get(key) || lookup.get(compact(key)) };
    }
  }
  return null;
}

function translateEnergyFromEn(enName) {
  const match = /^basic\s+(.+?)\s+energy$/i.exec(enName.trim());
  if (!match) return null;
  const type = ENERGY_EN_TO_JA[match[1].toLowerCase()];
  return type ? `基本${type}エネルギー` : null;
}

function stripEnglishPrefixes(raw) {
  const taken = [];
  let rest = raw.trim();
  const enPrefixes = PREFIXES.map(([, en]) => en).sort((a, b) => b.length - a.length);
  let changed = true;
  while (changed) {
    changed = false;
    const lower = rest.toLowerCase();
    for (const en of enPrefixes) {
      const token = en.toLowerCase();
      if (lower === token || lower.startsWith(`${token} `)) {
        taken.push(en);
        rest = rest.slice(en.length).trim();
        changed = true;
        break;
      }
    }
  }
  return { rest, prefixes: taken };
}

/**
 * English TCG name → Japanese, so a Japanese query matches rows named in English.
 */
export function englishCardNameToJapanese(enName, maps) {
  const original = String(enName ?? "").trim();
  if (!original) return "";

  const energy = translateEnergyFromEn(original);
  if (energy) return energy;

  const { rest: withoutSuffix, suffixes } = stripKnownSuffixes(original);
  const { rest: core, prefixes } = stripEnglishPrefixes(withoutSuffix);
  const lowerCore = core.toLowerCase();

  const exact = maps.enToJa.get(lowerCore);
  if (exact) {
    return `${jaPrefixesFromEnglish(prefixes)}${exact}${suffixes.join("")}`;
  }

  const hit = longestSpeciesMatch(lowerCore, maps.enNamesByLength, maps.enToJa);
  if (hit?.value) {
    const remainder = lowerCore.replace(hit.key, "").trim();
    const formeJa = FORME_EN_TO_JA[remainder] || remainder.replace(/\s+/g, "");
    return `${jaPrefixesFromEnglish(prefixes)}${hit.value}${formeJa}${suffixes.join("")}`;
  }

  return "";
}

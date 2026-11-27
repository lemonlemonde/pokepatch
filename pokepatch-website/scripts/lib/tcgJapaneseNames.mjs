/**
 * Map Japanese TCG card names ↔ English so catalog search works in either
 * language. Species names come from PokeAPI's pokemon_species_names CSV
 * (language 1 = Japanese, 9 = English). Affixes are TCG-specific.
 */

const SPECIES_NAMES_CSV_URL =
  process.env.POKEMON_SPECIES_NAMES_CSV_URL ||
  "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv";

const LANG_JA = "1";
const LANG_EN = "9";

const ENERGY_JA_TO_EN = {
  草: "Grass",
  炎: "Fire",
  水: "Water",
  雷: "Lightning",
  超: "Psychic",
  闘: "Fighting",
  悪: "Darkness",
  鋼: "Metal",
  妖: "Fairy",
  竜: "Dragon",
  無色: "Colorless",
};

const ENERGY_EN_TO_JA = Object.fromEntries(
  Object.entries(ENERGY_JA_TO_EN).map(([ja, en]) => [en.toLowerCase(), ja])
);

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

const FORME_JA_TO_EN = {
  みどりのめん: "Teal Mask",
  いどのめん: "Wellspring Mask",
  かまどのめん: "Hearthflame Mask",
  いしずえのめん: "Cornerstone Mask",
  アカツキ: "Bloodmoon",
};

const FORME_EN_TO_JA = Object.fromEntries(
  Object.entries(FORME_JA_TO_EN).map(([ja, en]) => [en.toLowerCase(), ja])
);
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

  const jaToEn = new Map();
  const enToJa = new Map();
  for (const { ja, en } of byId.values()) {
    if (!ja || !en) continue;
    jaToEn.set(ja, en);
    jaToEn.set(compact(ja), en);
    enToJa.set(en.toLowerCase(), ja);
  }

  const jaNamesByLength = [...jaToEn.keys()].sort((a, b) => b.length - a.length);
  const enNamesByLength = [...enToJa.keys()].sort((a, b) => b.length - a.length);
  return { jaToEn, enToJa, jaNamesByLength, enNamesByLength };
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

function stripKnownPrefixes(raw) {
  const taken = [];
  let rest = raw.replace(/^[\s　]+|[\s　]+$/g, "");
  let changed = true;
  while (changed) {
    changed = false;
    for (const [ja, en] of PREFIXES) {
      if (rest.startsWith(ja)) {
        taken.push(en);
        rest = rest.slice(ja.length).replace(/^[\s　]+/, "");
        changed = true;
        break;
      }
    }
  }
  return { rest, prefixes: taken };
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

function translateEnergyFromJa(jaName) {
  const match = /^基本(.+)エネルギー$/.exec(compact(jaName));
  if (!match) return null;
  const type = ENERGY_JA_TO_EN[match[1]];
  return type ? `Basic ${type} Energy` : "Basic Energy";
}

function translateEnergyFromEn(enName) {
  const match = /^basic\s+(.+?)\s+energy$/i.exec(enName.trim());
  if (!match) return null;
  const type = ENERGY_EN_TO_JA[match[1].toLowerCase()];
  return type ? `基本${type}エネルギー` : null;
}

function leftoverToEnglish(raw) {
  const trimmed = raw.replace(/[\s　]+/g, " ").trim();
  if (!trimmed) return [];
  const mapped = FORME_JA_TO_EN[compact(trimmed)] || FORME_JA_TO_EN[trimmed];
  if (mapped) return [mapped];
  return [trimmed];
}

/**
 * Japanese TCG name → English display name. Unknown trainers stay Japanese
 * so they remain searchable via name_ja.
 */
export function japaneseCardNameToEnglish(jaName, maps) {
  const original = String(jaName ?? "").trim();
  if (!original) return "";

  const energy = translateEnergyFromJa(original);
  if (energy) return energy;

  const { rest: withoutSuffix, suffixes } = stripKnownSuffixes(original);
  const { rest: core, prefixes } = stripKnownPrefixes(withoutSuffix);

  const exact = maps.jaToEn.get(core) || maps.jaToEn.get(compact(core));
  if (exact) {
    return [...prefixes, exact, ...suffixes].join(" ");
  }

  const possessive = core.split("の");
  const possessiveTail = possessive.length > 1 ? possessive[possessive.length - 1] : "";
  const possessiveMatch =
    possessiveTail &&
    (maps.jaToEn.get(possessiveTail) || maps.jaToEn.get(compact(possessiveTail)));
  if (possessiveMatch) {
    return [...prefixes, possessiveMatch, ...suffixes].join(" ");
  }

  const hit = longestSpeciesMatch(core, maps.jaNamesByLength, maps.jaToEn);
  if (hit?.value) {
    const remainder = compact(core).replace(compact(hit.key), "");
    const forme = leftoverToEnglish(remainder);
    return [...prefixes, hit.value, ...forme, ...suffixes]
      .filter(Boolean)
      .join(" ");
  }

  return original;
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
 * English TCG name → Japanese, used so a Japanese query also hits English rows.
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

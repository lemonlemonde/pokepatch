"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminSearchGalleryTcg } from "@/lib/adminApi";
import { CARD_THUMB_ASPECT_CLASS, CARD_THUMB_IMAGE_CLASS } from "@/lib/gallery";
import { tcgCardImageUrl } from "@/lib/tcgCardImage";

/** Fetch up to this many matches per request (API/server also cap at 100). */
const PAGE_SIZE = 100;
const MIN_SET_LENGTH = 2;
const MIN_NAME_ONLY_LENGTH = 3;
/**
 * Client ceiling so a hung edge function cannot leave Search spinning forever.
 * Must exceed server catalog budget (~28s) plus cold-start / network slack.
 */
const CLIENT_SEARCH_TIMEOUT_MS = 40_000;
/** Debounce for auto-search so typing doesn't fire a request per keystroke. */
const AUTO_SEARCH_DEBOUNCE_MS = 400;
const PRINT_REGION_STORAGE_KEY = "pokepatch.tcgPrintRegion";
const PRINT_REGIONS = [
  { id: "en", label: "English" },
  { id: "jp", label: "Japanese" },
];

function readStoredPrintRegion() {
  if (typeof window === "undefined") return "en";
  try {
    const raw = window.localStorage.getItem(PRINT_REGION_STORAGE_KEY);
    if (raw === "jp" || raw === "en") return raw;
  } catch {
    // private mode / blocked storage
  }
  return "en";
}

function storePrintRegion(value) {
  try {
    window.localStorage.setItem(PRINT_REGION_STORAGE_KEY, value);
  } catch {
    // ignore
  }
}

function fieldClassName() {
  return "w-full rounded-lg border border-ink/15 bg-cream px-4 py-2 text-ink outline-none focus:border-ink/40";
}

function normalizeSearchInput(value) {
  return value.trim().toLowerCase();
}

function canSearch(cardName, setName) {
  const name = normalizeSearchInput(cardName);
  const set = normalizeSearchInput(setName);
  if (name.length >= 2 && set.length >= MIN_SET_LENGTH) return true;
  if (set.length >= MIN_SET_LENGTH) return true;
  return name.length >= MIN_NAME_ONLY_LENGTH;
}

function searchInputError(cardName, setName) {
  const name = normalizeSearchInput(cardName);
  const set = normalizeSearchInput(setName);
  if (!name && !set) return "Enter a card name or set to search.";
  if (set.length > 0 && name.length < 2) {
    return "Enter a card name, or at least 2 characters in set.";
  }
  if (name.length > 0 && set.length === 0 && name.length < MIN_NAME_ONLY_LENGTH) {
    return `Enter at least ${MIN_NAME_ONLY_LENGTH} characters in card name, or add a set.`;
  }
  if (!canSearch(name, set)) {
    return `Type at least ${MIN_SET_LENGTH} characters in card name or set.`;
  }
  return "";
}

function friendlySearchError(err, append) {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/timed out|abort/i.test(message)) {
    return append
      ? "Couldn't load more cards (timed out). Try again."
      : "Card lookup timed out. Try again.";
  }
  if (/rate limited|429/i.test(message)) {
    return "Card lookup is rate limited. Wait a moment and try again.";
  }
  if (message && !/^request failed/i.test(message) && message.length < 120) {
    return message;
  }
  return append
    ? "Couldn't load more cards. Try again."
    : "Card lookup failed. Try again.";
}

function isJapaneseCard(card) {
  return card?.print_region === "jp" || String(card?.id ?? "").startsWith("jp-");
}

function JpBadge() {
  return (
    <span className="absolute left-1 top-1 rounded bg-ink/80 px-1 py-px font-mono text-[9px] uppercase tracking-[0.14em] text-night">
      JP
    </span>
  );
}

function PrintRegionToggle({ value, onChange, disabled = false }) {
  return (
    <div
      className="inline-flex shrink-0 rounded-lg border border-ink/15 bg-ink/[0.03] p-0.5"
      role="group"
      aria-label="Card language"
    >
      {PRINT_REGIONS.map((region) => {
        const active = value === region.id;
        return (
          <button
            key={region.id}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(region.id)}
            className={`rounded-md px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition disabled:opacity-50 ${
              active ? "bg-ink text-night" : "text-ink/55 hover:text-ink"
            }`}
          >
            {region.label}
          </button>
        );
      })}
    </div>
  );
}

function CardResultButton({ card, selected, onSelect }) {
  const isSelected = selected && card.id === selected.id;
  const imageUrl = tcgCardImageUrl(card);
  return (
    <button
      type="button"
      onClick={() => onSelect(card)}
      className={`flex flex-col overflow-hidden rounded-lg border text-left transition ${
        isSelected
          ? "border-ink/45 bg-ink/15 ring-1 ring-ink/25"
          : "border-ink/10 bg-ink/[0.03] hover:border-ink/25 hover:bg-ink/[0.05]"
      }`}
    >
      <div className={`relative ${CARD_THUMB_ASPECT_CLASS} bg-night/20`}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className={`h-full w-full ${CARD_THUMB_IMAGE_CLASS}`}
          />
        ) : null}
        {isJapaneseCard(card) ? <JpBadge /> : null}
      </div>
      <div className="space-y-0.5 p-2">
        <p className="line-clamp-2 text-xs font-semibold leading-tight text-ink">
          {card.name}
        </p>
        <p className="line-clamp-1 text-[10px] text-ink/55">
          {card.set_name || "Unknown set"} · #{card.number}
        </p>
      </div>
    </button>
  );
}

/**
 * Search the mirrored TCG catalog (English or Japanese) and pick one card.
 *
 * Optional Studio-style mode:
 * - `hideFields` — parent owns card/set inputs; pass `cardName`/`setName` (+ change handlers)
 * - `autoSearch` — search after a short debounce when the query is valid
 * - `collapseOnSelect` — hide the results grid once a card is selected
 */
export default function GalleryCardSearch({
  selectedCard,
  appliedCardId = "",
  onSelect,
  onConfirm,
  onClear,
  confirming = false,
  initialCardName = "",
  initialSetName = "",
  cardName: controlledCardName,
  setName: controlledSetName,
  onCardNameChange,
  onSetNameChange,
  hideFields = false,
  autoSearch = false,
  collapseOnSelect = false,
  disabled = false,
}) {
  const isControlled =
    controlledCardName !== undefined && controlledSetName !== undefined;
  const [internalCardName, setInternalCardName] = useState(initialCardName);
  const [internalSetName, setInternalSetName] = useState(initialSetName);
  const cardName = isControlled ? controlledCardName : internalCardName;
  const setName = isControlled ? controlledSetName : internalSetName;

  function updateCardName(next) {
    if (isControlled) onCardNameChange?.(next);
    else setInternalCardName(next);
  }

  function updateSetName(next) {
    if (isControlled) onSetNameChange?.(next);
    else setInternalSetName(next);
  }

  const [printRegion, setPrintRegion] = useState("en");
  const [regionReady, setRegionReady] = useState(false);
  const [lastQuery, setLastQuery] = useState({
    cardName: "",
    setName: "",
    printRegion: "en",
  });
  const [results, setResults] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setPrintRegion(readStoredPrintRegion());
    setRegionReady(true);
  }, []);

  const runSearch = useCallback(async (nameQuery, setQuery, pageNum, append, region) => {
    if (!canSearch(nameQuery, setQuery)) {
      setResults([]);
      setTotalCount(0);
      setPage(1);
      setError(searchInputError(nameQuery, setQuery));
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CLIENT_SEARCH_TIMEOUT_MS);

    if (append) {
      setLoadingMore(true);
      setError("");
    } else {
      setLoading(true);
      setError("");
      setResults([]);
      setTotalCount(0);
      setPage(1);
    }

    try {
      const payload = await adminSearchGalleryTcg(
        {
          cardName: nameQuery,
          setName: setQuery,
          page: pageNum,
          pageSize: PAGE_SIZE,
          printRegion: region,
        },
        { signal: controller.signal }
      );

      if (requestId !== requestIdRef.current) return;

      setError("");
      setTotalCount(payload.totalCount ?? 0);
      setPage(pageNum);
      setResults((prev) =>
        append ? [...prev, ...(payload.candidates ?? [])] : payload.candidates ?? []
      );
      if (!append && !(payload.candidates?.length)) {
        setError("No cards found.");
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      if (err?.name === "AbortError") {
        if (timedOut) {
          setError(
            append
              ? "Couldn't load more cards (timed out). Try again."
              : "Card lookup timed out. Try again."
          );
        }
        return;
      }
      if (!append) {
        setResults([]);
        setTotalCount(0);
      }
      setError(friendlySearchError(err, append));
    } finally {
      clearTimeout(timeoutId);
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  function submitSearch() {
    const nameQuery = normalizeSearchInput(cardName);
    const setQuery = normalizeSearchInput(setName);
    setLastQuery({ cardName: nameQuery, setName: setQuery, printRegion });
    runSearch(nameQuery, setQuery, 1, false, printRegion);
  }

  function handlePrintRegionChange(next) {
    if (next !== "en" && next !== "jp") return;
    if (next === printRegion) return;
    setPrintRegion(next);
    storePrintRegion(next);
    const nameQuery = normalizeSearchInput(cardName);
    const setQuery = normalizeSearchInput(setName);
    if (canSearch(nameQuery, setQuery)) {
      setLastQuery({ cardName: nameQuery, setName: setQuery, printRegion: next });
      runSearch(nameQuery, setQuery, 1, false, next);
      return;
    }
    setResults([]);
    setTotalCount(0);
    setPage(1);
    setError("");
    setLastQuery({ cardName: "", setName: "", printRegion: next });
  }

  function handleSearchKeyDown(event) {
    if (event.key !== "Enter") return;
    // Stop the keypress reaching an enclosing form, which would submit it.
    event.preventDefault();
    if (disabled || loading) return;
    submitSearch();
  }

  useEffect(() => () => abortRef.current?.abort(), []);

  // Auto-search when the query becomes valid (Studio: type card + set, results appear).
  useEffect(() => {
    if (!autoSearch) return undefined;
    if (!regionReady) return undefined;
    if (disabled) return undefined;
    if (collapseOnSelect && selectedCard?.id) return undefined;

    const nameQuery = normalizeSearchInput(cardName);
    const setQuery = normalizeSearchInput(setName);

    if (!canSearch(nameQuery, setQuery)) {
      // Don't clobber a "No cards found" from a prior valid query while the
      // user is mid-edit below the minimum length — only clear when empty.
      if (!nameQuery && !setQuery) {
        const clearId = setTimeout(() => {
          abortRef.current?.abort();
          setResults([]);
          setTotalCount(0);
          setError("");
          setLastQuery({ cardName: "", setName: "", printRegion });
        }, 0);
        return () => clearTimeout(clearId);
      }
      return undefined;
    }

    if (
      nameQuery === lastQuery.cardName &&
      setQuery === lastQuery.setName &&
      printRegion === lastQuery.printRegion &&
      (results.length > 0 || error === "No cards found." || loading)
    ) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      setLastQuery({ cardName: nameQuery, setName: setQuery, printRegion });
      runSearch(nameQuery, setQuery, 1, false, printRegion);
    }, AUTO_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
    // lastQuery/results/error/loading intentionally omitted — we only react to
    // input + selection. The equality check above prevents repeat fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoSearch,
    collapseOnSelect,
    selectedCard?.id,
    cardName,
    setName,
    printRegion,
    regionReady,
    disabled,
    runSearch,
  ]);

  const hasMore = results.length < totalCount;
  // collapseOnSelect hides an idle results grid after a pick; a new search
  // (including switching English/Japanese) should show matches again.
  const showResults =
    !(collapseOnSelect && selectedCard?.id) ||
    results.length > 0 ||
    loading ||
    Boolean(error);
  const showStatus =
    showResults &&
    Boolean(error || (loading && results.length === 0) || results.length > 0);
  const selectedImageUrl = selectedCard ? tcgCardImageUrl(selectedCard) : "";

  function handleClear() {
    abortRef.current?.abort();
    setResults([]);
    setTotalCount(0);
    setError("");
    setLastQuery({ cardName: "", setName: "", printRegion });
    onClear?.();
  }

  function handleSelect(card) {
    if (collapseOnSelect) {
      abortRef.current?.abort();
      setResults([]);
      setTotalCount(0);
      setError("");
      setLoading(false);
      setLoadingMore(false);
    }
    onSelect?.(card);
  }

  const regionHint =
    printRegion === "jp"
      ? "Japanese printings. Names in English or Japanese; sets by ID (SV2a) or Japanese name."
      : "English printings only.";

  return (
    <div
      className={
        hideFields
          ? "space-y-2 border-t border-ink/10 pt-3"
          : "rounded-lg border border-ink/10 bg-ink/[0.02] p-4"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45">
            {hideFields ? "Catalog language" : "Find card"}
          </p>
          <p className="text-[11px] text-ink/45">{regionHint}</p>
        </div>
        <PrintRegionToggle
          value={printRegion}
          onChange={handlePrintRegionChange}
          disabled={disabled}
        />
      </div>

      {selectedCard?.id && !hideFields && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-ink/15 bg-ink/[0.03] p-3">
          <div className={`relative w-12 shrink-0 overflow-hidden rounded ${CARD_THUMB_ASPECT_CLASS} bg-night/20`}>
            {selectedImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selectedImageUrl}
                alt=""
                className={`h-full w-full ${CARD_THUMB_IMAGE_CLASS}`}
              />
            ) : null}
            {isJapaneseCard(selectedCard) ? <JpBadge /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{selectedCard.name}</p>
            <p className="text-xs text-ink/55">
              {selectedCard.set_name || "Unknown set"} · #{selectedCard.number}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-ink/40">
              {selectedCard.id}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            {appliedCardId !== selectedCard.id && onConfirm && (
              <button
                type="button"
                disabled={disabled || confirming}
                onClick={() => onConfirm(selectedCard)}
                className="rounded-lg bg-ink px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-night transition hover:bg-ink/90 disabled:opacity-50"
              >
                {confirming ? "Applying…" : "Use card"}
              </button>
            )}
            <button
              type="button"
              disabled={disabled || confirming}
              onClick={handleClear}
              className="rounded-lg px-2 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink/45 transition hover:text-ink disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/*
        Deliberately not a <form>: this renders inside the Studio formatter's
        own form, and a nested form is invalid HTML (React flags it as a
        hydration error). It also means the Search button must not be
        type="submit" — that would submit the *outer* form and kick off a
        Generate instead of a search. Enter-to-search is wired on the inputs.
      */}
      {!hideFields ? (
        <div
          role="search"
          className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3 sm:gap-4"
        >
          <label className="block space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45">
              Card name
            </span>
            <input
              type="text"
              value={cardName}
              disabled={disabled}
              onChange={(event) => updateCardName(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              className={fieldClassName()}
              placeholder={
                printRegion === "jp"
                  ? "e.g. Pikachu, ピカチュウ"
                  : "e.g. Pikachu ex, Sylveon-GX"
              }
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45">
              Set
            </span>
            <input
              type="text"
              value={setName}
              disabled={disabled}
              onChange={(event) => updateSetName(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              className={fieldClassName()}
              placeholder={
                printRegion === "jp"
                  ? "e.g. SV2a, 151"
                  : "e.g. Ascended Heroes, Guardians Rising"
              }
              autoComplete="off"
            />
          </label>
          <div className="space-y-1">
            <span
              className="block font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45 opacity-0 select-none"
              aria-hidden="true"
            >
              Search
            </span>
            <button
              type="button"
              onClick={() => {
                if (loading || loadingMore) {
                  abortRef.current?.abort();
                  return;
                }
                submitSearch();
              }}
              disabled={disabled}
              className="w-full rounded-lg bg-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-night transition hover:bg-ink/90 disabled:opacity-50 sm:w-auto sm:whitespace-nowrap"
            >
              {loading || loadingMore ? "Cancel" : "Search"}
            </button>
          </div>
        </div>
      ) : null}

      {showResults && error && !loading && !loadingMore && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-xs font-semibold text-error">{error}</p>
          {lastQuery.cardName || lastQuery.setName ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                runSearch(
                  lastQuery.cardName,
                  lastQuery.setName,
                  1,
                  false,
                  lastQuery.printRegion
                )
              }
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink/55 transition hover:text-ink disabled:opacity-50"
            >
              Retry
            </button>
          ) : null}
        </div>
      )}

      {showResults && loading && results.length === 0 ? (
        <p className="mt-3 text-xs text-ink/45">Searching card catalog…</p>
      ) : null}

      {showResults && results.length > 0 ? (
        <>
          <p className="mt-3 text-xs text-ink/45">
            {totalCount.toLocaleString()} match{totalCount === 1 ? "" : "es"}
            {results.length < totalCount
              ? ` · showing ${results.length}`
              : ""}
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {results.map((card) => (
              <li key={card.id}>
                <CardResultButton
                  card={card}
                  selected={selectedCard}
                  onSelect={handleSelect}
                />
              </li>
            ))}
          </ul>
          {hasMore ? (
            <button
              type="button"
              disabled={disabled || loadingMore || loading}
              onClick={() =>
                runSearch(
                  lastQuery.cardName,
                  lastQuery.setName,
                  page + 1,
                  true,
                  lastQuery.printRegion
                )
              }
              className="mt-3 rounded-lg border border-ink/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink/70 transition hover:border-ink/35 hover:text-ink disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

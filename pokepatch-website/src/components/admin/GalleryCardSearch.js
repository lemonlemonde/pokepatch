"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminSearchGalleryTcg } from "@/lib/adminApi";
import { CARD_THUMB_ASPECT_CLASS, CARD_THUMB_IMAGE_CLASS } from "@/lib/gallery";
import { tcgCardImageUrl } from "@/lib/tcgCardImage";

const PAGE_SIZE = 12;
const MIN_SET_LENGTH = 2;
const MIN_NAME_ONLY_LENGTH = 3;

function fieldClassName() {
  return "w-full rounded-xl border border-ink/15 bg-cream px-4 py-2 text-ink outline-none focus:border-ink/40";
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

function CardResultButton({ card, selected, onSelect }) {
  const isSelected = selected && card.id === selected.id;
  return (
    <button
      type="button"
      onClick={() => onSelect(card)}
      className={`flex flex-col overflow-hidden rounded-lg border text-left transition hover:border-ink/30 ${
        isSelected
          ? "border-blush bg-blush/10 ring-2 ring-blush/40"
          : "border-ink/10 bg-ink/[0.04]"
      }`}
    >
      <div className={`${CARD_THUMB_ASPECT_CLASS} bg-night/20`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={tcgCardImageUrl(card)}
          alt=""
          loading="lazy"
          decoding="async"
          className={`h-full w-full ${CARD_THUMB_IMAGE_CLASS}`}
        />
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
 * Search the full Pokémon TCG API catalog and pick one card for gallery thumbnails.
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
  disabled = false,
}) {
  const [cardName, setCardName] = useState(initialCardName);
  const [setName, setSetName] = useState(initialSetName);
  const [lastQuery, setLastQuery] = useState({ cardName: "", setName: "" });
  const [results, setResults] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef(null);
  const requestIdRef = useRef(0);

  const runSearch = useCallback(async (nameQuery, setQuery, pageNum, append) => {
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

    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError("");
    }

    try {
      const payload = await adminSearchGalleryTcg(
        {
          cardName: nameQuery,
          setName: setQuery,
          page: pageNum,
          pageSize: PAGE_SIZE,
        },
        { signal: controller.signal }
      );

      if (requestId !== requestIdRef.current) return;

      setTotalCount(payload.totalCount ?? 0);
      setPage(pageNum);
      setResults((prev) =>
        append ? [...prev, ...(payload.candidates ?? [])] : payload.candidates ?? []
      );
      if (!append && !(payload.candidates?.length)) {
        setError("No cards found.");
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      if (requestId !== requestIdRef.current) return;
      setResults([]);
      setTotalCount(0);
      setError("No cards found.");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  function submitSearch() {
    const nameQuery = normalizeSearchInput(cardName);
    const setQuery = normalizeSearchInput(setName);
    setLastQuery({ cardName: nameQuery, setName: setQuery });
    runSearch(nameQuery, setQuery, 1, false);
  }

  function handleSearchKeyDown(event) {
    if (event.key !== "Enter") return;
    // Stop the keypress reaching an enclosing form, which would submit it.
    event.preventDefault();
    if (disabled || loading) return;
    submitSearch();
  }

  useEffect(() => () => abortRef.current?.abort(), []);

  const hasMore = results.length < totalCount;

  return (
    <div className="rounded-xl border border-ink/10 bg-night/10 p-4">
      <p className="text-sm font-semibold text-ink">Find card</p>

      {selectedCard?.id && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-blush/40 bg-cream/90 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={tcgCardImageUrl(selectedCard)}
            alt=""
            className={`w-12 shrink-0 rounded ${CARD_THUMB_ASPECT_CLASS} ${CARD_THUMB_IMAGE_CLASS} bg-night/20`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">{selectedCard.name}</p>
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
                className="rounded-lg bg-blush px-3 py-1.5 text-xs font-bold text-cream hover:bg-blush/90 disabled:opacity-50"
              >
                {confirming ? "Applying…" : "Use this card"}
              </button>
            )}
            <button
              type="button"
              disabled={disabled || confirming}
              onClick={onClear}
              className="rounded-lg border border-berry/40 px-2 py-1 text-xs font-semibold text-berry hover:bg-berry/10 disabled:opacity-50"
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
      <div
        role="search"
        className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3 sm:gap-4"
      >
        <label className="block space-y-1">
          <span className="text-xs font-bold uppercase tracking-wide text-ink/60">
            Card name
          </span>
          <input
            type="text"
            value={cardName}
            disabled={disabled || loading}
            onChange={(event) => setCardName(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            className={fieldClassName()}
            placeholder="e.g. Pikachu ex, Sylveon-GX"
            autoComplete="off"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-bold uppercase tracking-wide text-ink/60">
            Set
          </span>
          <input
            type="text"
            value={setName}
            disabled={disabled || loading}
            onChange={(event) => setSetName(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            className={fieldClassName()}
            placeholder="e.g. Ascended Heroes, Guardians Rising"
            autoComplete="off"
          />
        </label>
        <div className="space-y-1">
          <span
            className="block text-xs font-bold uppercase tracking-wide text-ink/60 opacity-0 select-none"
            aria-hidden="true"
          >
            Search
          </span>
          <button
            type="button"
            onClick={submitSearch}
            disabled={disabled || loading}
            className="w-full rounded-xl border border-transparent bg-berry px-4 py-2 text-sm font-semibold text-night transition hover:brightness-110 disabled:opacity-50 sm:w-auto sm:whitespace-nowrap"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </div>

      {error && !loading && (
        <p className="mt-3 text-xs font-semibold text-berry">{error}</p>
      )}

      {!loading && results.length > 0 && (
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
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
          {hasMore && (
            <button
              type="button"
              disabled={disabled || loadingMore}
              onClick={() =>
                runSearch(lastQuery.cardName, lastQuery.setName, page + 1, true)
              }
              className="mt-3 rounded-lg border border-ink/20 bg-cream px-4 py-2 text-xs font-semibold text-ink hover:border-ink/30 disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

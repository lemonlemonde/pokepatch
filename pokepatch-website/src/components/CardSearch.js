"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import useDebouncedValue from "@/lib/useDebouncedValue";
import {
  CARD_THUMB_ASPECT_CLASS,
  CARD_THUMB_IMAGE_CLASS,
} from "@/lib/gallery";

const MIN_QUERY_LENGTH = 3;
const RESULT_LIMIT = 24;

export const CARD_GAMES = [
  { id: "pokemon", label: "Pokémon" },
  { id: "yugioh", label: "Yu-Gi-Oh!" },
  { id: "onepiece", label: "One Piece" },
];

/**
 * Search the local card_catalog and pick one card.
 *
 * Reads via the search_cards RPC, never the upstream APIs — this renders on
 * the public quote form, and the Pokémon API caps anonymous callers at
 * 1000/day.
 */
export default function CardSearch({
  selected,
  onSelect,
  game: gameProp,
  initialQuery = "",
  disabled = false,
}) {
  const [game, setGame] = useState(gameProp ?? CARD_GAMES[0].id);
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery] = useDebouncedValue(query, 250);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);

  const activeGame = gameProp ?? game;

  useEffect(() => {
    const needle = debouncedQuery.trim();
    if (needle.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError("");
      return;
    }
    if (!supabase) {
      setError("Search is unavailable right now.");
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);

    supabase
      .rpc("search_cards", {
        p_query: needle,
        p_game: activeGame,
        p_limit: RESULT_LIMIT,
      })
      .then(({ data, error: rpcError }) => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
        if (rpcError) {
          setResults([]);
          setError("Could not search cards.");
          return;
        }
        setResults(data ?? []);
        setError(data?.length ? "" : "No cards found.");
      });
  }, [debouncedQuery, activeGame]);

  return (
    <div className="rounded-xl border-2 border-ink/10 bg-night/10 p-4">
      {!gameProp && (
        <div className="mb-3 flex flex-wrap gap-2">
          {CARD_GAMES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setGame(option.id)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                option.id === game
                  ? "bg-blush text-cream"
                  : "border border-ink/20 text-ink hover:border-blush"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      <input
        type="search"
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        className="w-full rounded-xl border-2 border-ink/15 bg-cream px-4 py-2 text-ink outline-none focus:border-blush"
        placeholder="Search by card name or set"
        autoComplete="off"
      />

      {loading && <p className="mt-3 text-xs text-ink/45">Searching…</p>}
      {error && !loading && (
        <p className="mt-3 text-xs font-semibold text-berry">{error}</p>
      )}

      {results.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {results.map((card) => {
            const isSelected = selected?.card_id === card.card_id;
            return (
              <li key={`${card.game}:${card.card_id}`}>
                <button
                  type="button"
                  onClick={() => onSelect(card)}
                  className={`flex w-full flex-col overflow-hidden rounded-lg border text-left transition hover:border-blush ${
                    isSelected
                      ? "border-blush bg-blush/10 ring-2 ring-blush/40"
                      : "border-ink/10 bg-cream/80"
                  }`}
                >
                  <div className={`${CARD_THUMB_ASPECT_CLASS} bg-night/20`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={card.image_thumb || card.image_large}
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
                      {card.set_name || "Unknown set"}
                      {card.number ? ` · ${card.number}` : ""}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

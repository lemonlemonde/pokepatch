"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  adminAddCardTimer,
  adminClearCardTimer,
  adminListTimers,
  adminNotifyDueTimers,
} from "@/lib/adminApi";

const ADD_PRESETS = [
  { label: "+1m", minutes: 1 },
  { label: "+5m", minutes: 5 },
  { label: "+15m", minutes: 15 },
  { label: "+1h", minutes: 60 },
  { label: "+1d", minutes: 1440 },
];

/** Match admin-api MAX_TIMER_MINUTES (30 days). */
const MAX_TIMER_MINUTES = 30 * 24 * 60;

function formatRemaining(ms) {
  if (ms <= 0) return "0:00";
  const totalSec = Math.ceil(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) {
    return `${days}d ${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function LoadingIndicator({ label = "Loading…" }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 py-12"
    >
      <div
        aria-hidden="true"
        className="h-10 w-10 animate-spin rounded-full border-4 border-ink/15 border-t-ink border-r-ink"
      />
      <p className="animate-soft-bounce text-sm font-semibold text-ink/70">
        {label}
      </p>
    </div>
  );
}

function TimerRow({
  card,
  nowMs,
  busy,
  customMinutes,
  onCustomMinutesChange,
  onAdd,
  onClear,
  onOpenOrder,
}) {
  const endsAtMs = card.timer_ends_at
    ? new Date(card.timer_ends_at).getTime()
    : null;
  const hasTimer = Number.isFinite(endsAtMs);
  const remainingMs = hasTimer ? endsAtMs - nowMs : null;
  const isDue = hasTimer && remainingMs <= 0;
  const notified = Boolean(card.timer_notified_at);
  const title = String(card.card_name ?? "Untitled card").trim() || "Untitled card";
  const setName = String(card.set_name ?? "").trim();
  const orderLabel =
    card.order_display_id != null ? `#${card.order_display_id}` : "Order";

  return (
    <li className="border-b border-ink/10 py-4 last:border-b-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onOpenOrder(card.order_id)}
            className="text-left font-semibold text-ink transition hover:text-ink"
          >
            {title}
          </button>
          <p className="mt-0.5 text-sm text-ink/55">
            {setName ? `${setName} · ` : ""}
            {orderLabel}
            {card.customer_name ? ` · ${card.customer_name}` : ""}
          </p>
          <p
            className={`mt-2 font-mono text-2xl tracking-tight ${
              isDue
                ? "text-ink"
                : hasTimer
                  ? "text-ink"
                  : "text-ink/35"
            }`}
          >
            {hasTimer
              ? isDue
                ? notified
                  ? "Done · Discord sent"
                  : "Done · notifying…"
                : formatRemaining(remainingMs)
              : "No timer"}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            {ADD_PRESETS.map((preset) => (
              <button
                key={preset.minutes}
                type="button"
                disabled={busy}
                onClick={() => onAdd(card.id, preset.minutes)}
                className="rounded-lg border border-ink/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink/70 transition hover:border-ink/35 hover:text-ink disabled:opacity-50"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`timer-custom-${card.id}`}>
              Custom minutes to add
            </label>
            <input
              id={`timer-custom-${card.id}`}
              type="number"
              min={1}
              max={MAX_TIMER_MINUTES}
              inputMode="numeric"
              placeholder="min"
              value={customMinutes}
              onChange={(event) =>
                onCustomMinutesChange(card.id, event.target.value)
              }
              className="w-20 rounded-lg border border-ink/15 bg-cream px-2 py-1.5 font-mono text-sm text-ink outline-none focus:border-ink/40"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const minutes = Number(customMinutes);
                if (!Number.isFinite(minutes) || minutes <= 0) return;
                onAdd(
                  card.id,
                  Math.min(MAX_TIMER_MINUTES, Math.floor(minutes))
                );
              }}
              className="rounded-lg bg-ink px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-night transition hover:bg-ink/90 disabled:opacity-50"
            >
              Add
            </button>
            {hasTimer && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onClear(card.id)}
                className="rounded-lg px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink/45 transition hover:text-ink disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export default function CardTimers({ onOpenOrder }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [customById, setCustomById] = useState({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const notifyInFlight = useRef(false);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const refresh = useCallback(async () => {
    setError("");
    try {
      const next = await adminListTimers();
      setCards(Array.isArray(next) ? next : []);
    } catch (err) {
      setError(err?.message || "Failed to load timers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const poll = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);

      const dueUnnotified = cardsRef.current.some((card) => {
        if (!card.timer_ends_at || card.timer_notified_at) return false;
        return new Date(card.timer_ends_at).getTime() <= now;
      });
      if (!dueUnnotified || notifyInFlight.current) return;

      notifyInFlight.current = true;
      adminNotifyDueTimers()
        .then(() => refresh())
        .catch(() => {
          // Cron may still catch it; keep "notifying…" until next success.
        })
        .finally(() => {
          notifyInFlight.current = false;
        });
    }, 1000);
    return () => window.clearInterval(tick);
  }, [refresh]);

  async function handleAdd(cardId, minutes) {
    setBusyId(cardId);
    setError("");
    try {
      await adminAddCardTimer(cardId, minutes);
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to add time.");
    } finally {
      setBusyId("");
    }
  }

  async function handleClear(cardId) {
    setBusyId(cardId);
    setError("");
    try {
      await adminClearCardTimer(cardId);
      await refresh();
    } catch (err) {
      setError(err?.message || "Failed to clear timer.");
    } finally {
      setBusyId("");
    }
  }

  if (loading) {
    return <LoadingIndicator label="Loading in-progress cards…" />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      {error && (
        <p className="mb-4 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}

      {cards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink/20 px-4 py-10 text-center text-sm text-ink/55">
          No cards in progress. Mark a card as in progress on an order and it
          will show up here.
        </p>
      ) : (
        <ul className="rounded-xl border border-ink/10 bg-cream/40 px-4">
          {cards.map((card) => (
            <TimerRow
              key={card.id}
              card={card}
              nowMs={nowMs}
              busy={busyId === card.id}
              customMinutes={customById[card.id] ?? ""}
              onCustomMinutesChange={(id, value) =>
                setCustomById((prev) => ({ ...prev, [id]: value }))
              }
              onAdd={handleAdd}
              onClear={handleClear}
              onOpenOrder={onOpenOrder}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

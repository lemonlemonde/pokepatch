"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import MarketingSectionHeading from "@/components/marketing/MarketingSectionHeading";
import LoadingSpinner from "@/components/LoadingSpinner";
import CustomerPriorityBadge from "@/components/CustomerPriorityBadge";
import { ExpandChevron, ExpandPanel } from "@/components/ExpandReveal";
import { useAuth } from "@/contexts/AuthContext";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { CARD_THUMB_ASPECT_CLASS, CARD_THUMB_IMAGE_CLASS } from "@/lib/gallery";
import { labeledDamageTags } from "@/lib/damageTags";
import { fetchPublicQueue } from "@/lib/publicQueue";
import { supabase } from "@/lib/supabaseClient";

const REFRESH_MS = 60_000;
const PREVIEW_NAMES = 4;
const H_SCROLL =
  "overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

function formatUpdatedAt(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(
      date,
    );
  } catch {
    return date.toLocaleTimeString();
  }
}

function cardCountLabel(count) {
  return count === 1 ? "1 card" : `${count} cards`;
}

function parseOrderParam(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function YourOrderLabel({ className = "" }) {
  return (
    <span
      className={`font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-peach ${className}`.trim()}
    >
      Your order
    </span>
  );
}

/** Border/ring for open vs the signed-in user's own order. */
function orderShellClass(open, mine) {
  if (open && mine) {
    return "border-peach/55 bg-peach/[0.08] ring-1 ring-peach/40";
  }
  if (open) {
    return "border-mint/50 ring-1 ring-mint/40";
  }
  if (mine) {
    return "border-peach/45 bg-peach/[0.07] ring-1 ring-peach/30";
  }
  return "border-ink/10 bg-ink/[0.02] hover:border-ink/25";
}

/** Mono micro-label + hairline rule, with optional trailing slot. */
function LaneLabel({ children, trailing, live = false }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <p className="flex shrink-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink/45 sm:text-[11px]">
        {live ? (
          <span
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-status-blue"
            aria-hidden="true"
          />
        ) : null}
        {children}
      </p>
      <div className="h-px min-w-0 flex-1 bg-ink/10" aria-hidden="true" />
      {trailing != null ? (
        <span className="shrink-0 font-mono text-[10px] tabular-nums tracking-[0.14em] text-ink/40">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}

function CardArt({ src, className = "" }) {
  return (
    <div
      className={`${CARD_THUMB_ASPECT_CLASS} shrink-0 overflow-hidden rounded-[4px] bg-night/40 ring-1 ring-ink/10 ${className}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className={`h-full w-full ${CARD_THUMB_IMAGE_CLASS}`}
        />
      ) : null}
    </div>
  );
}

function DamageChips({ tags, chipClassName }) {
  const damage = labeledDamageTags(tags);
  if (!damage.length) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1">
      {damage.map((tag) => (
        <li key={tag.id} className={chipClassName}>
          {tag.label}
        </li>
      ))}
    </ul>
  );
}

/** Full card list for one order: art, name, set, selected damage. */
function CardList({ cards }) {
  if (!cards.length) {
    return <p className="text-xs text-ink/45">No cards on this order.</p>;
  }
  return (
    <ul className="space-y-2.5">
      {cards.map((card, index) => (
        <li
          key={`${card.card_name}-${card.set_name}-${index}`}
          className="flex items-start gap-3"
        >
          <CardArt src={card.catalog_image_url} className="w-14 sm:w-16" />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-sm font-medium leading-snug text-ink">
              {card.card_name || "Untitled card"}
            </p>
            {card.set_name ? (
              <p className="truncate text-xs leading-snug text-ink/50">
                {card.set_name}
              </p>
            ) : null}
            <DamageChips
              tags={card.damage_tags}
              chipClassName="rounded border border-ink/12 bg-ink/[0.04] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-ink/65"
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Horizontal filmstrip of cards for the in-progress detail row. */
function CardFilmstrip({ cards }) {
  if (!cards.length) {
    return <p className="text-xs text-ink/45">No cards on this order.</p>;
  }
  return (
    <ul className={`flex gap-3 pb-1 ${H_SCROLL}`}>
      {cards.map((card, index) => (
        <li
          key={`${card.card_name}-${card.set_name}-${index}`}
          className="w-[5.5rem] shrink-0 sm:w-28"
        >
          <CardArt src={card.catalog_image_url} className="w-full" />
          <p className="mt-1.5 line-clamp-2 text-[11px] font-medium leading-snug text-ink">
            {card.card_name || "Untitled card"}
          </p>
          {card.set_name ? (
            <p className="mt-0.5 line-clamp-1 text-[10px] text-ink/50">
              {card.set_name}
            </p>
          ) : null}
          <DamageChips
            tags={card.damage_tags}
            chipClassName="rounded border border-ink/12 bg-ink/[0.04] px-1 py-0.5 text-[9px] font-semibold leading-none text-ink/65"
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * In progress: one thumbnail per order in a row. Selecting an order opens
 * its full card filmstrip in a single row underneath.
 */
function InProgressStrip({
  orders,
  openId,
  onToggle,
  registerRef,
  mineIds,
}) {
  const selected =
    orders.find((order) => order.display_id === openId) ?? null;
  const panelId = "queue-in-progress-detail";

  return (
    <div>
      <ul className={`flex gap-2.5 pb-1 sm:gap-3 ${H_SCROLL}`}>
        {orders.map((order) => {
          const open = openId === order.display_id;
          const mine = mineIds.has(order.display_id);
          const lead = order.cards[0];
          return (
            <li
              key={order.display_id}
              ref={registerRef(order.display_id)}
              className="shrink-0"
            >
              <button
                type="button"
                onClick={() => onToggle(order.display_id)}
                aria-expanded={open}
                aria-controls={panelId}
                aria-label={`${mine ? "Your order, " : ""}In progress, ${cardCountLabel(order.card_count)}`}
                className={`block w-[4.25rem] rounded-lg border p-1.5 text-left transition sm:w-[4.75rem] ${orderShellClass(open, mine)}`}
              >
                <CardArt
                  src={lead?.catalog_image_url ?? ""}
                  className="w-full"
                />
                <span className="mt-1.5 flex flex-col gap-0.5">
                  {mine ? <YourOrderLabel /> : null}
                  <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink/50">
                    {order.is_priority ? <CustomerPriorityBadge /> : null}
                    <span className="tabular-nums">
                      {cardCountLabel(order.card_count)}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <ExpandPanel open={selected != null}>
        <div
          id={panelId}
          className={`mt-3 rounded-lg border p-3 sm:p-4 ${
            selected && mineIds.has(selected.display_id)
              ? "border-peach/40 bg-peach/[0.05]"
              : "border-ink/10 bg-ink/[0.02]"
          }`}
        >
          {selected && mineIds.has(selected.display_id) ? (
            <p className="mb-2">
              <YourOrderLabel />
            </p>
          ) : null}
          {selected ? <CardFilmstrip cards={selected.cards} /> : null}
        </div>
      </ExpandPanel>
    </div>
  );
}

/** Waiting order: card names in the bar; expands in place for art + damage. */
function QueueRow({ order, laneTitle, open, onToggle, rowRef, mine }) {
  const panelId = `queue-order-${order.display_id}`;
  const preview = order.cards.slice(0, PREVIEW_NAMES);
  const overflow = order.cards.length - preview.length;
  const namePreview = preview
    .map((card) => card.card_name || "Untitled card")
    .join(" · ");

  return (
    <li
      ref={rowRef}
      className={`overflow-hidden rounded-lg border transition-colors ${orderShellClass(open, mine)}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${mine ? "Your order, " : ""}${laneTitle} ${order.lane_position}, ${cardCountLabel(order.card_count)}`}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-ink/[0.07] font-mono text-xs font-semibold tabular-nums text-ink/75">
          {order.lane_position}
        </span>

        <span className="min-w-0 flex-1">
          {mine ? <YourOrderLabel className="mb-0.5 block" /> : null}
          <span className="block truncate text-xs text-ink/70">
            {namePreview || "No cards"}
            {overflow > 0 ? (
              <span className="text-ink/40"> · +{overflow}</span>
            ) : null}
          </span>
        </span>

        <span className="shrink-0 text-xs tabular-nums text-ink/50">
          {cardCountLabel(order.card_count)}
        </span>
        <ExpandChevron open={open} className="h-3.5 w-3.5 text-ink/40" />
      </button>

      <ExpandPanel open={open}>
        <div id={panelId} className="border-t border-ink/10 p-3">
          <CardList cards={order.cards} />
        </div>
      </ExpandPanel>
    </li>
  );
}

function WaitingLane({
  title,
  priority = false,
  emptyLabel,
  orders,
  openId,
  onToggle,
  registerRef,
  mineIds,
}) {
  return (
    <section aria-label={title} className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-medium tracking-tight text-ink">
          {title}
        </h2>
        {priority ? <CustomerPriorityBadge /> : null}
        <span className="font-mono text-[10px] tabular-nums text-ink/40">
          {orders.length}
        </span>
      </div>

      {orders.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink/10 px-3 py-4 text-center text-xs text-ink/45">
          {emptyLabel}
        </p>
      ) : (
        <ol className="space-y-1.5">
          {orders.map((order) => (
            <QueueRow
              key={order.display_id}
              order={order}
              laneTitle={title}
              open={openId === order.display_id}
              mine={mineIds.has(order.display_id)}
              onToggle={() => onToggle(order.display_id)}
              rowRef={registerRef(order.display_id)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function QueuePageInner() {
  const searchParams = useSearchParams();
  const initialOrderId = parseOrderParam(searchParams.get("order"));
  const { user } = useAuth();
  const customerAuthEnabled = isCustomerAuthEnabled();

  const [board, setBoard] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(initialOrderId);
  const [mineIds, setMineIds] = useState(() => new Set());
  const mineUserId =
    customerAuthEnabled && user?.id ? user.id : null;
  const [mineForUserId, setMineForUserId] = useState(mineUserId);

  // Clear highlights immediately when the user signs out (render-time adjust).
  if (mineForUserId !== mineUserId) {
    setMineForUserId(mineUserId);
    if (mineUserId == null) setMineIds(new Set());
  }

  const nodeRefs = useRef(new Map());
  // Only auto-scroll for the landing deep link, never for later clicks.
  const deepLinkScrollDoneRef = useRef(false);

  const registerRef = useCallback(
    (displayId) => (node) => {
      if (node) nodeRefs.current.set(displayId, node);
      else nodeRefs.current.delete(displayId);
    },
    [],
  );

  const refreshQueue = useCallback(() => {
    return fetchPublicQueue()
      .then((data) => {
        if (!data) {
          setLoadError("Queue is unavailable right now.");
          setBoard(null);
          return;
        }
        setBoard(data);
        setUpdatedAt(new Date());
        setLoadError("");
      })
      .catch(() => {
        setLoadError("Couldn't load the queue. Try again in a moment.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    refreshQueue();
  }, [refreshQueue]);

  // Quiet background refresh while the tab is visible.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") refreshQueue();
    };
    const id = window.setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refreshQueue]);

  // Signed-in customer's board orders (To do + In progress) for highlighting.
  useEffect(() => {
    if (!mineUserId || !supabase) return undefined;

    let cancelled = false;

    supabase
      .rpc("get_my_orders")
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const ids = new Set();
        for (const row of data ?? []) {
          if (row.status !== "new" && row.status !== "in_progress") continue;
          const id = Number(row.display_id);
          if (Number.isFinite(id) && id > 0) ids.add(id);
        }
        setMineIds(ids);
      })
      .catch(() => {
        if (!cancelled) setMineIds(new Set());
      });

    return () => {
      cancelled = true;
    };
  }, [mineUserId]);

  // My Orders → View queue: scroll to that order once after the board loads.
  useEffect(() => {
    if (!board || initialOrderId == null || deepLinkScrollDoneRef.current) {
      return;
    }
    const node = nodeRefs.current.get(initialOrderId);
    if (!node) return;
    deepLinkScrollDoneRef.current = true;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [board, initialOrderId]);

  function handleToggle(displayId) {
    const next = openId === displayId ? null : displayId;
    setOpenId(next);
    // Avoid Next router navigation — it can reset scroll / remount Suspense.
    const url =
      next == null
        ? "/queue/"
        : `/queue/?order=${encodeURIComponent(next)}`;
    window.history.replaceState(null, "", url);
  }

  const inProgress = board?.in_progress ?? [];
  const priority = board?.priority ?? [];
  const regular = board?.regular ?? [];
  const waitingCount = priority.length + regular.length;
  const updatedLabel = formatUpdatedAt(updatedAt);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 md:py-12">
      <MarketingSectionHeading
        note="Workshop"
        reveal={false}
        trailing={
          updatedLabel ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/40 tabular-nums">
              Updated {updatedLabel}
              {" · "}
              <button
                type="button"
                onClick={refreshQueue}
                className="underline decoration-ink/25 underline-offset-2 transition hover:text-ink/70"
              >
                Refresh
              </button>
            </p>
          ) : null
        }
      >
        Current queue
      </MarketingSectionHeading>

      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner />
        </div>
      ) : loadError ? (
        <div className="rounded-lg border border-ink/10 bg-ink/[0.02] px-4 py-8 text-center">
          <p className="text-sm text-error">{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              refreshQueue();
            }}
            className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/55 underline decoration-ink/25 underline-offset-2 transition hover:text-ink"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-10 sm:space-y-12">
          <section aria-label="In progress">
            <LaneLabel live trailing={inProgress.length}>
              In progress
            </LaneLabel>
            {inProgress.length === 0 ? (
              <p className="rounded-lg border border-dashed border-ink/10 px-3 py-5 text-center text-xs text-ink/45">
                Nothing on the bench right now.
              </p>
            ) : (
              <InProgressStrip
                orders={inProgress}
                openId={openId}
                onToggle={handleToggle}
                registerRef={registerRef}
                mineIds={mineIds}
              />
            )}
          </section>

          <section aria-label="Waiting">
            <LaneLabel trailing={waitingCount}>Waiting</LaneLabel>
            <div className="grid items-start gap-6 sm:grid-cols-2 sm:gap-8">
              <WaitingLane
                title="Priority"
                priority
                emptyLabel="No priority orders waiting."
                orders={priority}
                openId={openId}
                onToggle={handleToggle}
                registerRef={registerRef}
                mineIds={mineIds}
              />
              <WaitingLane
                title="Standard"
                emptyLabel="No standard orders waiting."
                orders={regular}
                openId={openId}
                onToggle={handleToggle}
                registerRef={registerRef}
                mineIds={mineIds}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default function QueuePage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-24">
          <LoadingSpinner />
        </div>
      }
    >
      <QueuePageInner />
    </Suspense>
  );
}

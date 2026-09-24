"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MarketingSectionHeading from "@/components/marketing/MarketingSectionHeading";
import ScrollReveal from "@/components/marketing/ScrollReveal";
import LoadingSpinner from "@/components/LoadingSpinner";
import CustomerPriorityBadge from "@/components/CustomerPriorityBadge";
import { ExpandChevron, ExpandPanel } from "@/components/ExpandReveal";
import { CARD_THUMB_ASPECT_CLASS, CARD_THUMB_IMAGE_CLASS } from "@/lib/gallery";
import { labeledDamageTags } from "@/lib/damageTags";
import { fetchPublicQueue } from "@/lib/publicQueue";

const REFRESH_MS = 60_000;
const PREVIEW_THUMBS = 4;

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

/** Full card list for one order: art, name, set, selected damage. */
function CardList({ cards }) {
  if (!cards.length) {
    return <p className="text-xs text-ink/45">No cards on this order.</p>;
  }
  return (
    <ul className="space-y-2.5">
      {cards.map((card, index) => {
        const damage = labeledDamageTags(card.damage_tags);
        return (
          <li
            key={`${card.card_name}-${card.set_name}-${index}`}
            className="flex items-start gap-3"
          >
            <CardArt src={card.catalog_image_url} className="w-10" />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="truncate text-sm font-medium leading-snug text-ink">
                {card.card_name || "Untitled card"}
              </p>
              {card.set_name ? (
                <p className="truncate text-xs leading-snug text-ink/50">
                  {card.set_name}
                </p>
              ) : null}
              {damage.length > 0 ? (
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {damage.map((tag) => (
                    <li
                      key={tag.id}
                      className="rounded border border-ink/12 bg-ink/[0.04] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-ink/65"
                    >
                      {tag.label}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Being worked on right now — cards shown outright, nothing to click. */
function InProgressTile({ order, highlighted, tileRef }) {
  return (
    <li
      ref={tileRef}
      className={`rounded-lg border bg-ink/[0.02] p-3 sm:p-4 ${
        highlighted ? "border-mint/50 ring-1 ring-mint/40" : "border-ink/10"
      }`}
    >
      <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink/45">
        {order.is_priority ? <CustomerPriorityBadge /> : null}
        <span>{cardCountLabel(order.card_count)}</span>
      </div>
      <CardList cards={order.cards} />
    </li>
  );
}

/** Waiting order: position + art preview; expands in place to the full list. */
function QueueRow({ order, laneTitle, open, onToggle, rowRef }) {
  const panelId = `queue-order-${order.display_id}`;
  const preview = order.cards.slice(0, PREVIEW_THUMBS);
  const overflow = order.cards.length - preview.length;

  return (
    <li
      ref={rowRef}
      className={`overflow-hidden rounded-lg border bg-ink/[0.02] transition-colors ${
        open
          ? "border-mint/50 ring-1 ring-mint/40"
          : "border-ink/10 hover:border-ink/20"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${laneTitle} ${order.lane_position}, ${cardCountLabel(order.card_count)}`}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-ink/[0.07] font-mono text-xs font-semibold tabular-nums text-ink/75">
          {order.lane_position}
        </span>

        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {preview.map((card, index) => (
            <CardArt
              key={`${card.card_name}-${index}`}
              src={card.catalog_image_url}
              className="w-6"
            />
          ))}
          {overflow > 0 ? (
            <span className="font-mono text-[10px] tabular-nums text-ink/45">
              +{overflow}
            </span>
          ) : null}
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightId = parseOrderParam(searchParams.get("order"));

  const [board, setBoard] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  // Open order; also the mint-ringed one. Seeded from and mirrored to ?order=.
  const [openId, setOpenId] = useState(highlightId);
  const [seenHighlightId, setSeenHighlightId] = useState(highlightId);

  // URL changed underneath us (e.g. My Orders → View queue): open that order.
  // Render-time adjust rather than an effect so there's no extra paint.
  if (highlightId !== seenHighlightId) {
    setSeenHighlightId(highlightId);
    if (highlightId != null) setOpenId(highlightId);
  }

  const nodeRefs = useRef(new Map());
  const scrolledToRef = useRef(null);

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

  // Deep link (My Orders → View queue): bring that order into view once.
  useEffect(() => {
    if (!board || highlightId == null) return;
    if (scrolledToRef.current === highlightId) return;
    const node = nodeRefs.current.get(highlightId);
    if (!node) return;
    scrolledToRef.current = highlightId;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [board, highlightId]);

  function handleToggle(displayId) {
    const next = openId === displayId ? null : displayId;
    setOpenId(next);
    router.replace(
      next == null ? "/queue/" : `/queue/?order=${encodeURIComponent(next)}`,
      { scroll: false },
    );
  }

  const inProgress = board?.in_progress ?? [];
  const priority = board?.priority ?? [];
  const regular = board?.regular ?? [];
  const waitingCount = priority.length + regular.length;
  const updatedLabel = formatUpdatedAt(updatedAt);
  const summary = `${inProgress.length} in progress · ${waitingCount} waiting`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 md:py-12">
      <ScrollReveal>
        <MarketingSectionHeading note="Workshop">
          Current queue
        </MarketingSectionHeading>
      </ScrollReveal>

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
          <ScrollReveal>
            <div className="-mt-4 mb-8 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink/40 sm:-mt-6">
              <p className="tabular-nums text-ink/55">{summary}</p>
              {updatedLabel ? (
                <p className="tabular-nums">
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
              ) : null}
            </div>

            <section aria-label="In progress">
              <LaneLabel live trailing={inProgress.length}>
                In progress
              </LaneLabel>
              {inProgress.length === 0 ? (
                <p className="rounded-lg border border-dashed border-ink/10 px-3 py-5 text-center text-xs text-ink/45">
                  Nothing on the bench right now.
                </p>
              ) : (
                <ul className="grid items-start gap-3 sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
                  {inProgress.map((order) => (
                    <InProgressTile
                      key={order.display_id}
                      order={order}
                      highlighted={openId === order.display_id}
                      tileRef={registerRef(order.display_id)}
                    />
                  ))}
                </ul>
              )}
            </section>
          </ScrollReveal>

          <ScrollReveal>
            <LaneLabel trailing={waitingCount}>Waiting</LaneLabel>
            <div className="grid gap-6 sm:grid-cols-2 sm:gap-8">
              <WaitingLane
                title="Priority"
                priority
                emptyLabel="No priority orders waiting."
                orders={priority}
                openId={openId}
                onToggle={handleToggle}
                registerRef={registerRef}
              />
              <WaitingLane
                title="Standard"
                emptyLabel="No standard orders waiting."
                orders={regular}
                openId={openId}
                onToggle={handleToggle}
                registerRef={registerRef}
              />
            </div>
          </ScrollReveal>
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

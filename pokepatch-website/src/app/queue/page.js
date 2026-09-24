"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MarketingSectionHeading from "@/components/marketing/MarketingSectionHeading";
import ScrollReveal from "@/components/marketing/ScrollReveal";
import LoadingSpinner from "@/components/LoadingSpinner";
import { CARD_THUMB_ASPECT_CLASS, CARD_THUMB_IMAGE_CLASS } from "@/lib/gallery";
import { labeledDamageTags } from "@/lib/damageTags";
import { fetchPublicQueue, fetchPublicQueueOrder } from "@/lib/publicQueue";

function formatUpdatedAt(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function cardCountLabel(count) {
  return count === 1 ? "1 card" : `${count} cards`;
}

function QueueOrderCards({ detail, loading, error, compact = false }) {
  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <LoadingSpinner />
      </div>
    );
  }
  if (error) {
    return <p className="text-sm text-error">{error}</p>;
  }
  if (!detail) {
    return (
      <p className="text-sm text-ink/50">This order is no longer on the board.</p>
    );
  }
  if (!detail.cards.length) {
    return <p className="text-sm text-ink/50">No cards on this order.</p>;
  }

  return (
    <ul
      className={`grid gap-2 ${
        compact
          ? "grid-cols-2 sm:grid-cols-3"
          : "grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8"
      }`}
    >
      {detail.cards.map((card, index) => {
        const damage = labeledDamageTags(card.damage_tags);
        return (
          <li
            key={`${card.card_name}-${card.set_name}-${index}`}
            className="overflow-hidden rounded-md border border-ink/10 bg-ink/[0.02]"
          >
            <div className={`${CARD_THUMB_ASPECT_CLASS} bg-night/25`}>
              {card.catalog_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.catalog_image_url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={`h-full w-full ${CARD_THUMB_IMAGE_CLASS}`}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center px-1 text-center font-mono text-[9px] uppercase tracking-[0.12em] text-ink/30">
                  No art
                </div>
              )}
            </div>
            <div className="space-y-1 p-1.5">
              <p className="line-clamp-2 text-[11px] font-semibold leading-tight text-ink">
                {card.card_name || "Untitled card"}
              </p>
              {card.set_name ? (
                <p className="line-clamp-1 text-[9px] text-ink/50">
                  {card.set_name}
                </p>
              ) : null}
              {damage.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {damage.map((tag) => (
                    <span
                      key={tag.id}
                      className="rounded border border-ink/12 bg-ink/[0.04] px-1 py-0.5 text-[9px] font-semibold leading-none text-ink/70"
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function InProgressStrip({
  orders,
  selectedId,
  onSelect,
  detail,
  detailLoading,
  detailError,
}) {
  const selectedHere =
    detail?.display_id === selectedId && detail?.status === "in_progress";
  const selectedOrder = orders.find((order) => order.display_id === selectedId);

  return (
    <section aria-label="In progress">
      <div className="mb-3 flex items-center gap-3">
        <p className="shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] text-ink/40 sm:text-[11px]">
          In progress
        </p>
        <div className="h-px min-w-0 flex-1 bg-ink/10" aria-hidden="true" />
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink/40">
          <span
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-status-blue"
            aria-hidden="true"
          />
          {orders.length}
        </span>
      </div>

      {orders.length === 0 ? (
        <p className="text-sm text-ink/50">Nothing on the bench right now.</p>
      ) : (
        <ul className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {orders.map((order) => {
            const isOpen = selectedId === order.display_id;
            return (
              <li key={order.display_id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onSelect(isOpen ? null : order.display_id)}
                  aria-expanded={isOpen}
                  aria-label={`In progress ${order.lane_position}, ${cardCountLabel(order.card_count)}`}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${
                    isOpen
                      ? "border-ink/30 bg-ink/[0.06]"
                      : "border-ink/10 bg-cream/50 hover:border-ink/25"
                  }`}
                >
                  {order.is_priority ? (
                    <span
                      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-ink/35 bg-ink/15 px-0.5 text-[8px] font-bold text-ink"
                      title="Priority"
                      aria-hidden="true"
                    >
                      P
                    </span>
                  ) : null}
                  <span className="text-sm font-medium tabular-nums text-ink">
                    {order.lane_position}
                  </span>
                  <span className="text-[10px] text-ink/45">
                    {cardCountLabel(order.card_count)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selectedId != null &&
      (selectedHere ||
        (detailLoading &&
          orders.some((order) => order.display_id === selectedId))) ? (
        <div className="mt-3 rounded-lg border border-ink/10 bg-ink/[0.02] p-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink/40">
            In progress
            {selectedOrder?.lane_position != null
              ? ` · ${selectedOrder.lane_position}`
              : ""}
          </p>
          <QueueOrderCards
            detail={selectedHere ? detail : null}
            loading={detailLoading}
            error={detailError}
          />
        </div>
      ) : null}
    </section>
  );
}

function QueueLaneColumn({
  title,
  emptyLabel,
  orders,
  selectedId,
  onSelect,
}) {
  return (
    <section aria-label={title} className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-medium tracking-tight text-ink sm:text-lg">
          {title}
        </h2>
        <span className="font-mono text-[10px] tabular-nums text-ink/40">
          {orders.length}
        </span>
      </div>

      {orders.length === 0 ? (
        <p className="text-xs text-ink/45">{emptyLabel}</p>
      ) : (
        <ol className="space-y-1.5">
          {orders.map((order) => {
            const isOpen = selectedId === order.display_id;
            return (
              <li key={order.display_id}>
                <button
                  type="button"
                  onClick={() => onSelect(isOpen ? null : order.display_id)}
                  aria-expanded={isOpen}
                  aria-label={`${title} position ${order.lane_position}, ${cardCountLabel(order.card_count)}`}
                  className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition ${
                    isOpen
                      ? "border-ink/30 bg-ink/[0.05]"
                      : "border-ink/10 bg-cream/40 hover:border-ink/25"
                  }`}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-ink/10 font-mono text-[11px] font-semibold tabular-nums text-ink/65">
                    {order.lane_position}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink/50">
                    {cardCountLabel(order.card_count)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function QueuePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderParam = searchParams.get("order");

  const [inProgress, setInProgress] = useState([]);
  const [priority, setPriority] = useState([]);
  const [regular, setRegular] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState(() => {
    const n = Number(orderParam);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const refreshQueue = useCallback(async () => {
    try {
      const data = await fetchPublicQueue();
      if (!data) {
        setLoadError("Queue is unavailable right now.");
        setInProgress([]);
        setPriority([]);
        setRegular([]);
        return;
      }
      setInProgress(data.in_progress);
      setPriority(data.priority);
      setRegular(data.regular);
      setUpdatedAt(new Date());
      setLoadError("");
    } catch {
      setLoadError("Couldn't load the queue. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshQueue();
  }, [refreshQueue]);

  useEffect(() => {
    const n = Number(orderParam);
    if (Number.isFinite(n) && n > 0) {
      setSelectedId(n);
    }
  }, [orderParam]);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      setDetailError("");
      setDetailLoading(false);
      return undefined;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError("");

    fetchPublicQueueOrder(selectedId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
          setDetailError("Couldn't load those cards.");
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  function handleSelect(displayId) {
    setSelectedId(displayId);
    const url =
      displayId == null
        ? "/queue/"
        : `/queue/?order=${encodeURIComponent(displayId)}`;
    router.replace(url, { scroll: false });
  }

  const updatedLabel = formatUpdatedAt(updatedAt);
  const selectedInTodoLane =
    selectedId != null &&
    (priority.some((order) => order.display_id === selectedId) ||
      regular.some((order) => order.display_id === selectedId));
  const selectedInTodo =
    detail?.display_id === selectedId && detail?.status === "new";
  const selectedTodoOrder =
    priority.find((order) => order.display_id === selectedId) ??
    regular.find((order) => order.display_id === selectedId) ??
    null;
  const selectedTodoLaneLabel = selectedTodoOrder
    ? priority.some((order) => order.display_id === selectedId)
      ? "Priority"
      : "Standard"
    : null;

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
        <p className="text-sm text-error">{loadError}</p>
      ) : (
        <div className="space-y-8 sm:space-y-10">
          <ScrollReveal>
            <InProgressStrip
              orders={inProgress}
              selectedId={selectedId}
              onSelect={handleSelect}
              detail={detail}
              detailLoading={detailLoading}
              detailError={detailError}
            />
          </ScrollReveal>

          <ScrollReveal>
            <div className="grid gap-6 sm:grid-cols-2 sm:gap-8">
              <QueueLaneColumn
                title="Priority"
                emptyLabel="No priority orders."
                orders={priority}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
              <QueueLaneColumn
                title="Standard"
                emptyLabel="No standard orders."
                orders={regular}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            </div>

            {selectedInTodoLane ? (
              <div className="mt-4 rounded-lg border border-ink/10 bg-ink/[0.02] p-3">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink/40">
                  {selectedTodoLaneLabel}
                  {selectedTodoOrder?.lane_position != null
                    ? ` · ${selectedTodoOrder.lane_position}`
                    : ""}
                </p>
                <QueueOrderCards
                  detail={selectedInTodo ? detail : null}
                  loading={detailLoading}
                  error={detailError}
                  compact
                />
              </div>
            ) : null}
          </ScrollReveal>

          {updatedLabel ? (
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/35">
              Updated {updatedLabel}
              {" · "}
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  refreshQueue();
                }}
                className="underline decoration-ink/25 underline-offset-2 transition hover:text-ink/55"
              >
                Refresh
              </button>
            </p>
          ) : null}
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

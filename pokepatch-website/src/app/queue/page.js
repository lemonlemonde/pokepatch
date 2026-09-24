"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MarketingSectionHeading from "@/components/marketing/MarketingSectionHeading";
import ScrollReveal from "@/components/marketing/ScrollReveal";
import LoadingSpinner from "@/components/LoadingSpinner";
import { CARD_THUMB_ASPECT_CLASS, CARD_THUMB_IMAGE_CLASS } from "@/lib/gallery";
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

function QueueOrderCards({ detail, loading, error }) {
  if (loading) {
    return (
      <div className="mt-3 flex justify-center py-6">
        <LoadingSpinner />
      </div>
    );
  }
  if (error) {
    return <p className="mt-3 text-sm text-error">{error}</p>;
  }
  if (!detail) {
    return (
      <p className="mt-3 text-sm text-ink/50">
        This order is no longer in the queue.
      </p>
    );
  }
  if (!detail.cards.length) {
    return <p className="mt-3 text-sm text-ink/50">No cards on this order.</p>;
  }

  return (
    <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {detail.cards.map((card, index) => (
        <li
          key={`${card.card_name}-${card.set_name}-${index}`}
          className="overflow-hidden rounded-lg border border-ink/10 bg-ink/[0.02]"
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
              <div className="flex h-full w-full items-center justify-center px-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink/30">
                No art yet
              </div>
            )}
          </div>
          <div className="space-y-0.5 p-2.5">
            <p className="line-clamp-2 text-xs font-semibold leading-tight text-ink">
              {card.card_name || "Untitled card"}
            </p>
            {card.set_name ? (
              <p className="line-clamp-1 text-[10px] text-ink/50">
                {card.set_name}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function QueueLane({
  title,
  note,
  emptyLabel,
  orders,
  selectedId,
  onSelect,
  detail,
  detailLoading,
  detailError,
}) {
  return (
    <section aria-label={title}>
      <MarketingSectionHeading note={note}>{title}</MarketingSectionHeading>
      {orders.length === 0 ? (
        <p className="text-sm text-ink/50">{emptyLabel}</p>
      ) : (
        <ol className="space-y-2">
          {orders.map((order) => {
            const isOpen = selectedId === order.display_id;
            const cardLabel =
              order.card_count === 1
                ? "1 card"
                : `${order.card_count} cards`;
            return (
              <li key={order.display_id}>
                <button
                  type="button"
                  onClick={() =>
                    onSelect(isOpen ? null : order.display_id)
                  }
                  aria-expanded={isOpen}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition sm:px-4 ${
                    isOpen
                      ? "border-ink/30 bg-ink/[0.05]"
                      : "border-ink/10 bg-cream/40 hover:border-ink/25"
                  }`}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-ink/10 font-mono text-sm font-semibold tabular-nums text-ink/70">
                    {order.lane_position}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">
                      Order #{order.display_id}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink/50">
                      {cardLabel}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-ink/40">
                    {isOpen ? "Hide" : "Cards"}
                  </span>
                </button>
                {isOpen ? (
                  <div className="border-x border-b border-ink/10 bg-ink/[0.02] px-3 pb-4 pt-1 sm:px-4">
                    <QueueOrderCards
                      detail={detail}
                      loading={detailLoading}
                      error={detailError}
                    />
                  </div>
                ) : null}
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
        setPriority([]);
        setRegular([]);
        return;
      }
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
        if (!data) {
          setDetailError("");
        }
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12 md:py-16">
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
        <div className="space-y-14 sm:space-y-16">
          <ScrollReveal>
            <QueueLane
              title="Priority queue"
              note="Priority"
              emptyLabel="No priority orders right now."
              orders={priority}
              selectedId={selectedId}
              onSelect={handleSelect}
              detail={detail?.display_id === selectedId ? detail : null}
              detailLoading={detailLoading && selectedId != null}
              detailError={detailError}
            />
          </ScrollReveal>

          <ScrollReveal>
            <QueueLane
              title="Standard queue"
              note="Standard"
              emptyLabel="No standard orders right now."
              orders={regular}
              selectedId={selectedId}
              onSelect={handleSelect}
              detail={detail?.display_id === selectedId ? detail : null}
              detailLoading={detailLoading && selectedId != null}
              detailError={detailError}
            />
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

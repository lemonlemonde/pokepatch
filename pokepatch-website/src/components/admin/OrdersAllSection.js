"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { adminSearchOrders } from "@/lib/adminApi";
import {
  ORDER_STATUSES,
  normalizeOrderStatus,
  normalizeCardStatus,
  orderStatusBadgeClass,
  orderDisplayLabel,
  cardStatusBadgeClass,
  isClosedOrderStatus,
  CARD_STATUSES,
} from "@/lib/orderStatus";
import {
  AccountStatusBadge,
  KanbanThumbImg,
  LoadingIndicator,
  deliveryShortLabel,
  formatDateShort,
} from "@/components/admin/adminShared";

function cardStatusLabel(statusId) {
  const status = normalizeCardStatus(statusId);
  return CARD_STATUSES.find((entry) => entry.id === status)?.label ?? "To do";
}

function truncateText(value, max = 140) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

const ALL_SEARCH_STATUSES = ORDER_STATUSES.map((status) => status.id);

function orderMatchesLocalQuery(order, query) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (String(order.display_id ?? "").includes(q)) return true;
  if (order.customer_name?.toLowerCase().includes(q)) return true;
  if (order.customer_email?.toLowerCase().includes(q)) return true;
  return false;
}

function filterOrdersForAllList(orders, { query, statuses, searchOrderIds }) {
  if (!statuses?.length) return [];

  let list = orders ?? [];

  if (statuses.length < ORDER_STATUSES.length) {
    list = list.filter((order) =>
      statuses.includes(normalizeOrderStatus(order.status))
    );
  }

  const q = query.trim();
  if (q.length >= 2) {
    const idSet = new Set(searchOrderIds ?? []);
    list = list.filter(
      (order) => orderMatchesLocalQuery(order, q) || idSet.has(order.id)
    );
  }

  return list;
}

function OrderCardSearch({ onOpenOrder, onFilterChange }) {
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState(ALL_SEARCH_STATUSES);
  const [results, setResults] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || statuses.length === 0) {
      requestIdRef.current += 1;
      setResults([]);
      setTruncated(false);
      setSearching(false);
      setError("");
      return undefined;
    }

    const requestId = ++requestIdRef.current;
    setSearching(true);
    setError("");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const payload = await adminSearchOrders(q, { statuses });
          if (requestId !== requestIdRef.current) return;
          setResults(payload.results ?? []);
          setTruncated(Boolean(payload.truncated));
          setOpen(true);
        } catch (err) {
          if (requestId !== requestIdRef.current) return;
          setResults([]);
          setTruncated(false);
          setError(err.message || "Search failed.");
          setOpen(true);
        } finally {
          if (requestId === requestIdRef.current) {
            setSearching(false);
          }
        }
      })();
    }, 280);

    return () => window.clearTimeout(timer);
  }, [query, statuses]);

  useEffect(() => {
    if (!onFilterChange) return;
    const q = query.trim();
    onFilterChange({
      query,
      statuses,
      searchOrderIds:
        q.length >= 2
          ? [...new Set(results.map((hit) => hit.order_id))]
          : null,
      searching: q.length >= 2 && searching,
    });
  }, [query, statuses, results, searching, onFilterChange]);

  useEffect(() => {
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function toggleStatus(statusId) {
    setStatuses((current) => {
      if (current.includes(statusId)) {
        return current.filter((id) => id !== statusId);
      }
      return [...current, statusId];
    });
  }

  const allStatusesSelected = statuses.length === ORDER_STATUSES.length;
  const showPanel =
    open && query.trim().length >= 2 && statuses.length > 0;

  return (
    <div ref={rootRef} className="relative z-20">
      <div className="rounded-2xl border border-ink/10 bg-night/30 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <label className="relative min-w-[12rem] flex-1 basis-[14rem]">
            <span className="sr-only">Search cards by name or set</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
              onFocus={() => {
                if (query.trim().length >= 2 && statuses.length > 0) {
                  setOpen(true);
                }
              }}
              placeholder="Search card name, set, or description…"
              className="w-full rounded-xl border border-ink/15 bg-cream px-3.5 py-2.5 pr-10 text-sm text-ink outline-none transition focus:border-ink/40"
              autoComplete="off"
            />
            {searching && (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink/45">
                …
              </span>
            )}
          </label>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:ml-auto">
            <p className="shrink-0 text-xs font-semibold text-ink/50">
              Filter by column
            </p>
            <button
              type="button"
              onClick={() =>
                setStatuses(
                  allStatusesSelected
                    ? []
                    : ORDER_STATUSES.map((status) => status.id)
                )
              }
              className="relative shrink-0 rounded-xl border border-ink/20 px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-ink/30"
            >
              <span className="invisible block" aria-hidden="true">
                Deselect all columns
              </span>
              <span className="absolute inset-0 flex items-center justify-center px-3">
                {allStatusesSelected
                  ? "Deselect all columns"
                  : "Select all columns"}
              </span>
            </button>
            {ORDER_STATUSES.map((status) => {
              const active = statuses.includes(status.id);
              return (
                <button
                  key={status.id}
                  type="button"
                  onClick={() => toggleStatus(status.id)}
                  aria-pressed={active}
                  className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                    active
                      ? orderStatusBadgeClass(status.id)
                      : "border border-ink/15 bg-ink/[0.03] text-ink/45 hover:border-ink/30 hover:text-ink/70"
                  }`}
                >
                  {status.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {showPanel && (
        <div className="absolute left-0 right-0 top-[calc(100%-0.5rem)] z-30 mt-2 max-h-[min(28rem,60vh)] overflow-y-auto rounded-2xl border border-ink/15 bg-cream ">
          {error ? (
            <p className="px-4 py-3 text-sm text-error">{error}</p>
          ) : searching && results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink/50">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink/50">
              No cards matched in the selected columns.
            </p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {results.map((hit) => {
                const orderStatus = normalizeOrderStatus(hit.status);
                const card = hit.card ?? {};
                const description = truncateText(card.description);
                const notes = truncateText(hit.general_notes, 100);
                const previewUrl = card.preview_url ?? null;
                const previewPath = card.preview_path ?? null;
                return (
                  <li key={`${hit.order_id}-${card.id}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onOpenOrder(hit.order_id, { cardId: card.id });
                      }}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-ink/15"
                    >
                      <div className="relative aspect-[3/4] w-11 shrink-0 overflow-hidden rounded-md bg-night/50">
                        {previewUrl ? (
                          <KanbanThumbImg
                            url={previewUrl}
                            storagePath={previewPath}
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold tabular-nums text-ink">
                            #{hit.display_id}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${orderStatusBadgeClass(
                              orderStatus,
                              hit.pending_kind
                            )}`}
                          >
                            {orderDisplayLabel(orderStatus, hit.pending_kind)}
                          </span>
                          <span className="text-sm font-semibold text-ink">
                            {hit.customer_name}
                          </span>
                          <span className="text-xs text-ink/50">
                            {deliveryShortLabel(hit.delivery_method)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-sm font-semibold text-ink">
                            {card.card_name || "Untitled card"}
                          </span>
                          {card.set_name ? (
                            <span className="text-xs text-ink/60">
                              {card.set_name}
                            </span>
                          ) : null}
                          <span
                            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${cardStatusBadgeClass(
                              card.status
                            )}`}
                          >
                            Card: {cardStatusLabel(card.status)}
                          </span>
                        </div>
                        {description ? (
                          <p className="text-xs leading-relaxed text-ink/65">
                            {description}
                          </p>
                        ) : null}
                        {notes ? (
                          <p className="text-xs text-ink/45">
                            Order notes: {notes}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {truncated && !error && (
            <p className="border-t border-ink/10 px-4 py-2 text-xs text-ink/45">
              Showing the first matches — refine the query or column scope for
              more precision.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function OrdersAllList({ orders, onOpenOrder, emptyMessage = "No orders yet." }) {
  const sorted = useMemo(() => {
    return [...(orders ?? [])].sort((a, b) => {
      const aCompleted = a.completed_at
        ? new Date(a.completed_at).getTime()
        : NaN;
      const bCompleted = b.completed_at
        ? new Date(b.completed_at).getTime()
        : NaN;
      const aHasCompleted = !Number.isNaN(aCompleted);
      const bHasCompleted = !Number.isNaN(bCompleted);
      // Most recently completed first; open / never-closed orders last.
      if (aHasCompleted !== bHasCompleted) return aHasCompleted ? -1 : 1;
      if (aHasCompleted && aCompleted !== bCompleted) {
        return bCompleted - aCompleted;
      }
      const aId = Number(a.display_id) || 0;
      const bId = Number(b.display_id) || 0;
      return bId - aId;
    });
  }, [orders]);

  if (sorted.length === 0) {
    return (
      <p className="rounded border border-dashed border-ink/20 px-4 py-10 text-center text-sm text-ink/50">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-ink/20 bg-cream">
      <table className="w-full min-w-[58rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-ink/20 bg-night/40 text-xs font-semibold uppercase tracking-wide text-ink/60">
            <th className="whitespace-nowrap px-3 py-2">#</th>
            <th className="whitespace-nowrap px-3 py-2">Customer</th>
            <th className="whitespace-nowrap px-3 py-2">Email</th>
            <th className="whitespace-nowrap px-3 py-2">Account</th>
            <th className="whitespace-nowrap px-3 py-2">Status</th>
            <th className="whitespace-nowrap px-3 py-2">Cards</th>
            <th className="whitespace-nowrap px-3 py-2">Delivery</th>
            <th className="whitespace-nowrap px-3 py-2">Created</th>
            <th className="whitespace-nowrap px-3 py-2">Closed</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((order) => {
            const status = normalizeOrderStatus(order.status);
            const cardCount = order.card_count ?? order.cards?.length ?? 0;
            return (
              <tr
                key={order.id}
                onClick={() => onOpenOrder(order.id)}
                className="cursor-pointer border-b border-ink/10 odd:bg-night/15 transition hover:bg-ink/20"
              >
                <td className="whitespace-nowrap px-3 py-1.5 font-semibold tabular-nums text-ink">
                  {order.display_id}
                </td>
                <td className="max-w-[12rem] truncate px-3 py-1.5 font-medium text-ink">
                  {order.customer_name}
                </td>
                <td className="max-w-[14rem] truncate px-3 py-1.5 text-ink/70">
                  {order.customer_email || "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <AccountStatusBadge hasAccount={order.has_account} />
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${orderStatusBadgeClass(
                      status,
                      order.pending_kind
                    )}`}
                  >
                    {orderDisplayLabel(status, order.pending_kind)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-ink/80">
                  {cardCount}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-ink/70">
                  {deliveryShortLabel(order.delivery_method)}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-ink/60">
                  {formatDateShort(order.created_at)}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-ink/60">
                  {isClosedOrderStatus(status)
                    ? formatDateShort(order.completed_at) || "—"
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function OrdersAllSection({ orders, onOpenOrder, onBackToBoard }) {
  const [listFilter, setListFilter] = useState({
    query: "",
    statuses: ALL_SEARCH_STATUSES,
    searchOrderIds: null,
    searching: false,
  });

  const filteredOrders = useMemo(
    () => filterOrdersForAllList(orders, listFilter),
    [orders, listFilter]
  );

  const isFiltering =
    listFilter.statuses.length < ORDER_STATUSES.length ||
    listFilter.query.trim().length >= 2;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink/50">
          {isFiltering
            ? `${filteredOrders.length} of ${orders.length} orders`
            : `${orders.length} order${orders.length === 1 ? "" : "s"}`}
        </p>
        <button
          type="button"
          onClick={onBackToBoard}
          className="rounded-xl border border-ink/20 px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-ink/30"
        >
          Back to board
        </button>
      </div>
      <OrderCardSearch
        onFilterChange={setListFilter}
        onOpenOrder={(orderId, options) =>
          onOpenOrder(orderId, { from: "all", ...options })
        }
      />
      {listFilter.searching ? (
        <LoadingIndicator compact label="Searching…" className="px-1" />
      ) : null}
      <OrdersAllList
        orders={filteredOrders}
        emptyMessage={
          isFiltering
            ? "No orders match the current filters."
            : "No orders yet."
        }
        onOpenOrder={(orderId) => onOpenOrder(orderId, { from: "all" })}
      />
    </div>
  );
}


"use client";

import { useCallback, useEffect, useState } from "react";
import { adminListOrders } from "@/lib/adminApi";
import {
  LoadingIndicator,
  formatDate,
} from "@/components/admin/adminShared";
import {
  normalizeOrderStatus,
  orderDisplayLabel,
  orderStatusBadgeClass,
} from "@/lib/orderStatus";
import AdminTaskModule, {
  taskRefreshButtonClassName,
} from "@/components/admin/tasks/AdminTaskModule";

const ALBUM_STATUSES = new Set(["in_progress", "ready"]);

function hasRestorationAlbum(order) {
  return Boolean(order?.has_restoration_album);
}

function sortMissingAlbumOrders(a, b) {
  const statusRank = (status) =>
    normalizeOrderStatus(status) === "in_progress" ? 0 : 1;
  const rankDiff = statusRank(a.status) - statusRank(b.status);
  if (rankDiff !== 0) return rankDiff;
  const aTime = Date.parse(a.status_changed_at || a.created_at || 0) || 0;
  const bTime = Date.parse(b.status_changed_at || b.created_at || 0) || 0;
  return bTime - aTime;
}

export default function AdminPhotoAlbumsTask({ onOpenOrder }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await adminListOrders();
      const missing = (rows ?? [])
        .filter((order) => {
          const status = normalizeOrderStatus(order.status);
          return ALBUM_STATUSES.has(status) && !hasRestorationAlbum(order);
        })
        .sort(sortMissingAlbumOrders);
      setOrders(missing);
    } catch (err) {
      setError(err.message || "Failed to load photo album tasks");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminTaskModule
      eyebrow="Uploads"
      title="Photo albums"
      description="In progress and ready-for-customer orders that still need before and after photos on every active card."
      accent="peach"
      count={loading && orders.length === 0 ? null : orders.length}
      countLabel="Orders missing before/after photos"
      actions={
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className={taskRefreshButtonClassName()}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      {loading && orders.length === 0 ? (
        <LoadingIndicator label="Loading photo albums…" />
      ) : (
        <div className="space-y-3">
          {error ? (
            <p className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </p>
          ) : null}

          {orders.length === 0 && !error ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-ink/15 px-4 py-12 text-center">
              <p className="text-sm font-semibold text-ink/70">
                All caught up
              </p>
              <p className="mt-1 max-w-sm text-sm text-ink/45">
                Every in-progress and ready order has before and after photos
                on each active card.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {orders.map((order) => {
                const status = normalizeOrderStatus(order.status);
                const cardCount = Number(order.card_count) || 0;
                return (
                  <li key={order.id}>
                    <button
                      type="button"
                      onClick={() => onOpenOrder?.(order.id)}
                      className="flex w-full flex-col gap-2 rounded-xl border border-peach/35 bg-peach/10 px-4 py-3 text-left transition hover:border-peach/55 hover:bg-peach/15 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">
                            Order #{order.display_id}
                          </span>
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${orderStatusBadgeClass(
                              order.status,
                              order.pending_kind
                            )}`}
                          >
                            {orderDisplayLabel(status, order.pending_kind)}
                          </span>
                          {cardCount > 0 ? (
                            <span className="text-[11px] font-medium text-ink/45">
                              {cardCount}{" "}
                              {cardCount === 1 ? "card" : "cards"}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block text-sm text-ink/75">
                          {order.customer_name ||
                            order.customer_email ||
                            "Customer"}
                        </span>
                        <span className="mt-1 block text-sm text-ink/55">
                          Missing before/after photos (Discord /cardphoto)
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-ink/45 sm:pt-0.5 sm:text-right">
                        {formatDate(
                          order.status_changed_at || order.created_at
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </AdminTaskModule>
  );
}

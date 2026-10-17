"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminListOrders } from "@/lib/adminApi";
import {
  LoadingIndicator,
  formatDate,
} from "@/components/admin/adminShared";
import {
  CONTRACT_TRACKING_STATUSES,
  normalizeOrderStatus,
  orderDisplayLabel,
  orderStatusBadgeClass,
  tracksOrderContract,
} from "@/lib/orderStatus";
import AdminTaskModule, {
  taskRefreshButtonClassName,
} from "@/components/admin/tasks/AdminTaskModule";

function sortUnsignedContractOrders(a, b) {
  const aTime = Date.parse(a.status_changed_at || a.created_at || 0) || 0;
  const bTime = Date.parse(b.status_changed_at || b.created_at || 0) || 0;
  return bTime - aTime;
}

export default function AdminContractsTask({ onOpenOrder }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await adminListOrders();
      const unsigned = (rows ?? [])
        .filter((order) => {
          const status = normalizeOrderStatus(order.status);
          return tracksOrderContract(status) && !order.contract_signed;
        })
        .sort(sortUnsignedContractOrders);
      setOrders(unsigned);
    } catch (err) {
      setError(err.message || "Failed to load unsigned contracts");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const byStatus = new Map(
      CONTRACT_TRACKING_STATUSES.map((status) => [status.id, []])
    );
    for (const order of orders) {
      const status = normalizeOrderStatus(order.status);
      const list = byStatus.get(status);
      if (list) list.push(order);
    }
    return CONTRACT_TRACKING_STATUSES.map((status) => ({
      status,
      orders: byStatus.get(status.id) ?? [],
    })).filter((group) => group.orders.length > 0);
  }, [orders]);

  return (
    <AdminTaskModule
      eyebrow="Agreements"
      title="Contracts"
      description="To-do, in-progress, and ready-for-customer orders that still need a signed contract."
      accent="mint"
      count={loading && orders.length === 0 ? null : orders.length}
      countLabel="Orders with unsigned contracts"
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
        <LoadingIndicator label="Loading contracts…" />
      ) : (
        <div className="space-y-4">
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
                Every to-do, in-progress, and ready order has a signed
                contract.
              </p>
            </div>
          ) : (
            groups.map(({ status, orders: groupOrders }) => (
              <section key={status.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${orderStatusBadgeClass(
                      status.id
                    )}`}
                  >
                    {orderDisplayLabel(status.id)}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-ink/40">
                    {groupOrders.length}
                  </span>
                </div>
                <ul className="space-y-2">
                  {groupOrders.map((order) => {
                    const cardCount = Number(order.card_count) || 0;
                    return (
                      <li key={order.id}>
                        <button
                          type="button"
                          onClick={() => onOpenOrder?.(order.id)}
                          className="flex w-full flex-col gap-2 rounded-xl border border-mint/35 bg-mint/10 px-4 py-3 text-left transition hover:border-mint/55 hover:bg-mint/15 sm:flex-row sm:items-start sm:justify-between"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-ink">
                                Order #{order.display_id}
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
                              Contract not signed
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
              </section>
            ))
          )}
        </div>
      )}
    </AdminTaskModule>
  );
}

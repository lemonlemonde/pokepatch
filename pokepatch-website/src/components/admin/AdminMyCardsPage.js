"use client";

import { useCallback, useEffect, useState } from "react";
import { adminGetOrderByDisplayId } from "@/lib/adminApi";
import { OWNER_ORDER_DISPLAY_ID } from "@/lib/ownerOrder";
import { LoadingIndicator } from "@/components/admin/adminShared";
import OrderEditorShell from "@/components/admin/orderEditor/OrderEditorShell";

export default function AdminMyCardsPage({ onDirtyChange }) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await adminGetOrderByDisplayId(OWNER_ORDER_DISPLAY_ID);
      setOrder(next);
    } catch (err) {
      setOrder(null);
      setError(err.message || "Could not load my cards.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  if (loading && !order) {
    return <LoadingIndicator label="Loading my cards…" />;
  }

  if (error && !order) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </p>
        <button
          type="button"
          onClick={load}
          className="text-sm font-semibold text-ink transition hover:text-ink/80"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!order) return null;

  return (
    <OrderEditorShell
      variant="my-cards"
      order={order}
      orderId={order.id}
      displayId={order.display_id ?? OWNER_ORDER_DISPLAY_ID}
      onOrderUpdated={(refreshed) => setOrder(refreshed)}
      onDirtyChange={onDirtyChange}
      onError={setError}
      externalError={error}
    />
  );
}

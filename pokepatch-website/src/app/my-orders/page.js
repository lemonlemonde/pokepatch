"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { supabase } from "@/lib/supabaseClient";
import Button from "@/components/Button";
import LoadingSpinner from "@/components/LoadingSpinner";
import SectionHeading from "@/components/SectionHeading";
import OrderCard from "@/components/OrderCard";
import {
  ORDER_STATUSES,
  groupOrdersByStatus,
  orderStatusHeadingClass,
  customerOrderStatusLabel,
  filterOrdersByCompletedVisibility,
} from "@/lib/orderStatus";

export default function MyOrdersPage() {
  const router = useRouter();
  const customerAuthEnabled = isCustomerAuthEnabled();
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState(null);

  useEffect(() => {
    if (!customerAuthEnabled) {
      router.replace("/");
      return;
    }
    if (!authLoading && !user) {
      router.push("/login?redirect=/my-orders");
    }
  }, [customerAuthEnabled, user, authLoading, router]);

  useEffect(() => {
    if (!user || !supabase) return undefined;

    let cancelled = false;
    setLoading(true);

    async function loadOrders() {
      try {
        const { data, error: ordersError } = await supabase.rpc("get_my_orders");
        if (ordersError) throw ordersError;
        const rows = data || [];

        // Message chips/times from customer_messages (not legacy updates_available_at).
        const orderIds = rows.map((row) => row.id).filter(Boolean);
        let unreadOrderIds = new Set();
        /** @type {Map<string, string>} orderId → latest unread sent_at ISO */
        const latestUnreadAtByOrder = new Map();
        /** @type {Map<string, string>} orderId → latest message sent_at ISO */
        const latestMessageAtByOrder = new Map();
        if (orderIds.length > 0) {
          const { data: messageRows, error: messagesError } = await supabase
            .from("customer_messages")
            .select("order_id, sent_at, read_at")
            .in("order_id", orderIds);
          if (messagesError) {
            console.error("Failed to load order messages", messagesError);
          } else {
            for (const row of messageRows ?? []) {
              const orderId = row.order_id;
              if (!orderId) continue;
              const sentAt = row.sent_at;
              if (sentAt) {
                const prev = latestMessageAtByOrder.get(orderId);
                if (
                  !prev ||
                  new Date(sentAt).getTime() > new Date(prev).getTime()
                ) {
                  latestMessageAtByOrder.set(orderId, sentAt);
                }
              }
              if (row.read_at == null) {
                unreadOrderIds.add(orderId);
                if (sentAt) {
                  const prevUnread = latestUnreadAtByOrder.get(orderId);
                  if (
                    !prevUnread ||
                    new Date(sentAt).getTime() > new Date(prevUnread).getTime()
                  ) {
                    latestUnreadAtByOrder.set(orderId, sentAt);
                  }
                }
              }
            }
          }
        }

        if (cancelled) return;
        setOrders(
          rows.map((row) => ({
            ...row,
            has_unread_messages: unreadOrderIds.has(row.id),
            latest_unread_message_at:
              latestUnreadAtByOrder.get(row.id) ?? null,
            latest_message_at: latestMessageAtByOrder.get(row.id) ?? null,
            // Keep legacy keys for chip consumers; messages drive unread now.
            has_new_updates: unreadOrderIds.has(row.id),
            has_admin_photos: unreadOrderIds.has(row.id),
          }))
        );
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Failed to load orders");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadOrders();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    function onMessagesRead(event) {
      const orderId = event?.detail?.orderId;
      if (!orderId) return;
      setOrders((current) =>
        current.map((entry) =>
          entry.id === orderId
            ? {
                ...entry,
                has_unread_messages: false,
                has_new_updates: false,
                has_admin_photos: false,
                latest_message_at:
                  entry.latest_message_at ??
                  entry.latest_unread_message_at ??
                  null,
                latest_unread_message_at: null,
              }
            : entry
        )
      );
    }
    window.addEventListener("pokepatch:messages-read", onMessagesRead);
    return () =>
      window.removeEventListener("pokepatch:messages-read", onMessagesRead);
  }, []);

const visibleOrders = useMemo(
    () => filterOrdersByCompletedVisibility(orders),
    [orders]
  );
  const ordersByStatus = useMemo(
    () => groupOrdersByStatus(visibleOrders),
    [visibleOrders]
  );
  const statusSections = useMemo(
    () =>
      ORDER_STATUSES.flatMap((status) => {
        const sectionOrders = ordersByStatus[status.id] ?? [];
        if (sectionOrders.length === 0) return [];
        return [{ ...status, orders: sectionOrders }];
      }),
    [ordersByStatus]
  );

  if (!customerAuthEnabled || authLoading || !user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="animate-fade-up">
        <SectionHeading subtitle="Track your restoration orders">
          My Orders
        </SectionHeading>
      </div>

      <div className="pixel-border animate-fade-up space-y-6 rounded-2xl bg-cream/60 p-6 [animation-delay:150ms]">
        {loading && <LoadingSpinner label="Loading your orders…" />}

        {error && (
          <p className="rounded-2xl border-2 border-error bg-error/15 px-4 py-3 text-sm font-semibold text-ink">
            {error}
          </p>
        )}

        {!loading && !error && orders.length === 0 && (
          <div className="py-8 text-center">
            <p className="mb-4 text-lg text-ink">
              You don&apos;t have any orders yet
            </p>
            <p className="mb-6 text-sm text-ink/70">
              Orders you submit will automatically be linked to your account if
              you use the same email address.
            </p>
            <Button href="/contact">Submit a restoration request</Button>
          </div>
        )}

        {!loading && !error && orders.length > 0 && (
          <div className="space-y-8">
            <p className="text-sm text-ink/70">
              Click on an order to view details and any updates from our team.
            </p>

            {visibleOrders.length === 0 ? (
              <p className="rounded-xl border border-ink/10 bg-night/20 px-4 py-6 text-center text-sm text-ink/60">
                No recent orders to show.
              </p>
            ) : (
              statusSections.map((section) => (
                <section key={section.id} className="space-y-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2
                      className={`font-display text-lg font-bold ${orderStatusHeadingClass(
                        section.id
                      )}`}
                    >
                      {customerOrderStatusLabel(section.id)}
                    </h2>
                    <span className="text-xs text-ink/60">
                      {section.orders.length}{" "}
                      {section.orders.length === 1 ? "order" : "orders"}
                    </span>
                  </div>
                  <div className="space-y-4">
                    {section.orders.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        onClick={() => {
                          setExpandedOrderId((prev) =>
                            prev === order.id ? null : order.id
                          );
                        }}
                        isExpanded={expandedOrderId === order.id}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        )}

        <div className="border-t border-ink/10 pt-4 text-center">
          <Link
            href="/"
            className="text-sm text-ink/70 hover:text-ink hover:underline"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

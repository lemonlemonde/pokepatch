"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import SectionHeading from "@/components/SectionHeading";
import OrderCard from "@/components/OrderCard";
import { ORDER_STATUSES, groupOrdersByStatus, orderStatusHeadingClass } from "@/lib/orderStatus";

export default function MyOrdersPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login?redirect=/my-orders");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user && supabase) {
      setLoading(true);
      supabase
        .rpc("get_my_orders")
        .then(({ data, error }) => {
          if (error) throw error;
          setOrders(data || []);
        })
        .catch((err) => {
          setError(err.message || "Failed to load orders");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [user]);

  const ordersByStatus = useMemo(() => groupOrdersByStatus(orders), [orders]);
  const statusSections = useMemo(
    () =>
      ORDER_STATUSES.flatMap((status) => {
        const sectionOrders = ordersByStatus[status.id] ?? [];
        if (sectionOrders.length === 0) return [];
        return [{ ...status, orders: sectionOrders }];
      }),
    [ordersByStatus]
  );

  if (authLoading || !user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="font-secondary text-ink/70">Loading...</p>
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
        {loading && (
          <div className="py-8 text-center">
            <p className="font-secondary text-ink/70">Loading your orders...</p>
          </div>
        )}

        {error && (
          <p className="rounded-2xl border-2 border-berry bg-berry/20 px-4 py-3 text-sm font-semibold text-ink">
            {error}
          </p>
        )}

        {!loading && !error && orders.length === 0 && (
          <div className="py-8 text-center">
            <p className="mb-4 font-secondary text-lg text-ink">
              You don&apos;t have any orders yet
            </p>
            <p className="mb-6 font-secondary text-sm text-ink/70">
              Orders you submit will automatically be linked to your account if
              you use the same email address.
            </p>
            <Link
              href="/contact"
              className="inline-block rounded-full bg-blush px-6 py-3 font-bold text-night shadow-cozy transition-all duration-200 ease-out active:translate-y-0.5 active:shadow-cozy-sm sm:hover:-translate-y-1 sm:hover:bg-blush/80 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)]"
            >
              Submit a restoration request
            </Link>
          </div>
        )}

        {!loading && !error && orders.length > 0 && (
          <div className="space-y-8">
            <p className="font-secondary text-sm text-ink/70">
              Click on an order to view details and any updates from our team.
            </p>
            {statusSections.map((section) => (
              <section key={section.id} className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h2
                    className={`font-display text-lg font-bold ${orderStatusHeadingClass(
                      section.id
                    )}`}
                  >
                    {section.label}
                  </h2>
                  <span className="font-secondary text-xs text-ink/45">
                    {section.orders.length}{" "}
                    {section.orders.length === 1 ? "order" : "orders"}
                  </span>
                </div>
                <div className="space-y-4">
                  {section.orders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      onClick={() =>
                        setExpandedOrderId((prev) =>
                          prev === order.id ? null : order.id
                        )
                      }
                      isExpanded={expandedOrderId === order.id}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <div className="border-t border-ink/10 pt-4 text-center">
          <Link
            href="/"
            className="font-secondary text-sm text-ink/70 hover:text-ink hover:underline"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { supabase } from "@/lib/supabaseClient";
import Button from "@/components/Button";
import SectionHeading from "@/components/SectionHeading";
import OrderCard from "@/components/OrderCard";
import {
  ORDER_STATUSES,
  groupOrdersByStatus,
  orderStatusHeadingClass,
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
            <Button href="/contact">Submit a restoration request</Button>
          </div>
        )}

        {!loading && !error && orders.length > 0 && (
          <div className="space-y-8">
            <p className="font-secondary text-sm text-ink/70">
              Click on an order to view details and any updates from our team.
            </p>

            {visibleOrders.length === 0 ? (
              <p className="rounded-xl border border-ink/10 bg-night/20 px-4 py-6 text-center font-secondary text-sm text-ink/60">
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
              ))
            )}
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

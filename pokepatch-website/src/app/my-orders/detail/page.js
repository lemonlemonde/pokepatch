"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import CustomerOrderDetail from "@/components/CustomerOrderDetail";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAuth } from "@/contexts/AuthContext";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { supabase } from "@/lib/supabaseClient";

function MyOrderDetailInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = (searchParams.get("id") || "").trim();
  const customerAuthEnabled = isCustomerAuthEnabled();
  const { user, loading: authLoading } = useAuth();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!customerAuthEnabled) {
      router.replace("/");
      return;
    }
    if (!authLoading && !user) {
      const redirect = orderId
        ? `/my-orders/detail/?id=${encodeURIComponent(orderId)}`
        : "/my-orders/";
      router.push(`/login?redirect=${encodeURIComponent(redirect)}`);
    }
  }, [customerAuthEnabled, user, authLoading, router, orderId]);

  useEffect(() => {
    if (!user || !supabase || !orderId) return undefined;

    let cancelled = false;

    supabase
      .rpc("get_my_order", { p_order_id: orderId })
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) throw loadError;
        setOrder(data);
        setError("");
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setOrder(null);
        setError(err.message || "Failed to load order");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, orderId]);

  if (!customerAuthEnabled || authLoading || !user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  const displayError = orderId ? error : "Missing order id";
  const showSpinner = Boolean(orderId) && loading;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="marketing-panel animate-fade-up p-6">
        {showSpinner ? <LoadingSpinner label="Loading order…" /> : null}

        {displayError ? (
          <div className="space-y-4">
            <p className="rounded-2xl border-2 border-error bg-error/15 px-4 py-3 text-sm font-semibold text-ink">
              {displayError}
            </p>
            <Link
              href="/my-orders/"
              className="text-sm font-semibold text-ink/70 hover:text-ink hover:underline"
            >
              ← Back to My Orders
            </Link>
          </div>
        ) : null}

        {!showSpinner && !displayError && order ? (
          <CustomerOrderDetail
            order={order}
            onOrderChange={(next) => setOrder(next)}
          />
        ) : null}
      </div>
    </div>
  );
}

function MyOrderDetailKeyed() {
  const searchParams = useSearchParams();
  const orderId = (searchParams.get("id") || "").trim();
  return <MyOrderDetailInner key={orderId || "missing"} />;
}

export default function MyOrderDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <LoadingSpinner />
        </div>
      }
    >
      <MyOrderDetailKeyed />
    </Suspense>
  );
}

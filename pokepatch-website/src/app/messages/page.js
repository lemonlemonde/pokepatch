"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { supabase } from "@/lib/supabaseClient";
import LoadingSpinner from "@/components/LoadingSpinner";
import SectionHeading from "@/components/SectionHeading";

function formatMessageTime(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(value);
  }
}

export default function MessagesPage() {
  const router = useRouter();
  const customerAuthEnabled = isCustomerAuthEnabled();
  const { user, loading: authLoading } = useAuth();

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!customerAuthEnabled) {
      router.replace("/");
      return;
    }
    if (!authLoading && !user) {
      router.push("/login?redirect=/messages");
    }
  }, [customerAuthEnabled, user, authLoading, router]);

  useEffect(() => {
    if (!user || !supabase) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    (async () => {
      try {
        const { data, error: loadError } = await supabase
          .from("customer_messages")
          .select("id, subject, body, sent_at, read_at")
          .eq("user_id", user.id)
          .order("sent_at", { ascending: false });
        if (loadError) throw loadError;
        if (cancelled) return;

        const rows = data ?? [];
        setMessages(rows);

        const unreadIds = rows
          .filter((row) => !row.read_at)
          .map((row) => row.id);
        if (unreadIds.length > 0) {
          const { error: markError } = await supabase.rpc(
            "mark_my_messages_read",
            { p_ids: unreadIds }
          );
          if (markError) throw markError;
          if (cancelled) return;
          const now = new Date().toISOString();
          setMessages((prev) =>
            prev.map((row) =>
              unreadIds.includes(row.id) ? { ...row, read_at: now } : row
            )
          );
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("pokepatch:messages-read"));
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Failed to load messages");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!customerAuthEnabled || authLoading || !user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="animate-fade-up">
        <SectionHeading subtitle="Notes and updates from the PokePatch team">
          Messages
        </SectionHeading>
      </div>

      <div className="pixel-border animate-fade-up space-y-4 rounded-2xl bg-cream/60 p-6 [animation-delay:150ms]">
        {error && (
          <p className="rounded-2xl border-2 border-error bg-error/15 px-4 py-3 text-sm font-semibold text-ink">
            {error}
          </p>
        )}
        {loading ? (
          <LoadingSpinner label="Loading messages…" />
        ) : messages.length === 0 ? (
          <p className="text-sm text-ink/70">No messages yet.</p>
        ) : (
          <ul className="space-y-4">
            {messages.map((message) => (
              <li
                key={message.id}
                className="rounded-xl border-2 border-ink/10 bg-night/20 px-4 py-3"
              >
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-bold text-ink">{message.subject}</p>
                  <time
                    dateTime={message.sent_at}
                    className="text-xs text-ink/55"
                  >
                    {formatMessageTime(message.sent_at)}
                  </time>
                </div>
                <p className="whitespace-pre-wrap text-sm text-ink/85">
                  {message.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

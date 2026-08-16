"use client";

import { useCallback, useEffect, useState } from "react";
import { ChangelogDiff } from "@/components/ChangelogDiff";
import { ExpandChevron, ExpandPanel } from "@/components/ExpandReveal";
import { Panel } from "@/components/admin/orderEditor/editorUi";
import { adminMessageHistory } from "@/lib/adminApi";

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

export default function AdminOrderMessagesPanel({ orderId }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async ({ showSpinner = false } = {}) => {
    if (!orderId) return;
    if (showSpinner) setLoading(true);
    setError("");
    try {
      const rows = await adminMessageHistory({ order_id: orderId, limit: 50 });
      setMessages(rows ?? []);
    } catch (err) {
      setError(err.message || "Failed to load messages");
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return undefined;
    let cancelled = false;
    adminMessageHistory({ order_id: orderId, limit: 50 })
      .then((rows) => {
        if (cancelled) return;
        setMessages(rows ?? []);
        setError("");
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Failed to load messages");
        setMessages([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <Panel
      title="Messages"
      action={
        <button
          type="button"
          onClick={() => load({ showSpinner: true })}
          disabled={loading}
          className="text-[10px] font-bold uppercase tracking-wide text-ink/45 transition hover:text-ink disabled:opacity-40"
        >
          Refresh
        </button>
      }
    >
      {loading ? (
        <p className="text-xs text-ink/45">Loading…</p>
      ) : null}
      {error ? <p className="text-xs text-error">{error}</p> : null}
      {!loading && !error && messages.length === 0 ? (
        <p className="text-xs text-ink/40">No messages yet.</p>
      ) : null}
      <ul className="space-y-2">
        {messages.map((message) => {
          const isCustomer = message.sender === "customer";
          const open = expandedId === message.id;
          const changelog = message.changelog;
          const hasChangelog =
            (changelog?.cardGroups?.length ?? 0) > 0 ||
            (changelog?.orderChanges?.length ?? 0) > 0 ||
            Boolean(changelog?.quoteSummary);
          return (
            <li
              key={message.id}
              className={`rounded-lg border px-2.5 py-2 ${
                isCustomer
                  ? "border-sky/30 bg-sky/10"
                  : "border-ink/10 bg-night/20"
              }`}
            >
              <button
                type="button"
                className="flex w-full items-start justify-between gap-2 text-left"
                onClick={() =>
                  setExpandedId((current) =>
                    current === message.id ? null : message.id
                  )
                }
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                        isCustomer
                          ? "bg-sky/25 text-sky"
                          : "bg-ink/10 text-ink/55"
                      }`}
                    >
                      {isCustomer ? "Customer" : "PokePatch"}
                    </span>
                    {message.email_status === "failed" ? (
                      <span className="text-[9px] font-bold uppercase tracking-wide text-ink">
                        Email failed
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-ink">
                    {message.subject || "Message"}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-ink/45">
                    {formatMessageTime(message.sent_at)}
                  </span>
                </span>
                <ExpandChevron open={open} />
              </button>
              <ExpandPanel
                open={open}
                innerClassName="mt-2 border-t border-ink/10 pt-2"
              >
                {message.body ? (
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink/80">
                    {message.body}
                  </p>
                ) : null}
                {hasChangelog ? (
                  <div className={message.body ? "mt-2" : ""}>
                    <ChangelogDiff
                      cardGroups={changelog.cardGroups ?? []}
                      orderChanges={changelog.orderChanges ?? []}
                      quoteSummary={changelog.quoteSummary ?? null}
                    />
                  </div>
                ) : null}
              </ExpandPanel>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

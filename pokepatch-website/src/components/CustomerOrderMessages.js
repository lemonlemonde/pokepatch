"use client";

import { useCallback, useEffect, useState } from "react";
import { ChangelogDiff } from "@/components/ChangelogDiff";
import { ExpandChevron, ExpandPanel } from "@/components/ExpandReveal";
import { supabase } from "@/lib/supabaseClient";

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

function messageBodyText(body) {
  return String(body ?? "")
    .replace(/^Regarding Order #\d+\s*/i, "")
    .trim();
}

async function fetchOrderMessages(orderId) {
  const { data, error } = await supabase
    .from("customer_messages")
    .select("id, subject, body, changelog, sent_at, read_at, sender")
    .eq("order_id", orderId)
    .order("sent_at", { ascending: false });

  if (error) {
    // Older DBs without sender: retry without it.
    if (
      error.code === "PGRST204" ||
      /sender/i.test(error.message || "") ||
      /sender/i.test(error.details || "")
    ) {
      const fallback = await supabase
        .from("customer_messages")
        .select("id, subject, body, changelog, sent_at, read_at")
        .eq("order_id", orderId)
        .order("sent_at", { ascending: false });
      return {
        data: (fallback.data ?? []).map((row) => ({
          ...row,
          sender: "admin",
        })),
        error: fallback.error,
      };
    }
    return { data: [], error };
  }

  return {
    data: (data ?? []).map((row) => ({
      ...row,
      sender: row.sender === "customer" ? "customer" : "admin",
    })),
    error: null,
  };
}

function UpdateChip({ className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-mint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-night ${className}`.trim()}
    >
      New
    </span>
  );
}

export default function CustomerOrderMessages({
  orderId,
  onUnreadChange,
}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listExpanded, setListExpanded] = useState(false);
  const [expandedMessageId, setExpandedMessageId] = useState(null);
  const [highlightedMessageIds, setHighlightedMessageIds] = useState(
    () => new Set()
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  useEffect(() => {
    if (!supabase || !orderId) return undefined;
    let cancelled = false;

    fetchOrderMessages(orderId).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error("Failed to load order messages", error);
        setMessages([]);
        setLoading(false);
        return;
      }
      setMessages(data);
      const unreadAdmin = data.filter(
        (row) => row.sender !== "customer" && !row.read_at
      ).length;
      onUnreadChange?.(unreadAdmin > 0);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [orderId, onUnreadChange]);

  const markMessageRead = useCallback(
    async (messageId) => {
      if (!supabase || !messageId) return;
      const target = messages.find((row) => row.id === messageId);
      if (!target || target.read_at || target.sender === "customer") return;

      try {
        const { error: markError } = await supabase.rpc(
          "mark_my_messages_read",
          { p_ids: [messageId] }
        );
        if (markError) throw markError;

        const now = new Date().toISOString();
        const nextMessages = messages.map((row) =>
          row.id === messageId ? { ...row, read_at: now } : row
        );
        setMessages(nextMessages);
        setHighlightedMessageIds((prev) => {
          if (!prev.has(messageId)) return prev;
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });

        const remainingUnread = nextMessages.filter(
          (row) => row.sender !== "customer" && !row.read_at
        ).length;
        onUnreadChange?.(remainingUnread > 0);

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            remainingUnread === 0
              ? new CustomEvent("pokepatch:messages-read", {
                  detail: { orderId },
                })
              : new Event("pokepatch:messages-read")
          );
        }
      } catch (err) {
        console.error("mark_my_messages_read failed", err);
      }
    },
    [messages, orderId, onUnreadChange]
  );

  async function handleSend(event) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !supabase || sending) return;
    setSending(true);
    setSendError("");
    try {
      const { data, error } = await supabase.rpc("send_my_order_message", {
        p_order_id: orderId,
        p_body: body,
      });
      if (error) throw error;
      setDraft("");
      const row = {
        id: data?.id ?? crypto.randomUUID(),
        subject: data?.subject ?? "Your message",
        body: data?.body ?? body,
        changelog: null,
        sent_at: data?.sent_at ?? new Date().toISOString(),
        read_at: data?.read_at ?? new Date().toISOString(),
        sender: "customer",
      };
      setMessages((prev) => [row, ...prev]);
    } catch (err) {
      setSendError(err.message || "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  function renderMessageRow(message) {
    const isOpen = expandedMessageId === message.id;
    const isCustomer = message.sender === "customer";
    const unread = !isCustomer && !message.read_at;
    const highlighted = highlightedMessageIds.has(message.id);
    const changelog = message.changelog;
    const hasChangelog =
      (changelog?.cardGroups?.length ?? 0) > 0 ||
      (changelog?.orderChanges?.length ?? 0) > 0 ||
      Boolean(changelog?.quoteSummary);
    const body = messageBodyText(message.body);

    return (
      <li key={message.id}>
        <div
          className={`rounded-xl border px-3 py-2.5 transition ${
            isCustomer
              ? "border-ink/10 bg-night/20"
              : unread || highlighted
                ? "border-sky/40 bg-sky/10"
                : "border-ink/10 bg-night/15"
          }`}
        >
          <button
            type="button"
            className="flex w-full items-start justify-between gap-3 text-left"
            onClick={() => {
              const nextOpen = !isOpen;
              setExpandedMessageId(nextOpen ? message.id : null);
              if (nextOpen && unread) {
                setHighlightedMessageIds((prev) => {
                  const next = new Set(prev);
                  next.add(message.id);
                  return next;
                });
                markMessageRead(message.id);
              }
            }}
          >
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink/45">
                  {isCustomer ? "You" : "PokePatch"}
                </span>
                {unread ? <UpdateChip /> : null}
              </span>
              <span className="mt-0.5 block text-sm font-semibold text-ink">
                {message.subject || "Message"}
              </span>
              <span className="mt-0.5 block text-xs text-ink/50">
                {formatMessageTime(message.sent_at)}
              </span>
            </span>
            <ExpandChevron open={isOpen} />
          </button>
          <ExpandPanel open={isOpen} innerClassName="mt-2 border-t border-ink/10 pt-2">
            {body ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/85">
                {body}
              </p>
            ) : null}
            {hasChangelog ? (
              <div className={body ? "mt-3" : ""}>
                <ChangelogDiff
                  cardGroups={changelog.cardGroups ?? []}
                  orderChanges={changelog.orderChanges ?? []}
                  quoteSummary={changelog.quoteSummary ?? null}
                />
              </div>
            ) : null}
          </ExpandPanel>
        </div>
      </li>
    );
  }

  const visible = listExpanded ? messages : messages.slice(0, 3);

  return (
    <section className="rounded-xl border border-sky/35 bg-sky/10">
      <div className="px-3 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-sky">
          Messages
        </p>
        <p className="mt-0.5 text-xs text-ink/55">
          {loading
            ? "Loading…"
            : messages.length > 0
              ? `${messages.length} ${messages.length === 1 ? "message" : "messages"}`
              : "No messages yet — write the team below."}
        </p>
      </div>

      {!loading && messages.length > 0 ? (
        <div className="border-t border-sky/25 px-3 py-3">
          <ul className="space-y-2">{visible.map(renderMessageRow)}</ul>
          {messages.length > 3 ? (
            <button
              type="button"
              onClick={() => setListExpanded((open) => !open)}
              className="mt-2 w-full rounded-lg px-2 py-1.5 text-center text-xs font-semibold text-sky transition hover:bg-sky/15"
            >
              {listExpanded
                ? "Show less"
                : `Show more (${messages.length - 3} older)`}
            </button>
          ) : null}
        </div>
      ) : null}

      <form
        onSubmit={handleSend}
        className="border-t border-sky/25 px-3 py-3"
      >
        <label htmlFor="customer-order-reply" className="sr-only">
          Message the team
        </label>
        <textarea
          id="customer-order-reply"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Message the PokePatch team…"
          className="w-full rounded-xl border border-ink/15 bg-night/30 px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-sky/50 focus:outline-none"
          maxLength={4000}
          disabled={sending}
        />
        {sendError ? (
          <p className="mt-2 text-sm font-semibold text-error">{sendError}</p>
        ) : null}
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="rounded-lg bg-sky px-3 py-1.5 text-sm font-bold text-night transition hover:brightness-110 disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send message"}
          </button>
        </div>
      </form>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { adminMessageHistory, adminSendMessages } from "@/lib/adminApi";

function fieldClassName() {
  return "w-full rounded-xl border border-ink/15 bg-cream px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-mint focus:ring-2 focus:ring-mint/20";
}

function formatSentAt(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(value);
  }
}

function EmailStatusPill({ status, error }) {
  const label = status || "pending";
  const cls =
    label === "sent"
      ? "bg-mint/25 text-night"
      : label === "failed"
        ? "bg-berry/15 text-berry"
        : "bg-ink/10 text-ink/60";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}
      title={error || "Email delivery status"}
    >
      {label === "sent" ? "Emailed" : label}
    </span>
  );
}

function ReadStatusPill({ readAt }) {
  if (readAt) {
    return (
      <span
        className="inline-flex rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/70"
        title={`Opened ${formatSentAt(readAt)}`}
      >
        Seen
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-blush/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/80">
      Unseen
    </span>
  );
}

export function OrderSendUpdateButton({
  open,
  onToggle,
  disabled = false,
  canSend = true,
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled || !canSend}
      title={
        canSend
          ? undefined
          : "Add a customer email on the order before sending an update"
      }
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        open
          ? "border-2 border-ink/30 bg-cream text-ink hover:border-ink/50 hover:bg-ink/[0.05]"
          : "border border-mint/60 bg-mint/15 text-ink hover:border-mint hover:bg-mint/25"
      }`}
    >
      {open ? "Close update" : "Open update"}
    </button>
  );
}

export default function OrderSendUpdatePanel({
  open,
  onClose,
  orderId,
  displayId,
  customerEmail,
  disabled = false,
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sendSummary, setSendSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  const canSend = Boolean(orderId && customerEmail?.trim());

  const loadHistory = useCallback(async () => {
    if (!orderId) return;
    setHistoryLoading(true);
    try {
      const rows = await adminMessageHistory({ order_id: orderId, limit: 20 });
      setHistory(rows);
    } catch (err) {
      console.error("Failed to load message history", err);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (!open) {
      setError("");
      setSendSummary(null);
      setExpandedHistoryId(null);
      setShowAllHistory(false);
      return undefined;
    }
    loadHistory();
    return undefined;
  }, [open, loadHistory]);

  async function handleSend(e) {
    e.preventDefault();
    setError("");
    setSendSummary(null);

    if (!canSend) {
      setError("This order has no customer email");
      return;
    }
    if (!subject.trim()) {
      setError("Subject is required");
      return;
    }
    if (!body.trim()) {
      setError("Message body is required");
      return;
    }

    setSending(true);
    try {
      const payload = await adminSendMessages({
        order_ids: [orderId],
        subject: subject.trim(),
        body,
      });
      setSendSummary(payload);
      if ((payload.failed ?? 0) === 0) {
        setSubject("");
        setBody("");
      }
      await loadHistory();
    } catch (err) {
      setError(err.message || "Failed to send update");
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  const sentOk =
    sendSummary &&
    (sendSummary.failed ?? 0) === 0 &&
    (sendSummary.sent ?? 0) > 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-mint/35 bg-gradient-to-b from-mint/15 to-cream/90 shadow-cozy-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-mint/25 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mint">
            Customer update
          </p>
          <p className="mt-1 text-base font-semibold text-ink">
            Draft a message
            {displayId != null ? (
              <span className="font-normal text-ink/50">
                {" "}
                · Order #{displayId}
              </span>
            ) : null}
          </p>
          <p className="mt-1 truncate text-xs text-ink/55">
            To {customerEmail || "—"} · also shown on My Orders
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={sending}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-ink/50 transition hover:bg-ink/5 hover:text-ink disabled:opacity-40"
        >
          Close
        </button>
      </div>

      <form onSubmit={handleSend} className="space-y-4 px-5 py-4">
        {error ? (
          <p className="rounded-xl border border-berry/30 bg-berry/10 px-3 py-2 text-sm text-berry">
            {error}
          </p>
        ) : null}

        {sendSummary && (sendSummary.failed ?? 0) > 0 ? (
          <div className="rounded-xl border border-berry/30 bg-berry/10 px-3 py-2 text-sm text-berry">
            <p>
              Sent {sendSummary.sent ?? 0}, failed {sendSummary.failed ?? 0}
            </p>
            {Array.isArray(sendSummary.results) &&
              sendSummary.results
                .filter((row) => row.email_status === "failed")
                .slice(0, 3)
                .map((row) => (
                  <p
                    key={`${row.order_id || row.email}-${row.message_id || "none"}`}
                    className="mt-1 text-xs opacity-90"
                  >
                    {row.email_error || "unknown error"}
                  </p>
                ))}
          </div>
        ) : null}

        {sentOk ? (
          <p className="rounded-xl border border-mint/40 bg-mint/20 px-3 py-2 text-sm font-medium text-ink">
            Update sent.
          </p>
        ) : null}

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink/65">
            Subject
          </span>
          <input
            id="order_send_subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={fieldClassName()}
            placeholder="Quick update from PokePatch"
            disabled={sending || disabled}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink/65">
            Message
          </span>
          <textarea
            id="order_send_body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className={`${fieldClassName()} resize-y min-h-[7rem]`}
            placeholder="Write a plain-text message…"
            disabled={sending || disabled}
          />
          <span className="mt-1.5 block text-xs text-ink/45">
            Includes an order line and PokePatch signature in the email.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={sending || disabled}
            className="rounded-xl bg-berry px-5 py-2.5 text-sm font-bold text-night shadow-cozy-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send update"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-ink/60 transition hover:bg-ink/5 hover:text-ink disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </form>

      <div className="border-t border-mint/25 px-5 py-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Previous updates</h3>
          {!historyLoading && history.length > 0 ? (
            <span className="text-xs text-ink/45">
              {history.length} sent
            </span>
          ) : null}
        </div>

        {historyLoading ? (
          <p className="text-sm text-ink/55">Loading history…</p>
        ) : history.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink/15 bg-cream/60 px-3 py-4 text-center text-sm text-ink/50">
            No updates sent for this order yet.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {(showAllHistory
                ? history
                : history.slice(0, 2)
              ).map((row) => {
                const expanded = expandedHistoryId === row.id;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedHistoryId((current) =>
                          current === row.id ? null : row.id
                        )
                      }
                      className={`w-full rounded-xl border px-3.5 py-3 text-left transition ${
                        expanded
                          ? "border-mint/40 bg-cream shadow-sm"
                          : "border-ink/10 bg-cream/70 hover:border-mint/30 hover:bg-cream"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">
                            {row.subject}
                          </p>
                          <p className="mt-0.5 text-xs text-ink/50">
                            {formatSentAt(row.sent_at)}
                            {row.read_at
                              ? ` · Seen ${formatSentAt(row.read_at)}`
                              : null}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <EmailStatusPill
                            status={row.email_status}
                            error={row.email_error}
                          />
                          <ReadStatusPill readAt={row.read_at} />
                          <span
                            className="text-ink/35"
                            aria-hidden="true"
                          >
                            {expanded ? "▾" : "▸"}
                          </span>
                        </div>
                      </div>
                      {expanded ? (
                        <div className="mt-3 border-t border-ink/10 pt-3">
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/85">
                            {row.body || "—"}
                          </p>
                          {row.email_error ? (
                            <p className="mt-2 text-xs text-berry">
                              Error: {row.email_error}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="mt-1.5 line-clamp-1 text-xs text-ink/45">
                          {String(row.body ?? "")
                            .replace(/^Regarding Order #\d+\s*/i, "")
                            .trim() || "—"}
                        </p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {history.length > 2 ? (
              <button
                type="button"
                onClick={() => setShowAllHistory((current) => !current)}
                className="mt-2 w-full rounded-xl px-3 py-2 text-sm font-semibold text-ink/60 transition hover:bg-ink/5 hover:text-ink"
              >
                {showAllHistory
                  ? "Show less"
                  : `See more (${history.length - 2})`}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

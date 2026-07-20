"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  adminListMessageRecipients,
  adminListOrdersForMessageEmail,
  adminMessageHistory,
  adminSendMessages,
} from "@/lib/adminApi";
import { orderStatusLabel } from "@/lib/orderStatus";

function fieldClassName() {
  return "w-full rounded-xl border-2 border-ink/15 bg-cream px-4 py-2 text-ink outline-none focus:border-blush";
}

function LoadingIndicator({ label = "Loading…", className = "" }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}
    >
      <div
        aria-hidden="true"
        className="h-10 w-10 animate-spin rounded-full border-4 border-ink/15 border-t-berry border-r-blush"
      />
      <p className="animate-soft-bounce text-sm font-semibold text-ink/70">{label}</p>
    </div>
  );
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? "").trim());
}

function formatOrderOption(order) {
  const when = order.created_at
    ? new Date(order.created_at).toLocaleDateString(undefined, {
        dateStyle: "medium",
      })
    : "";
  const status = orderStatusLabel(order.status);
  const name = order.customer_name ? ` · ${order.customer_name}` : "";
  return `#${order.display_id}${name} · ${status}${when ? ` · ${when}` : ""}`;
}

export default function BroadcastMessages() {
  const [recipients, setRecipients] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sendSummary, setSendSummary] = useState(null);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");
  const [selectedEmails, setSelectedEmails] = useState(() => new Set());
  const [allUsers, setAllUsers] = useState(false);
  const [customEmail, setCustomEmail] = useState("");
  const [historyFilter, setHistoryFilter] = useState("");
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);

  const [recipientOrders, setRecipientOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextRecipients, nextHistory] = await Promise.all([
        adminListMessageRecipients(),
        adminMessageHistory({ limit: 150 }),
      ]);
      setRecipients(nextRecipients);
      setHistory(nextHistory);
    } catch (err) {
      setError(err.message || "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const singleRecipientEmail = useMemo(() => {
    if (allUsers) return null;
    if (selectedEmails.size !== 1) return null;
    return [...selectedEmails][0];
  }, [allUsers, selectedEmails]);

  useEffect(() => {
    if (!singleRecipientEmail) {
      setRecipientOrders([]);
      setSelectedOrderId("");
      setOrdersLoading(false);
      return undefined;
    }

    let cancelled = false;
    setOrdersLoading(true);
    setSelectedOrderId("");

    adminListOrdersForMessageEmail(singleRecipientEmail)
      .then((orders) => {
        if (!cancelled) setRecipientOrders(orders);
      })
      .catch((err) => {
        if (!cancelled) {
          setRecipientOrders([]);
          setError(err.message || "Failed to load orders for recipient");
        }
      })
      .finally(() => {
        if (!cancelled) setOrdersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [singleRecipientEmail]);

  const filteredRecipients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipients;
    return recipients.filter((row) => {
      const email = String(row.email ?? "").toLowerCase();
      const name = String(row.full_name ?? "").toLowerCase();
      return email.includes(q) || name.includes(q);
    });
  }, [recipients, search]);

  const selectedCount = allUsers ? recipients.length : selectedEmails.size;

  function toggleEmail(email) {
    const normalized = String(email ?? "")
      .trim()
      .toLowerCase();
    if (!normalized) return;
    setAllUsers(false);
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      return next;
    });
  }

  function addCustomEmail() {
    const email = customEmail.trim().toLowerCase();
    if (!isValidEmail(email)) {
      setError("Enter a valid email address");
      return;
    }
    setError("");
    setAllUsers(false);
    setSelectedEmails((prev) => new Set(prev).add(email));
    setCustomEmail("");
  }

  async function handleSend(e) {
    e.preventDefault();
    setError("");
    setSendSummary(null);

    if (!subject.trim()) {
      setError("Subject is required");
      return;
    }
    if (!body.trim()) {
      setError("Message body is required");
      return;
    }
    if (!allUsers && selectedEmails.size === 0) {
      setError("Select at least one recipient, or choose all users");
      return;
    }
    if (selectedOrderId && !singleRecipientEmail) {
      setError("Pick a single recipient to link an order");
      return;
    }

    setSending(true);
    try {
      const payload = await adminSendMessages({
        emails: allUsers ? [] : [...selectedEmails],
        subject: subject.trim(),
        body,
        all_users: allUsers,
        order_id: selectedOrderId || null,
      });
      setSendSummary(payload);
      setSubject("");
      setBody("");
      setSelectedEmails(new Set());
      setAllUsers(false);
      setSelectedOrderId("");
      setRecipientOrders([]);
      const nextHistory = await adminMessageHistory({ limit: 150 });
      setHistory(nextHistory);
    } catch (err) {
      setError(err.message || "Failed to send messages");
    } finally {
      setSending(false);
    }
  }

  const visibleHistory = useMemo(() => {
    const q = historyFilter.trim().toLowerCase();
    if (!q) return history;
    return history.filter((row) => {
      return (
        String(row.recipient_email ?? "")
          .toLowerCase()
          .includes(q) ||
        String(row.subject ?? "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [history, historyFilter]);

  if (loading) {
    return <LoadingIndicator label="Loading messages…" />;
  }

  return (
    <div className="space-y-8">
      {error && (
        <p className="rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
          {error}
        </p>
      )}

      {sendSummary && (sendSummary.failed ?? 0) > 0 && (
        <div className="rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
          <p>
            Sent {sendSummary.sent ?? 0}, failed {sendSummary.failed ?? 0}
          </p>
          {Array.isArray(sendSummary.results) &&
            sendSummary.results
              .filter((row) => row.email_status === "failed")
              .slice(0, 5)
              .map((row) => (
                <p key={`${row.email}-${row.message_id || "none"}`} className="mt-1 text-xs opacity-90">
                  {row.email}: {row.email_error || "unknown error"}
                </p>
              ))}
        </div>
      )}

      <form onSubmit={handleSend} className="space-y-4 rounded-2xl border-2 border-ink/10 bg-cream/50 p-5">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-ink">
              Recipients ({selectedCount})
            </p>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={allUsers}
                onChange={(e) => {
                  setAllUsers(e.target.checked);
                  if (e.target.checked) setSelectedEmails(new Set());
                }}
                disabled={sending || recipients.length === 0}
              />
              Select all signed-up users
            </label>
          </div>

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users by email or name"
            className={fieldClassName()}
            disabled={sending || allUsers}
          />

          <div className="max-h-56 overflow-y-auto rounded-xl border-2 border-ink/10 bg-cream">
            {filteredRecipients.length === 0 ? (
              <p className="px-3 py-4 text-sm text-ink/60">No signed-up users found.</p>
            ) : (
              <ul className="divide-y divide-ink/10">
                {filteredRecipients.map((row) => {
                  const email = String(row.email ?? "").toLowerCase();
                  const checked = allUsers || selectedEmails.has(email);
                  return (
                    <li key={row.user_id || email}>
                      <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-ink/5">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={sending || allUsers}
                          onChange={() => toggleEmail(email)}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block font-semibold text-ink">{email}</span>
                          {row.full_name ? (
                            <span className="block text-xs text-ink/60">{row.full_name}</span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {!allUsers && selectedEmails.size > 0 && (
            <div className="flex flex-wrap gap-2">
              {[...selectedEmails].map((email) => (
                <button
                  key={email}
                  type="button"
                  onClick={() => toggleEmail(email)}
                  className="rounded-full border border-ink/20 bg-night/5 px-3 py-1 text-xs font-semibold text-ink hover:border-blush"
                  disabled={sending}
                >
                  {email} ×
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              value={customEmail}
              onChange={(e) => setCustomEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomEmail();
                }
              }}
              placeholder="Add any email…"
              className={`${fieldClassName()} max-w-sm`}
              disabled={sending || allUsers}
            />
            <button
              type="button"
              onClick={addCustomEmail}
              disabled={sending || allUsers}
              className="rounded-xl border-2 border-ink/20 px-4 py-2 text-sm font-semibold text-ink hover:border-blush disabled:opacity-50"
            >
              Add email
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="broadcast_order" className="mb-1 block text-sm font-bold text-ink">
            Regarding order
          </label>
          <select
            id="broadcast_order"
            value={selectedOrderId}
            onChange={(e) => setSelectedOrderId(e.target.value)}
            className={fieldClassName()}
            disabled={sending || !singleRecipientEmail || ordersLoading}
          >
            <option value="">
              {!singleRecipientEmail
                ? "Select one recipient to choose an order"
                : ordersLoading
                  ? "Loading orders…"
                  : recipientOrders.length === 0
                    ? "No orders for this recipient"
                    : "None / general update"}
            </option>
            {recipientOrders.map((order) => (
              <option key={order.id} value={order.id}>
                {formatOrderOption(order)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink/55">
            Optional. Only available when messaging a single addressee — lists their orders.
          </p>
        </div>

        <div>
          <label htmlFor="broadcast_subject" className="mb-1 block text-sm font-bold text-ink">
            Subject
          </label>
          <input
            id="broadcast_subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={fieldClassName()}
            placeholder="Quick update from PokePatch"
            disabled={sending}
          />
        </div>

        <div>
          <label htmlFor="broadcast_body" className="mb-1 block text-sm font-bold text-ink">
            Message
          </label>
          <textarea
            id="broadcast_body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className={fieldClassName()}
            placeholder="Write a plain-text message…"
            disabled={sending}
          />
          <p className="mt-1 text-xs text-ink/55">
            Emails show your subject once, then
            {selectedOrderId ? " the order line," : ""} your message, then a PokePatch signature
            with links to the site and Instagram.
          </p>
        </div>

        <button
          type="submit"
          disabled={sending}
          className="rounded-xl bg-berry px-5 py-2.5 text-sm font-bold text-night shadow-cozy transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send message"}
        </button>
      </form>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-ink">Send history</h2>
          <input
            type="search"
            value={historyFilter}
            onChange={(e) => setHistoryFilter(e.target.value)}
            placeholder="Filter by email or subject"
            className={`${fieldClassName()} max-w-xs`}
          />
        </div>

        {visibleHistory.length === 0 ? (
          <p className="text-sm text-ink/60">No messages sent yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border-2 border-ink/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-ink/5 text-xs uppercase tracking-wide text-ink/60">
                <tr>
                  <th className="px-3 py-2 font-semibold">Sent</th>
                  <th className="px-3 py-2 font-semibold">To</th>
                  <th className="px-3 py-2 font-semibold">Subject</th>
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Read</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/10 bg-cream/40">
                {visibleHistory.map((row) => {
                  const expanded = expandedHistoryId === row.id;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className="cursor-pointer hover:bg-ink/5"
                        onClick={() =>
                          setExpandedHistoryId((current) =>
                            current === row.id ? null : row.id
                          )
                        }
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-ink/80">
                          <span className="mr-1 inline-block w-3 text-ink/40" aria-hidden="true">
                            {expanded ? "▾" : "▸"}
                          </span>
                          {formatSentAt(row.sent_at)}
                        </td>
                        <td className="px-3 py-2 font-medium text-ink">
                          {row.recipient_email}
                        </td>
                        <td className="max-w-xs truncate px-3 py-2 text-ink" title={row.subject}>
                          {row.subject}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              row.email_status === "sent"
                                ? "font-semibold text-mint"
                                : row.email_status === "failed"
                                  ? "font-semibold text-berry"
                                  : "text-ink/60"
                            }
                            title={row.email_error || undefined}
                          >
                            {row.email_status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-ink/70">
                          {row.read_at ? formatSentAt(row.read_at) : "—"}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-night/15">
                          <td colSpan={5} className="px-3 py-3">
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/50">
                              Message
                            </p>
                            <p className="whitespace-pre-wrap text-sm text-ink/90">
                              {row.body || "—"}
                            </p>
                            {row.email_error ? (
                              <p className="mt-2 text-xs text-berry">
                                Error: {row.email_error}
                              </p>
                            ) : null}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { ChangelogDiff } from "@/components/ChangelogDiff";
import {
  buildOrderChangelog,
  summarizeChangelog,
} from "@/lib/orderChangelog";
import {
  orderStatusBadgeClass,
  orderStatusLabel,
} from "@/lib/orderStatus";

function fieldClassName() {
  return "w-full rounded-xl border border-ink/15 bg-cream px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-mint focus:ring-2 focus:ring-mint/20";
}

function OrderMoveSummary({ summary }) {
  if (!summary) return null;
  const {
    displayId,
    customerName,
    thumbUrl,
    fromStatus,
    toStatus,
    cardCount,
  } = summary;
  const name = String(customerName ?? "").trim() || "—";
  const cardsLabel =
    cardCount == null
      ? null
      : Number(cardCount) === 1
        ? "1 card"
        : `${cardCount} cards`;

  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border border-ink/10 bg-night/20 px-3 py-2.5">
      {thumbUrl ? (
        <div className="aspect-[3/4] w-11 shrink-0 overflow-hidden rounded-md border border-ink/10 bg-night/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink">
          {displayId != null ? `Order #${displayId}` : "Order"}
          <span className="font-semibold text-ink/55"> · {name}</span>
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${orderStatusBadgeClass(
              fromStatus
            )}`}
          >
            {orderStatusLabel(fromStatus)}
          </span>
          <span className="text-[11px] font-semibold text-ink/40" aria-hidden>
            →
          </span>
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${orderStatusBadgeClass(
              toStatus
            )}`}
          >
            {orderStatusLabel(toStatus)}
          </span>
          {cardsLabel ? (
            <span className="text-[11px] text-ink/45">{cardsLabel}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * @param {'save' | 'move'} variant
 * @param {{ displayId?: number|string, customerName?: string, thumbUrl?: string|null, fromStatus?: string, toStatus?: string, cardCount?: number } | null} orderSummary
 */
export default function OrderSaveChangesDialog({
  open,
  variant = "save",
  displayId,
  customerEmail,
  orderSummary = null,
  thumbByCardId = null,
  beforePayload,
  afterPayload,
  saving = false,
  onCancel,
  onConfirm,
}) {
  const built = useMemo(
    () => buildOrderChangelog({ beforePayload, afterPayload }),
    [beforePayload, afterPayload]
  );

  const canNotify = Boolean(customerEmail?.trim());
  const [mode, setMode] = useState("notify"); // 'only' | 'notify'
  const [subject, setSubject] = useState("");
  const [note, setNote] = useState("");
  const [draftChangelog, setDraftChangelog] = useState({
    cardGroups: [],
    orderChanges: [],
    quoteSummary: null,
  });
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setMode(canNotify ? "notify" : "only");
    setSubject(
      built.summary ||
        (displayId != null
          ? `Update on your order #${displayId}`
          : "Update on your order")
    );
    setNote("");
    setDraftChangelog({
      cardGroups: built.cardGroups,
      orderChanges: built.orderChanges,
      quoteSummary: built.quoteSummary,
    });
    setError("");
  }, [open, canNotify, built, displayId]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape" && !saving) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, saving, onCancel]);

  if (!open) return null;

  const onlyLabel = variant === "move" ? "Move only" : "Save only";
  const notifyLabel = variant === "move" ? "Move & notify" : "Save & notify";
  const title =
    variant === "move"
      ? "Move order"
      : displayId != null
        ? `Save order #${displayId}`
        : "Save order";

  const hasDiff =
    (draftChangelog.cardGroups?.length ?? 0) > 0 ||
    (draftChangelog.orderChanges?.length ?? 0) > 0 ||
    Boolean(draftChangelog.quoteSummary);

  function handleConfirm() {
    setError("");
    if (mode === "notify") {
      if (!canNotify) {
        setError("No email on this order — choose Save only, or add an email.");
        return;
      }
      const body = note.trim();
      if (!subject.trim()) {
        setError("Add a subject before notifying.");
        return;
      }
      if (!body && !hasDiff) {
        setError("Add a note or keep at least one diff line before notifying.");
        return;
      }
      onConfirm({
        notify: true,
        subject: subject.trim(),
        body,
        note: body,
        changelog: hasDiff
          ? {
              cardGroups: draftChangelog.cardGroups,
              orderChanges: draftChangelog.orderChanges,
              quoteSummary: draftChangelog.quoteSummary,
            }
          : null,
      });
      return;
    }
    onConfirm({ notify: false });
  }

  const primaryBusy =
    saving && mode === "notify"
      ? "Saving & sending…"
      : saving
        ? variant === "move"
          ? "Moving…"
          : "Saving…"
        : mode === "notify"
          ? notifyLabel
          : onlyLabel;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-night/70 px-4 py-6"
      role="presentation"
      onClick={() => {
        if (!saving) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-order-changes-title"
        className="flex max-h-[min(90vh,48rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border-2 border-ink/15 bg-cream shadow-cozy"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-ink/10 px-5 py-4">
          <h2
            id="save-order-changes-title"
            className="text-xl font-bold text-ink"
          >
            {title}
          </h2>
          {variant === "move" ? (
            <>
              <OrderMoveSummary summary={orderSummary} />
              <p className="mt-2 text-xs text-ink/50">
                Customer gets an email and this appears in Messages.
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-ink/50">
              Customer gets an email and this appears in Messages.
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="rounded-xl border border-berry/30 bg-berry/10 px-3 py-2 text-sm text-berry">
              {error}
            </p>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-ink/10">
            <label
              className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 transition ${
                mode === "only" ? "bg-ink/[0.04]" : "hover:bg-ink/[0.03]"
              }`}
            >
              <input
                type="radio"
                name="notify-mode"
                className="mt-1"
                checked={mode === "only"}
                disabled={saving}
                onChange={() => setMode("only")}
              />
              <span>
                <span className="block text-sm font-semibold text-ink">
                  {onlyLabel}
                </span>
                <span className="mt-0.5 block text-xs text-ink/50">
                  Apply changes without emailing the customer.
                </span>
              </span>
            </label>
            <label
              className={`flex cursor-pointer items-start gap-3 border-t border-ink/8 px-3 py-2.5 transition ${
                mode === "notify" ? "bg-mint/10" : "hover:bg-ink/[0.03]"
              } ${!canNotify ? "opacity-50" : ""}`}
            >
              <input
                type="radio"
                name="notify-mode"
                className="mt-1"
                checked={mode === "notify"}
                disabled={saving || !canNotify}
                onChange={() => setMode("notify")}
              />
              <span>
                <span className="block text-sm font-semibold text-ink">
                  {notifyLabel}
                </span>
                <span className="mt-0.5 block text-xs text-ink/50">
                  {canNotify
                    ? `Email ${customerEmail} and add to Messages.`
                    : "No email on this order."}
                </span>
              </span>
            </label>
          </div>

          {mode === "notify" && canNotify ? (
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-ink">
                  Subject
                </span>
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  disabled={saving}
                  className={fieldClassName()}
                />
              </label>

              <ChangelogDiff
                cardGroups={draftChangelog.cardGroups}
                orderChanges={draftChangelog.orderChanges}
                quoteSummary={draftChangelog.quoteSummary}
                thumbByCardId={thumbByCardId}
                editable
                onChange={(next) => {
                  setDraftChangelog(next);
                  const nextSummary = summarizeChangelog(next);
                  if (nextSummary) setSubject(nextSummary);
                }}
              />

              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-ink">
                  Note
                </span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  disabled={saving}
                  placeholder="Optional message to the customer…"
                  className={fieldClassName()}
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-ink/10 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-xl border-2 border-ink/20 px-4 py-2 text-sm font-semibold text-ink transition hover:border-blush disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="rounded-xl bg-berry px-4 py-2 text-sm font-semibold text-night shadow-cozy transition hover:brightness-110 disabled:opacity-40"
          >
            {primaryBusy}
          </button>
        </div>
      </div>
    </div>
  );
}

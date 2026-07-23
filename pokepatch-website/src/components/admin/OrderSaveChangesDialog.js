"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildCustomerMessageBody,
  buildOrderChangelog,
} from "@/lib/orderChangelog";

function CardChangelogBox({ group }) {
  const isAdded = group.status === "added";
  const isRemoved = group.status === "removed";
  const isModified = group.status === "modified";

  return (
    <div
      className={`overflow-hidden rounded-lg border ${
        isAdded
          ? "border-mint/35 bg-mint/10"
          : isRemoved
            ? "border-berry/30 bg-berry/10"
            : "border-sky/30 bg-sky/10"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-ink/8 px-3 py-2">
        {isAdded ? (
          <span className="text-[10px] font-bold uppercase tracking-wide text-mint">
            New
          </span>
        ) : null}
        {isRemoved ? (
          <span className="text-[10px] font-bold uppercase tracking-wide text-berry">
            Removed
          </span>
        ) : null}
        {isModified ? (
          <span className="text-[10px] font-bold uppercase tracking-wide text-sky">
            Updated
          </span>
        ) : null}
        <p className="text-sm font-semibold text-ink">{group.label}</p>
      </div>
      {group.changes.length > 0 ? (
        <ul className="space-y-1 px-3 py-2.5">
          {group.changes.map((change) => (
            <li key={change} className="text-xs leading-relaxed text-ink/65">
              {change}
            </li>
          ))}
        </ul>
      ) : isAdded ? (
        <p className="px-3 py-2.5 text-xs text-ink/50">Added to order</p>
      ) : isRemoved ? (
        <p className="px-3 py-2.5 text-xs text-ink/50">Removed from order</p>
      ) : null}
    </div>
  );
}

function ChangelogPreview({ cardGroups, orderChanges, quoteSummary, hasChangelog }) {
  if (!hasChangelog) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-ink/10 bg-cream">
      <div className="border-b border-ink/8 px-4 py-2.5">
        <p className="text-sm font-semibold text-ink">Changelog</p>
        {quoteSummary ? (
          <p className="mt-0.5 text-xs text-ink/55">{quoteSummary}</p>
        ) : null}
      </div>
      <div className="space-y-2 px-4 py-3">
        {cardGroups.map((group) => (
          <CardChangelogBox key={group.cardId} group={group} />
        ))}
        {orderChanges.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-ink/10 bg-cream/70">
            <div className="border-b border-ink/8 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-ink/40">
                Order
              </p>
            </div>
            <ul className="space-y-1 px-3 py-2.5">
              {orderChanges.map((change) => (
                <li key={change} className="text-xs leading-relaxed text-ink/65">
                  {change}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NotifyOption({ checked, disabled, onChange, title, description }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition ${
        checked ? "bg-mint/10" : "hover:bg-ink/[0.03]"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink/25 text-berry focus:ring-mint/30"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-ink/50">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export default function OrderSaveChangesDialog({
  open,
  displayId,
  customerEmail,
  beforePayload,
  afterPayload,
  saving = false,
  onCancel,
  onConfirm,
}) {
  const changelog = useMemo(
    () => buildOrderChangelog({ beforePayload, afterPayload }),
    [beforePayload, afterPayload]
  );

  const canNotify = Boolean(customerEmail?.trim());
  const [attachChangelog, setAttachChangelog] = useState(false);
  const [includeMessage, setIncludeMessage] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setAttachChangelog(canNotify && changelog.hasChangelog);
    setIncludeMessage(false);
    setMessage("");
    setError("");
  }, [open, canNotify, changelog.hasChangelog]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape" && !saving) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, saving, onCancel]);

  if (!open) return null;

  const bodyPreview = buildCustomerMessageBody({
    message: includeMessage ? message : "",
    attachChangelog: attachChangelog && changelog.hasChangelog,
    changelogText: changelog.text,
  });
  const willNotify = Boolean(canNotify && bodyPreview.trim());
  const confirmLabel = saving
    ? willNotify
      ? "Saving & sending…"
      : "Saving…"
    : willNotify
      ? "Save & notify"
      : "Save changes";

  function handleConfirm() {
    setError("");
    if (
      includeMessage &&
      !message.trim() &&
      !(attachChangelog && changelog.hasChangelog)
    ) {
      setError("Add a note, or turn off “Add a personal note”.");
      return;
    }
    if (willNotify && !bodyPreview.trim()) {
      setError("Nothing to send — attach the changelog or add a note.");
      return;
    }
    onConfirm({
      notify: willNotify,
      subject: `Update on your order #${displayId}`,
      body: bodyPreview,
    });
  }

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
        className="flex max-h-[min(90vh,44rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border-2 border-ink/15 bg-cream shadow-cozy"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-ink/10 px-5 py-4">
          <h2
            id="save-order-changes-title"
            className="text-xl font-bold text-ink"
          >
            Save order
            {displayId != null ? (
              <span className="font-normal text-ink/45"> #{displayId}</span>
            ) : null}
          </h2>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="rounded-xl border border-berry/30 bg-berry/10 px-3 py-2 text-sm text-berry">
              {error}
            </p>
          ) : null}

          <ChangelogPreview
            cardGroups={changelog.cardGroups}
            orderChanges={changelog.orderChanges}
            quoteSummary={changelog.quoteSummary}
            hasChangelog={changelog.hasChangelog}
          />

          <div>
            <p className="mb-2 text-sm font-semibold text-ink">
              Customer notification
            </p>
            <div className="overflow-hidden rounded-xl border border-ink/10">
              {!canNotify ? (
                <p className="px-4 py-3 text-sm text-ink/50">
                  No email on this order — changes will save without notifying
                  anyone.
                </p>
              ) : (
                <>
                  <div className="border-b border-ink/8 px-4 py-2.5">
                    <p className="text-xs text-ink/50">
                      Optional · sends to{" "}
                      <span className="font-medium text-ink/70">
                        {customerEmail}
                      </span>
                    </p>
                  </div>
                  <div className="divide-y divide-ink/8 p-1">
                    <NotifyOption
                      checked={attachChangelog && changelog.hasChangelog}
                      disabled={saving || !changelog.hasChangelog}
                      onChange={(event) =>
                        setAttachChangelog(event.target.checked)
                      }
                      title="Attach changelog"
                      description={
                        changelog.hasChangelog
                          ? "Quote or card changes the customer should know about."
                          : "No changelog items for this save."
                      }
                    />
                    <NotifyOption
                      checked={includeMessage}
                      disabled={saving}
                      onChange={(event) =>
                        setIncludeMessage(event.target.checked)
                      }
                      title="Add a personal note"
                      description="Optional message alongside the changelog."
                    />
                  </div>
                  {includeMessage ? (
                    <div className="border-t border-ink/8 p-3">
                      <textarea
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        rows={3}
                        disabled={saving}
                        placeholder="Write a short note…"
                        className="w-full resize-y rounded-lg border border-ink/12 bg-cream px-3 py-2 text-sm text-ink outline-none transition focus:border-mint focus:ring-2 focus:ring-mint/20"
                      />
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-ink/10 px-5 py-4">
          <p className="text-xs text-ink/45">
            {willNotify ? "Customer will be emailed." : "Saving without email."}
          </p>
          <div className="flex flex-wrap gap-2">
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
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

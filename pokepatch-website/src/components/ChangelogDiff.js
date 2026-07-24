"use client";

import { useState } from "react";
import {
  CARD_STATUSES,
  ORDER_STATUSES,
  cardStatusBadgeClass,
  orderStatusBadgeClass,
} from "@/lib/orderStatus";

/**
 * Visual changelog: New / Removed / Updated card boxes + order lines.
 * editable=true allows removing groups/lines and editing line text.
 */
/**
 * @param {Record<string, string>} [thumbByCardId] cardId → image URL
 */
export function ChangelogDiff({
  cardGroups = [],
  orderChanges = [],
  quoteSummary = null,
  thumbByCardId = null,
  editable = false,
  onChange,
  className = "",
}) {
  const hasContent =
    cardGroups.length > 0 || orderChanges.length > 0 || Boolean(quoteSummary);

  if (!hasContent) {
    return (
      <p className="rounded-xl border border-dashed border-ink/15 px-4 py-6 text-center text-sm text-ink/45">
        No diff to show
      </p>
    );
  }

  function update(next) {
    onChange?.(next);
  }

  function removeCardGroup(cardId) {
    update({
      cardGroups: cardGroups.filter((g) => g.cardId !== cardId),
      orderChanges,
      quoteSummary,
    });
  }

  function updateCardLine(cardId, lineIndex, text) {
    update({
      cardGroups: cardGroups.map((g) => {
        if (g.cardId !== cardId) return g;
        const changes = [...(g.changes ?? [])];
        changes[lineIndex] = text;
        return { ...g, changes };
      }),
      orderChanges,
      quoteSummary,
    });
  }

  function removeCardLine(cardId, lineIndex) {
    update({
      cardGroups: cardGroups
        .map((g) => {
          if (g.cardId !== cardId) return g;
          return {
            ...g,
            changes: (g.changes ?? []).filter((_, i) => i !== lineIndex),
          };
        })
        .filter(
          (g) =>
            g.status === "added" ||
            g.status === "removed" ||
            (g.changes ?? []).length > 0
        ),
      orderChanges,
      quoteSummary,
    });
  }

  function updateOrderLine(index, text) {
    const next = [...orderChanges];
    next[index] = text;
    update({ cardGroups, orderChanges: next, quoteSummary });
  }

  function removeOrderLine(index) {
    update({
      cardGroups,
      orderChanges: orderChanges.filter((_, i) => i !== index),
      quoteSummary,
    });
  }

  function clearQuoteSummary() {
    update({
      cardGroups,
      orderChanges: orderChanges.filter(
        (line) => !String(line).startsWith("Quote total")
      ),
      quoteSummary: null,
    });
  }

  // Quote total is also listed under Order; only show the header control when
  // it exists and isn't already an order line.
  const quoteInOrder = orderChanges.some((line) =>
    String(line).startsWith("Quote total")
  );
  const showHeaderQuote = Boolean(quoteSummary) && !quoteInOrder;

  return (
    <div
      className={`overflow-hidden rounded-xl border border-ink/10 bg-cream ${className}`}
    >
      <div className="border-b border-ink/8 px-4 py-2.5">
        <p className="text-sm font-semibold text-ink">Changes</p>
        {showHeaderQuote ? (
          <div className="mt-1 flex items-start justify-between gap-2">
            <div className="text-xs text-ink/55">
              <DiffText text={quoteSummary} />
            </div>
            {editable ? (
              <button
                type="button"
                onClick={clearQuoteSummary}
                className="shrink-0 text-[11px] font-semibold text-ink/40 transition hover:text-berry"
              >
                Remove
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="space-y-2 px-4 py-3">
        {orderChanges.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-lavender/35 bg-lavender/10">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/8 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-lavender">
                Order
              </p>
              {editable && quoteInOrder ? (
                <button
                  type="button"
                  onClick={clearQuoteSummary}
                  className="text-[11px] font-semibold text-ink/40 transition hover:text-berry"
                >
                  Remove quote total
                </button>
              ) : null}
            </div>
            <ul className="space-y-1.5 px-3 py-2.5">
              {orderChanges.map((change, index) => (
                <DiffLine
                  key={`order-${index}`}
                  text={change}
                  editable={editable}
                  onChange={(text) => updateOrderLine(index, text)}
                  onRemove={() => removeOrderLine(index)}
                />
              ))}
            </ul>
          </div>
        ) : null}
        {cardGroups.map((group) => (
          <CardChangelogBox
            key={group.cardId}
            group={group}
            thumbUrl={thumbByCardId?.[group.cardId] ?? null}
            editable={editable}
            onRemoveGroup={() => removeCardGroup(group.cardId)}
            onUpdateLine={(lineIndex, text) =>
              updateCardLine(group.cardId, lineIndex, text)
            }
            onRemoveLine={(lineIndex) =>
              removeCardLine(group.cardId, lineIndex)
            }
          />
        ))}
      </div>
    </div>
  );
}

function CardChangelogBox({
  group,
  thumbUrl = null,
  editable,
  onRemoveGroup,
  onUpdateLine,
  onRemoveLine,
}) {
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
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <p className="min-w-0 truncate text-sm font-semibold text-ink">
            {group.label}
          </p>
          {thumbUrl ? (
            <div className="aspect-[3/4] w-8 shrink-0 overflow-hidden rounded border border-ink/10 bg-night/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
          ) : null}
        </div>
        {editable ? (
          <button
            type="button"
            onClick={onRemoveGroup}
            className="shrink-0 text-[11px] font-semibold text-ink/40 transition hover:text-berry"
          >
            Remove
          </button>
        ) : null}
      </div>
      {(group.changes ?? []).length > 0 ? (
        <ul className="space-y-1.5 px-3 py-2.5">
          {group.changes.map((change, index) => (
            <DiffLine
              key={`${group.cardId}-${index}`}
              text={change}
              editable={editable}
              onChange={(text) => onUpdateLine(index, text)}
              onRemove={() => onRemoveLine(index)}
            />
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

function DiffLine({ text, editable, onChange, onRemove }) {
  const [editing, setEditing] = useState(false);

  if (editable && editing) {
    return (
      <li className="flex items-start gap-2">
        <input
          value={text}
          autoFocus
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-ink/10 bg-cream px-2 py-1 text-xs text-ink outline-none focus:border-mint focus:ring-1 focus:ring-mint/20"
        />
        <button
          type="button"
          onClick={onRemove}
          className="mt-0.5 shrink-0 text-[11px] font-semibold text-ink/35 transition hover:text-berry"
          aria-label="Remove line"
        >
          ×
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-2 text-xs leading-relaxed text-ink/65">
      <div className="min-w-0 flex-1">
        <DiffText text={text} />
      </div>
      {editable ? (
        <span className="mt-0.5 flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[11px] font-semibold text-ink/35 transition hover:text-ink/70"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-[11px] font-semibold text-ink/35 transition hover:text-berry"
            aria-label="Remove line"
          >
            ×
          </button>
        </span>
      ) : null}
    </li>
  );
}

function DiffText({ text }) {
  const raw = String(text ?? "");
  const arrow = splitArrowDiff(raw);

  if (arrow && /^status:\s*/i.test(arrow.prefix || raw)) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="text-ink/45">Status:</span>
        <StatusChip label={arrow.from} />
        <span className="text-ink/35">→</span>
        <StatusChip label={arrow.to} />
      </span>
    );
  }

  if (arrow) {
    const label = arrow.prefix?.trim() || null;
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {label ? <span className="text-ink/45">{label}</span> : null}
        <span className="font-semibold text-berry/85 line-through decoration-berry/45">
          {arrow.from}
        </span>
        <span className="text-ink/35">→</span>
        <span className="font-semibold text-mint">{arrow.to}</span>
      </span>
    );
  }

  const labeled = raw.match(
    /^(Added|Removed|Applied discount|Removed discount|Updated|High-value fee|Quote total):\s+(.+)$/i
  );
  if (labeled) {
    const verb = labeled[1];
    const value = labeled[2];
    const removed = /^removed/i.test(verb);
    const label = `${verb}:`;
    const nameClass = removed
      ? "font-semibold text-berry/80"
      : "font-semibold text-mint";
    const amountClass = removed
      ? "font-bold text-berry"
      : "font-bold text-mint";
    // "Surface Cleaning: $12" / custom names (greedy name so colons in names work)
    const amountMatch = value.match(/^(.+):\s+(\$?-?[\d,.]+%?)$/);
    return (
      <span>
        <span className="font-normal text-ink/45">{label}</span>{" "}
        {amountMatch ? (
          <>
            <span className={nameClass}>{amountMatch[1]}:</span>{" "}
            <span className={amountClass}>{amountMatch[2]}</span>
          </>
        ) : (
          <span className={amountClass}>{value}</span>
        )}
      </span>
    );
  }

  // Bare service / fee lines (e.g. on New cards): "Surface Cleaning: $12"
  const serviceLine = raw.match(/^(.+):\s+(\$?-?[\d,.]+%?)$/);
  if (serviceLine) {
    return (
      <span>
        <span className="font-normal text-ink/45">{serviceLine[1]}:</span>{" "}
        <span className="font-bold text-mint">{serviceLine[2]}</span>
      </span>
    );
  }

  const unchanged = raw.match(/^(Quote total unchanged at)\s+(.+)$/i);
  if (unchanged) {
    return (
      <span>
        <span className="text-ink/45">{unchanged[1]}</span>{" "}
        <span className="font-semibold text-ink">{unchanged[2]}</span>
      </span>
    );
  }

  return <span>{raw}</span>;
}

function StatusChip({ label }) {
  const meta = resolveStatusMeta(label);
  const className = meta
    ? meta.kind === "card"
      ? cardStatusBadgeClass(meta.id)
      : orderStatusBadgeClass(meta.id)
    : "bg-night/30 text-ink/70";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${className}`}
    >
      {label}
    </span>
  );
}

function resolveStatusMeta(label) {
  const needle = String(label ?? "")
    .trim()
    .toLowerCase();
  if (!needle) return null;
  for (const status of ORDER_STATUSES) {
    const labels = [status.label, status.customerLabel].filter(Boolean);
    if (labels.some((entry) => entry.toLowerCase() === needle)) {
      return { kind: "order", id: status.id };
    }
  }
  for (const status of CARD_STATUSES) {
    const labels = [status.label, status.customerLabel].filter(Boolean);
    if (labels.some((entry) => entry.toLowerCase() === needle)) {
      return { kind: "card", id: status.id };
    }
  }
  return null;
}

/** Parse "Label: old → new" or "old → new". */
export function splitArrowDiff(text) {
  const raw = String(text ?? "");
  const idx = raw.indexOf("→");
  if (idx === -1) return null;
  const left = raw.slice(0, idx).trim();
  const to = raw.slice(idx + 1).trim();
  if (!left || !to) return null;
  const colon = left.indexOf(":");
  if (colon !== -1) {
    return {
      prefix: `${left.slice(0, colon + 1)} `,
      from: left.slice(colon + 1).trim(),
      to,
    };
  }
  return { prefix: "", from: left, to };
}

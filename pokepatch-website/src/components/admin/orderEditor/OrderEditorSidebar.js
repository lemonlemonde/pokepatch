"use client";

import { useEffect, useRef, useState } from "react";
import {
  EDITOR_STATUS_OPTIONS,
  editorStatusValue,
  markActiveCardsCompleted,
  orderStatusBadgeClass,
} from "@/lib/orderStatus";
import { useOrderEditor } from "@/components/admin/orderEditor/OrderEditorContext";
import { syncPriorityQuoteAdjustments } from "@/lib/servicePricing";
import {
  DEFAULT_OUTREACH_MESSAGE,
  buildContactOpenHref,
  copyOutreachMessage,
} from "@/lib/adminOutreachMessage";
import {
  AdminNoteField,
  EditorLabel,
  GhostButton,
  Panel,
  RemoveButton,
  editorFieldClass,
} from "@/components/admin/orderEditor/editorUi";

const CONTACT_TYPES = [
  { value: "phone", label: "Phone" },
  { value: "discord", label: "Discord" },
  { value: "instagram", label: "Instagram" },
];

function OpenGlyph({ className = "h-3.5 w-3.5" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

function ContactValueField({ contactType, value, disabled, onChange }) {
  const href = buildContactOpenHref(contactType, value);
  const isSms = href?.startsWith("sms:");

  return (
    <div className="relative min-w-0 flex-1">
      <input
        className={`${editorFieldClass()} ${href ? "pr-8" : ""}`}
        value={value}
        disabled={disabled}
        onChange={onChange}
        placeholder="Number or handle"
      />
      {href ? (
        <a
          href={href}
          {...(isSms ? {} : { target: "_blank", rel: "noopener noreferrer" })}
          aria-label="Open contact"
          title="Open"
          className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-ink/30 transition hover:bg-ink/10 hover:text-ink/70"
        >
          <OpenGlyph />
        </a>
      ) : null}
    </div>
  );
}

function QuoteMessageBlock() {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await copyOutreachMessage();
      setCopied(true);
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-4 border-t border-ink/10 pt-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <EditorLabel className="mb-0">Quote message</EditorLabel>
        <GhostButton onClick={handleCopy} className="text-xs">
          {copied ? "Copied" : "Copy"}
        </GhostButton>
      </div>
      <p className="text-xs leading-relaxed text-ink/55">
        {DEFAULT_OUTREACH_MESSAGE}
      </p>
    </div>
  );
}

export function CustomerPanel() {
  const { draft, updateDraft, saving } = useOrderEditor();
  const contacts = draft.contacts ?? [];
  const name = [draft.first_name, draft.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  function updateContact(index, patch) {
    updateDraft((current) => ({
      ...current,
      contacts: current.contacts.map((contact, i) =>
        i === index ? { ...contact, ...patch } : contact
      ),
    }));
  }

  function addContact() {
    updateDraft((current) => ({
      ...current,
      contacts: [...current.contacts, { contact_type: "phone", value: "" }],
    }));
  }

  function removeContact(index) {
    updateDraft((current) => ({
      ...current,
      contacts: current.contacts.filter((_, i) => i !== index),
    }));
  }

  return (
    <Panel
      title="Customer"
      action={
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            draft.has_account
              ? "bg-mint/15 text-mint"
              : "bg-ink/10 text-ink/45"
          }`}
        >
          {draft.has_account ? "Account" : "Guest"}
        </span>
      }
    >
      <p className="text-sm font-semibold text-ink">{name || "—"}</p>
      {draft.customer_email ? (
        <p className="mt-0.5 truncate text-xs text-ink/55">
          {draft.customer_email}
        </p>
      ) : null}
      {draft.heard_about_source ? (
        <p className="mt-2 text-xs text-ink/45">
          Heard via {draft.heard_about_source}
        </p>
      ) : null}

      <div className="mt-4 border-t border-ink/10 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <EditorLabel className="mb-0">Contacts</EditorLabel>
          <GhostButton onClick={addContact} disabled={saving} className="text-xs">
            Add
          </GhostButton>
        </div>
        {contacts.length === 0 ? (
          <p className="text-xs text-ink/40">None on file.</p>
        ) : (
          <div className="space-y-2">
            {contacts.map((contact, index) => (
              <div
                key={contact.id ?? `new-${index}`}
                className="flex items-center gap-1.5"
              >
                <select
                  className={`${editorFieldClass({ fullWidth: false })} w-[6.25rem] shrink-0 px-2`}
                  value={contact.contact_type}
                  disabled={saving}
                  onChange={(event) =>
                    updateContact(index, { contact_type: event.target.value })
                  }
                >
                  {CONTACT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <ContactValueField
                  contactType={contact.contact_type}
                  value={contact.value}
                  disabled={saving}
                  onChange={(event) =>
                    updateContact(index, { value: event.target.value })
                  }
                />
                <RemoveButton
                  label="Remove contact"
                  disabled={saving}
                  onClick={() => removeContact(index)}
                />
              </div>
            ))}
          </div>
        )}
        <QuoteMessageBlock />
      </div>
    </Panel>
  );
}

export function OrderPanel() {
  const { draft, updateDraft, saving } = useOrderEditor();
  const driveUrl = (draft.photos_drive_url ?? "").trim();

  return (
    <Panel title="Order">
      <div className="space-y-4">
        <div>
          <EditorLabel>Status</EditorLabel>
          <div className="flex flex-wrap gap-1.5">
            {EDITOR_STATUS_OPTIONS.map((option) => {
              const selected =
                editorStatusValue(draft.status, draft.pending_kind) ===
                option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    updateDraft((current) => {
                      const next = {
                        ...current,
                        status: option.status,
                        pending_kind: option.pendingKind,
                      };
                      if (option.status === "ready") {
                        next.cards = markActiveCardsCompleted(current.cards);
                      }
                      return next;
                    })
                  }
                  aria-pressed={selected}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                    selected
                      ? orderStatusBadgeClass(option.status, option.pendingKind)
                      : "bg-ink/5 text-ink/45 hover:bg-ink/10 hover:text-ink/70"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="block">
          <EditorLabel>Delivery</EditorLabel>
          <select
            className={editorFieldClass()}
            value={draft.delivery_method}
            disabled={saving}
            onChange={(event) =>
              updateDraft({ delivery_method: event.target.value })
            }
          >
            <option value="local_dropoff">Local drop-off</option>
            <option value="shipping">Shipping</option>
          </select>
        </label>

        <label
          className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
            draft.is_priority
              ? "border-ink/30 bg-ink/[0.08]"
              : "border-ink/10 bg-night/20"
          }`}
        >
          <input
            type="checkbox"
            checked={Boolean(draft.is_priority)}
            disabled={saving}
            onChange={(event) => {
              const checked = event.target.checked;
              updateDraft((current) => ({
                ...current,
                is_priority: checked,
                quote_adjustments: syncPriorityQuoteAdjustments(
                  checked,
                  (current.cards ?? []).length,
                  current.quote_adjustments ?? []
                ),
              }));
            }}
            className="mt-0.5 h-4 w-4 shrink-0 accent-ink"
          />
          <span className="min-w-0 text-sm leading-relaxed text-ink/75">
            <span className="flex flex-wrap items-center gap-2 font-semibold text-ink">
              <span>Priority service</span>
              {draft.is_priority ? (
                <span className="rounded-full border border-ink/25 bg-ink/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink">
                  Active
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-xs text-ink/50">
              Faster queue handling. The priority fee is added automatically.
            </span>
          </span>
        </label>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <EditorLabel>Drive folder</EditorLabel>
            {driveUrl ? (
              <a
                href={driveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-ink transition hover:text-ink"
              >
                Open ↗
              </a>
            ) : null}
          </div>
          <input
            className={editorFieldClass()}
            type="url"
            inputMode="url"
            placeholder="https://drive.google.com/…"
            value={draft.photos_drive_url}
            disabled={saving}
            onChange={(event) =>
              updateDraft({ photos_drive_url: event.target.value })
            }
          />
        </div>

        <AdminNoteField
          label="Notes from PokePatch"
          hint="Visible to customer"
          value={draft.general_notes}
          disabled={saving}
          onChange={(event) => updateDraft({ general_notes: event.target.value })}
          placeholder="Optional note about the whole order…"
        />
      </div>
    </Panel>
  );
}

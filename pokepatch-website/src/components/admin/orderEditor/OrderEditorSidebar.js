"use client";

import {
  EDITOR_STATUS_OPTIONS,
  editorStatusValue,
  parseEditorStatusValue,
} from "@/lib/orderStatus";
import { useOrderEditor } from "@/components/admin/orderEditor/OrderEditorContext";
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
                <input
                  className={`${editorFieldClass()} min-w-0`}
                  value={contact.value}
                  disabled={saving}
                  onChange={(event) =>
                    updateContact(index, { value: event.target.value })
                  }
                  placeholder="Number or handle"
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
        <label className="block">
          <EditorLabel>Status</EditorLabel>
          <select
            className={editorFieldClass()}
            value={editorStatusValue(draft.status, draft.pending_kind)}
            disabled={saving}
            onChange={(event) => {
              const parsed = parseEditorStatusValue(event.target.value);
              updateDraft({
                status: parsed.status,
                pending_kind: parsed.pendingKind,
              });
            }}
          >
            {EDITOR_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

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

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <EditorLabel>Drive folder</EditorLabel>
            {driveUrl ? (
              <a
                href={driveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-berry transition hover:text-blush"
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

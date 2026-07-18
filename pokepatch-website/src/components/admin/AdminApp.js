"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import SectionHeading from "@/components/SectionHeading";
import {
  CardPhotoPreviewGrid,
  StagedCardPhotoPreviews,
} from "@/components/CardPhotoPreviews";
import {
  adminGetOrder,
  adminListOrders,
  adminLogin,
  adminLogout,
  adminSaveOrder,
  adminSetStatus,
  adminUploadPhoto,
  adminValidate,
  isAdminApiConfigured,
} from "@/lib/adminApi";
import GalleryManager from "@/components/admin/GalleryManager";
import StudioTool from "@/components/StudioTool";

const ADMIN_TABS = [
  {
    id: "orders",
    label: "Orders",
    path: "/admin/orders/",
    title: "Orders admin",
    subtitle:
      "Drag cards between columns to update status. Click a card to edit.",
  },
  {
    id: "gallery",
    label: "Gallery",
    path: "/admin/gallery/",
    title: "Gallery admin",
    subtitle:
      "Upload and manage restorations shown on the public Gallery page.",
  },
  {
    id: "studio",
    label: "Studio",
    path: "/admin/studio/",
    title: "Studio",
    subtitle:
      "1×2, 2×2 grid, and video before & after formatters for Instagram posts.",
  },
];

function tabFromPathname(pathname) {
  const match = ADMIN_TABS.find((entry) =>
    pathname?.startsWith(entry.path.replace(/\/$/, "")),
  );
  return match?.id ?? "orders";
}

const STATUSES = [
  { id: "new", label: "New" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
  { id: "delivered", label: "Delivered" },
];

const CONTACT_TYPES = [
  { value: "phone", label: "Phone" },
  { value: "discord", label: "Discord" },
  { value: "instagram", label: "Instagram" },
];

const ADMIN_IMAGE_TYPES = [
  { value: "progress_front", label: "Progress front" },
  { value: "progress_back", label: "Progress back" },
  { value: "final_front", label: "Final front" },
  { value: "final_back", label: "Final back" },
];

function fieldClassName() {
  return "w-full rounded-xl border-2 border-ink/15 bg-cream px-4 py-2 text-ink outline-none focus:border-blush";
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function deliveryLabel(value) {
  if (value === "local_dropoff") return "Local drop-off";
  if (value === "shipping") return "Shipping";
  return value ?? "";
}

function emptyStagedUploads() {
  return {
    progress_front: [],
    progress_back: [],
    final_front: [],
    final_back: [],
  };
}

function orderToDraft(order) {
  return {
    customer_name: order.customer_name ?? "",
    customer_email: order.customer_email ?? "",
    delivery_method: order.delivery_method ?? "local_dropoff",
    general_notes: order.general_notes ?? "",
    status: order.status ?? "new",
    contacts: (order.contacts ?? []).map((contact) => ({
      id: contact.id,
      contact_type: contact.contact_type,
      value: contact.value ?? "",
    })),
    cards: (order.cards ?? []).map((card) => ({
      id: card.id,
      card_name: card.card_name ?? "",
      set_name: card.set_name ?? "",
      description: card.description ?? "",
      images: card.images ?? [],
      staged: emptyStagedUploads(),
    })),
  };
}

function draftPayload(draft) {
  return {
    order: {
      customer_name: draft.customer_name.trim(),
      delivery_method: draft.delivery_method,
      general_notes: draft.general_notes.trim(),
      status: draft.status,
    },
    contacts: draft.contacts
      .filter((contact) => contact.value.trim() !== "")
      .map((contact) => ({
        ...(contact.id != null ? { id: contact.id } : {}),
        contact_type: contact.contact_type,
        value: contact.value.trim(),
      })),
    cards: draft.cards.map((card) => ({
      id: card.id,
      card_name: card.card_name.trim(),
      set_name: card.set_name.trim(),
      description: card.description.trim(),
    })),
  };
}

function validateDraftForSave(draft) {
  if (!draft.customer_name.trim()) {
    return "Customer name is required.";
  }
  for (const contact of draft.contacts) {
    if (!contact.value.trim()) {
      return "Fill in every contact or remove empty rows before saving.";
    }
  }
  for (let index = 0; index < draft.cards.length; index += 1) {
    if (!draft.cards[index].card_name.trim()) {
      return `Card ${index + 1} needs a name.`;
    }
  }
  return null;
}

function hasStagedUploads(draft) {
  return draft.cards.some((card) =>
    ADMIN_IMAGE_TYPES.some((type) => card.staged[type.value]?.length > 0)
  );
}

function LoadingIndicator({ label = "Loading…", compact = false, className = "" }) {
  const spinner = (
    <div
      aria-hidden="true"
      className={`animate-spin rounded-full border-ink/15 border-t-berry border-r-blush ${
        compact ? "h-4 w-4 border-2" : "h-10 w-10 border-4"
      }`}
    />
  );

  if (compact) {
    return (
      <span
        role="status"
        aria-live="polite"
        className={`inline-flex items-center gap-2 text-sm font-semibold text-ink/60 ${className}`}
      >
        {spinner}
        {label}
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}
    >
      {spinner}
      <p className="animate-soft-bounce text-sm font-semibold text-ink/70">{label}</p>
    </div>
  );
}

function LoginGate({ onSuccess }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await adminLogin(password);
      onSuccess();
    } catch (err) {
      setError(err.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm animate-fade-up">
      <SectionHeading subtitle="Orders admin — password required.">
        Admin login
      </SectionHeading>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError("");
          }}
          placeholder="Admin password"
          autoComplete="current-password"
          className={fieldClassName()}
        />
        {error && (
          <p className="text-center text-sm text-berry" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className={`w-full rounded-xl bg-berry px-4 py-3 font-semibold text-night shadow-cozy transition hover:brightness-110 disabled:opacity-60 ${
            busy ? "animate-soft-bounce" : ""
          }`}
        >
          {busy ? (
            <span className="inline-flex items-center justify-center gap-2">
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-night/20 border-t-night"
              />
              Signing in…
            </span>
          ) : (
            "Sign in"
          )}
        </button>
      </form>
    </div>
  );
}

function orderToKanbanSummary(order) {
  return {
    id: order.id,
    display_id: order.display_id,
    created_at: order.created_at,
    customer_name: order.customer_name,
    delivery_method: order.delivery_method,
    status: order.status ?? "new",
    card_count: order.card_count ?? order.cards?.length ?? 0,
  };
}

function KanbanCard({ order, onOpen, dragging, selected, loading }) {
  const cardCount = order.card_count ?? order.cards?.length ?? 0;

  return (
    <button
      type="button"
      draggable
      onClick={() => onOpen(order.id)}
      aria-current={selected ? "true" : undefined}
      aria-busy={loading || undefined}
      className={`relative w-full rounded-xl border-2 px-3 py-3 text-left shadow-cozy-sm transition ${
        selected
          ? "border-berry bg-blush/30 shadow-cozy ring-2 ring-berry/50 ring-offset-2 ring-offset-night/40"
          : "border-ink/10 bg-cream hover:border-blush/60"
      } ${dragging ? "opacity-50" : ""} ${loading ? "pointer-events-none" : ""}`}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-night/40">
          <span
            aria-hidden="true"
            className="h-6 w-6 animate-spin rounded-full border-2 border-ink/20 border-t-berry"
          />
        </span>
      )}
      <p className="font-display text-lg font-bold text-ink">#{order.display_id}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{order.customer_name}</p>
      <p className="mt-1 text-xs text-ink/60">
        {cardCount} card{cardCount === 1 ? "" : "s"} · {deliveryLabel(order.delivery_method)}
      </p>
      <p className="mt-1 text-xs text-ink/50">{formatDate(order.created_at)}</p>
    </button>
  );
}

function filenameFromStoragePath(path) {
  const base = path.split("/").pop() ?? path;
  return base.replace(/^(customer|progress_front|progress_back|final_front|final_back|admin)-\d+-/, "");
}

function savedPhotoItems(images) {
  return (images ?? []).map((image) => {
    const label = filenameFromStoragePath(image.storage_path);
    return {
      id: image.id ?? image.storage_path,
      src: image.signed_url ?? "",
      alt: label,
      label,
      href: image.signed_url ?? undefined,
    };
  });
}

function KanbanBoard({ orders, onOpenOrder, onStatusChange, selectedOrderId, loadingOrderId }) {
  const [dragOrderId, setDragOrderId] = useState(null);

  const columns = useMemo(() => {
    const grouped = Object.fromEntries(STATUSES.map((status) => [status.id, []]));
    for (const order of orders) {
      const status = order.status ?? "new";
      if (grouped[status]) grouped[status].push(order);
    }
    for (const status of STATUSES) {
      grouped[status.id].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    }
    return grouped;
  }, [orders]);

  function handleDragStart(event, orderId) {
    event.dataTransfer.setData("text/plain", orderId);
    event.dataTransfer.effectAllowed = "move";
    setDragOrderId(orderId);
  }

  function handleDragEnd() {
    setDragOrderId(null);
  }

  async function handleDrop(event, status) {
    event.preventDefault();
    const orderId = event.dataTransfer.getData("text/plain");
    setDragOrderId(null);
    if (!orderId) return;
    await onStatusChange(orderId, status);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {STATUSES.map((status) => (
        <section
          key={status.id}
          className="rounded-xl border-2 border-ink/10 bg-night/40 p-3"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => handleDrop(event, status.id)}
        >
          <h2 className="mb-3 font-display text-lg font-bold text-blush">{status.label}</h2>
          <div className="space-y-3">
            {(columns[status.id] ?? []).map((order) => (
              <div
                key={order.id}
                draggable
                onDragStart={(event) => handleDragStart(event, order.id)}
                onDragEnd={handleDragEnd}
              >
                <KanbanCard
                  order={order}
                  onOpen={onOpenOrder}
                  dragging={dragOrderId === order.id}
                  selected={order.id === selectedOrderId}
                  loading={order.id === loadingOrderId}
                />
              </div>
            ))}
            {(columns[status.id] ?? []).length === 0 && (
              <p className="rounded-lg border border-dashed border-ink/15 px-3 py-6 text-center text-xs text-ink/40">
                Drop orders here
              </p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function OrderEditor({
  orderId,
  displayId,
  draft,
  dirty,
  saving,
  error,
  onChange,
  onCancel,
  onSave,
}) {
  function updateDraft(patch) {
    onChange({ ...draft, ...patch });
  }

  function updateContact(index, patch) {
    const contacts = draft.contacts.map((contact, i) =>
      i === index ? { ...contact, ...patch } : contact
    );
    updateDraft({ contacts });
  }

  function addContact() {
    updateDraft({
      contacts: [
        ...draft.contacts,
        { contact_type: "phone", value: "" },
      ],
    });
  }

  function updateCard(index, patch) {
    const cards = draft.cards.map((card, i) =>
      i === index ? { ...card, ...patch } : card
    );
    updateDraft({ cards });
  }

  function stageFiles(cardIndex, imageType, fileList) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    const cards = draft.cards.map((card, i) => {
      if (i !== cardIndex) return card;
      return {
        ...card,
        staged: {
          ...card.staged,
          [imageType]: [
            ...(card.staged[imageType] ?? []),
            ...files.map((file) => ({ id: crypto.randomUUID(), file })),
          ],
        },
      };
    });
    updateDraft({ cards });
  }

  function removeStagedFile(cardIndex, imageType, fileId) {
    const cards = draft.cards.map((card, i) => {
      if (i !== cardIndex) return card;
      return {
        ...card,
        staged: {
          ...card.staged,
          [imageType]: (card.staged[imageType] ?? []).filter((item) => item.id !== fileId),
        },
      };
    });
    updateDraft({ cards });
  }

  return (
    <section
      className={`relative mt-8 rounded-xl border-2 border-ink/10 bg-night/50 p-4 sm:p-6 ${
        saving ? "pointer-events-none opacity-60" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold text-ink">Order #{displayId}</h2>
          <p className="mt-1 text-sm text-ink/60">Edit fields, then Save. Photos upload on Save.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving || !dirty}
            className="rounded-xl border-2 border-ink/20 px-4 py-2 text-sm font-semibold text-ink transition hover:border-blush disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !dirty}
            className="rounded-xl bg-berry px-4 py-2 text-sm font-semibold text-night shadow-cozy transition hover:brightness-110 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold text-ink/70">Customer name</span>
          <input
            className={`${fieldClassName()} mt-1`}
            value={draft.customer_name}
            onChange={(event) => updateDraft({ customer_name: event.target.value })}
          />
        </label>
        {draft.customer_email ? (
          <label className="block">
            <span className="text-sm font-semibold text-ink/70">Email</span>
            <input
              className={`${fieldClassName()} mt-1 cursor-default opacity-80`}
              value={draft.customer_email}
              readOnly
            />
          </label>
        ) : null}
        <label className="block">
          <span className="text-sm font-semibold text-ink/70">Delivery</span>
          <select
            className={`${fieldClassName()} mt-1`}
            value={draft.delivery_method}
            onChange={(event) => updateDraft({ delivery_method: event.target.value })}
          >
            <option value="local_dropoff">Local drop-off</option>
            <option value="shipping">Shipping</option>
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-ink/70">General notes</span>
          <textarea
            className={`${fieldClassName()} mt-1 min-h-[88px]`}
            value={draft.general_notes}
            onChange={(event) => updateDraft({ general_notes: event.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-ink/70">Status</span>
          <select
            className={`${fieldClassName()} mt-1`}
            value={draft.status}
            onChange={(event) => updateDraft({ status: event.target.value })}
          >
            {STATUSES.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-xl font-bold text-blush">Contacts</h3>
          <button
            type="button"
            onClick={addContact}
            className="rounded-lg border border-ink/20 px-3 py-1 text-xs font-semibold text-ink hover:border-blush"
          >
            Add contact
          </button>
        </div>
        <p className="mt-1 text-xs text-ink/50">
          Remove empty contact rows before saving.
        </p>
        <div className="mt-3 space-y-3">
          {draft.contacts.map((contact, index) => (
            <div key={contact.id ?? `new-${index}`} className="grid gap-2 sm:grid-cols-[140px_1fr]">
              <select
                className={fieldClassName()}
                value={contact.contact_type}
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
                className={fieldClassName()}
                value={contact.value}
                onChange={(event) => updateContact(index, { value: event.target.value })}
                placeholder="Contact value"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 space-y-6">
        <h3 className="font-display text-xl font-bold text-blush">Cards</h3>
        {draft.cards.map((card, cardIndex) => {
          const customerImages = (card.images ?? []).filter(
            (image) => image.image_type === "customer"
          );
          const adminImagesByType = Object.fromEntries(
            ADMIN_IMAGE_TYPES.map((type) => [
              type.value,
              (card.images ?? []).filter((image) => image.image_type === type.value),
            ])
          );

          return (
            <article
              key={card.id}
              className="rounded-xl border border-ink/10 bg-cream/90 p-4"
            >
              <h4 className="mb-3 font-display text-lg font-bold text-ink">
                Card {cardIndex + 1}
              </h4>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-ink/70">Card name</span>
                  <input
                    className={`${fieldClassName()} mt-1`}
                    value={card.card_name}
                    onChange={(event) =>
                      updateCard(cardIndex, { card_name: event.target.value })
                    }
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-ink/70">Set</span>
                  <input
                    className={`${fieldClassName()} mt-1`}
                    value={card.set_name}
                    onChange={(event) =>
                      updateCard(cardIndex, { set_name: event.target.value })
                    }
                  />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-sm font-semibold text-ink/70">Description</span>
                  <textarea
                    className={`${fieldClassName()} mt-1 min-h-[72px]`}
                    value={card.description}
                    onChange={(event) =>
                      updateCard(cardIndex, { description: event.target.value })
                    }
                  />
                </label>
              </div>

              <div className="mt-4 space-y-4">
                <CardPhotoPreviewGrid
                  title="Customer photos"
                  items={savedPhotoItems(customerImages)}
                />
                {ADMIN_IMAGE_TYPES.map((type) => (
                  <div key={type.value}>
                    <CardPhotoPreviewGrid
                      title={type.label}
                      items={savedPhotoItems(adminImagesByType[type.value])}
                    />
                    <label className="mt-2 inline-flex cursor-pointer items-center rounded-full bg-blush px-4 py-2 text-sm font-semibold text-night transition-colors duration-150 sm:hover:bg-blush/80">
                      Add {type.label.toLowerCase()}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          stageFiles(cardIndex, type.value, event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    <StagedCardPhotoPreviews
                      files={card.staged[type.value] ?? []}
                      onRemove={(fileId) =>
                        removeStagedFile(cardIndex, type.value, fileId)
                      }
                      caption={`${(card.staged[type.value] ?? []).length} file${
                        (card.staged[type.value] ?? []).length === 1 ? "" : "s"
                      } selected — uploads on Save`}
                    />
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function AdminApp() {
  const router = useRouter();
  const pathname = usePathname();
  const tab = tabFromPathname(pathname);
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingOrderId, setLoadingOrderId] = useState(null);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [selectedDisplayId, setSelectedDisplayId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [editorError, setEditorError] = useState("");
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState("");

  const dirty = useMemo(() => {
    if (!draft) return false;
    const payload = JSON.stringify(draftPayload(draft));
    const staged = hasStagedUploads(draft);
    return payload !== savedSnapshot || staged;
  }, [draft, savedSnapshot]);

  const activeTab = ADMIN_TABS.find((entry) => entry.id === tab) ?? ADMIN_TABS[0];

  const refreshOrders = useCallback(async () => {
    setLoadingOrders(true);
    setListError("");
    try {
      const rows = await adminListOrders();
      setOrders(rows);
    } catch (err) {
      setListError(err.message || "Could not load orders.");
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!isAdminApiConfigured()) {
        setReady(true);
        return;
      }
      const ok = await adminValidate();
      if (cancelled) return;
      setAuthed(ok);
      setReady(true);
      if (ok) await refreshOrders();
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [refreshOrders]);

  async function handleLoginSuccess() {
    setAuthed(true);
    await refreshOrders();
  }

  async function handleLogout() {
    await adminLogout();
    setAuthed(false);
    setOrders([]);
    setSelectedOrderId(null);
    setDraft(null);
  }

  async function handleStatusChange(orderId, status) {
    const previous = orders;
    setOrders((current) =>
      current.map((order) =>
        order.id === orderId ? { ...order, status } : order
      )
    );
    try {
      await adminSetStatus(orderId, status);
      if (selectedOrderId === orderId) {
        setDraft((current) => {
          if (!current) return current;
          const next = { ...current, status };
          setSavedSnapshot(JSON.stringify(draftPayload(next)));
          return next;
        });
      }
    } catch (err) {
      setOrders(previous);
      setListError(err.message || "Could not update status.");
    }
  }

  async function openOrder(orderId) {
    setEditorError("");
    setLoadingOrderId(orderId);
    setSelectedOrderId(orderId);
    setDraft(null);
    try {
      const order = await adminGetOrder(orderId);
      const nextDraft = orderToDraft(order);
      setSelectedDisplayId(order.display_id);
      setDraft(nextDraft);
      setSavedSnapshot(JSON.stringify(draftPayload(nextDraft)));
    } catch (err) {
      setSelectedOrderId(null);
      setSelectedDisplayId(null);
      setEditorError(err.message || "Could not load order.");
    } finally {
      setLoadingOrderId(null);
    }
  }

  async function handleCancel() {
    if (!selectedOrderId) return;
    await openOrder(selectedOrderId);
  }

  async function handleSave() {
    if (!selectedOrderId || !draft) return;
    const validationError = validateDraftForSave(draft);
    if (validationError) {
      setEditorError(validationError);
      return;
    }

    setSaving(true);
    setEditorError("");
    try {
      const payload = draftPayload(draft);
      const uploadTasks = [];
      for (const card of draft.cards) {
        for (const type of ADMIN_IMAGE_TYPES) {
          for (const item of card.staged[type.value] ?? []) {
            uploadTasks.push(
              adminUploadPhoto(selectedOrderId, card.id, type.value, item.file)
            );
          }
        }
      }

      const refreshed = await adminSaveOrder(selectedOrderId, payload);

      if (uploadTasks.length > 0) {
        await Promise.all(uploadTasks);
      }

      const finalOrder =
        uploadTasks.length > 0
          ? await adminGetOrder(selectedOrderId)
          : refreshed;
      const nextDraft = orderToDraft(finalOrder);
      setDraft(nextDraft);
      setSavedSnapshot(JSON.stringify(draftPayload(nextDraft)));
      setOrders((current) =>
        current.map((order) =>
          order.id === selectedOrderId
            ? { ...order, ...orderToKanbanSummary(finalOrder) }
            : order
        )
      );
    } catch (err) {
      setEditorError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <LoadingIndicator label="Loading admin…" />
      </div>
    );
  }

  if (!isAdminApiConfigured()) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-ink/70">
        <p>
          Set{" "}
          <code className="rounded bg-night/50 px-1">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="rounded bg-night/50 px-1">
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
          </code>{" "}
          to use admin.
        </p>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <LoginGate onSuccess={handleLoginSuccess} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="relative mb-6">
        <SectionHeading subtitle={activeTab.subtitle}>
          {activeTab.title}
        </SectionHeading>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3 sm:absolute sm:right-0 sm:top-0 sm:mt-0 sm:justify-end">
          {tab === "orders" && loadingOrders && orders.length > 0 && (
            <LoadingIndicator compact label="Refreshing…" />
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-xl border-2 border-ink/20 px-4 py-2 text-sm font-semibold text-ink hover:border-blush"
          >
            Log out
          </button>
        </div>
      </div>

      <div className="mb-6 flex gap-2">
        {ADMIN_TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => router.push(entry.path)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              tab === entry.id
                ? "bg-berry text-night shadow-cozy"
                : "border-2 border-ink/15 text-ink hover:border-blush"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "gallery" && <GalleryManager />}
      {tab === "studio" && <StudioTool />}
      {tab === "orders" && (
        <>
          {listError && (
            <p className="mb-4 rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
              {listError}
            </p>
          )}

          {loadingOrders && orders.length === 0 ? (
            <LoadingIndicator label="Loading orders…" />
          ) : (
            <KanbanBoard
              orders={orders}
              onOpenOrder={openOrder}
              onStatusChange={handleStatusChange}
              selectedOrderId={selectedOrderId}
              loadingOrderId={loadingOrderId}
            />
          )}

          {loadingOrderId && !draft && (
            <LoadingIndicator label="Loading order…" className="mt-8" />
          )}

          {editorError && !draft && !loadingOrderId && (
            <p className="mt-8 rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
              {editorError}
            </p>
          )}

          {saving && selectedOrderId && draft && (
            <LoadingIndicator label="Saving order…" className="mt-8 py-6" />
          )}

          {selectedOrderId && draft && (
            <OrderEditor
              orderId={selectedOrderId}
              displayId={selectedDisplayId}
              draft={draft}
              dirty={dirty}
              saving={saving}
              error={editorError}
              onChange={setDraft}
              onCancel={handleCancel}
              onSave={handleSave}
            />
          )}
        </>
      )}
    </div>
  );
}

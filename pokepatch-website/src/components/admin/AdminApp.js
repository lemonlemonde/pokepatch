"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import SectionHeading from "@/components/SectionHeading";
import {
  CardPhotoPreviewGrid,
  StagedCardPhotoPreviews,
} from "@/components/CardPhotoPreviews";
import {
  adminDeleteOrders,
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
import {
  ORDER_STATUSES,
  ACTIVE_ORDER_STATUSES,
  CLOSED_ORDER_STATUSES,
  groupOrdersByStatus,
  normalizeOrderStatus,
  orderStatusHeadingClass,
  isClosedOrderStatus,
  filterClosedColumnOrders,
} from "@/lib/orderStatus";

const ADMIN_TABS = [
  {
    id: "orders",
    label: "Orders",
    path: "/admin/orders/",
    title: "Orders admin",
    subtitle:
      "Drag cards between columns to update status. Click a card to edit. Check boxes to multi-select, then delete with confirmation.",
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
    status: normalizeOrderStatus(order.status),
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

function previewUrlsFromOrder(order) {
  if (Array.isArray(order.preview_urls) && order.preview_urls.length > 0) {
    return order.preview_urls.filter(Boolean);
  }
  const urls = [];
  for (const card of order.cards ?? []) {
    for (const image of card.images ?? []) {
      if (image.image_type !== "customer") continue;
      if (image.signed_url) urls.push(image.signed_url);
      if (urls.length >= 4) return urls;
    }
  }
  return urls;
}

function orderToKanbanSummary(order) {
  const status = normalizeOrderStatus(order.status);
  const isClosed = isClosedOrderStatus(status);
  return {
    id: order.id,
    display_id: order.display_id,
    created_at: order.created_at,
    customer_name: order.customer_name,
    delivery_method: order.delivery_method,
    status,
    completed_at: isClosed ? (order.completed_at ?? null) : null,
    status_changed_at: order.status_changed_at ?? null,
    card_count: order.card_count ?? order.cards?.length ?? 0,
    preview_urls: previewUrlsFromOrder(order),
  };
}

function TrashIcon({ className = "h-5 w-5" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function KanbanCard({
  order,
  onOpen,
  onToggleCheck,
  onContextMenu,
  dragging,
  editorSelected,
  checked,
  loading,
}) {
  const cardCount = order.card_count ?? order.cards?.length ?? 0;
  const previewUrls = Array.isArray(order.preview_urls)
    ? order.preview_urls.filter(Boolean).slice(0, 4)
    : [];
  const hasMore = cardCount > previewUrls.length && previewUrls.length > 0;

  return (
    <div
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu?.(event, order);
      }}
      className={`relative flex w-full items-start gap-2 rounded-xl border-2 px-3 py-3 text-left shadow-cozy-sm transition ${
        checked
          ? "border-berry/70 bg-berry/10"
          : editorSelected
            ? "border-berry bg-blush/30 shadow-cozy ring-2 ring-berry/50 ring-offset-2 ring-offset-night/40"
            : "border-ink/10 bg-cream hover:border-blush/60"
      } ${dragging ? "opacity-50" : ""} ${loading ? "pointer-events-none" : ""}`}
    >
      {loading && (
        <span className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-night/40">
          <span
            aria-hidden="true"
            className="h-6 w-6 animate-spin rounded-full border-2 border-ink/20 border-t-berry"
          />
        </span>
      )}
      <label
        className="mt-1 shrink-0"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggleCheck(order.id)}
          aria-label={`Select order #${order.display_id}`}
          className="h-4 w-4 accent-berry"
        />
      </label>
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            onToggleCheck(order.id);
            return;
          }
          onOpen(order.id);
        }}
        aria-current={editorSelected ? "true" : undefined}
        aria-busy={loading || undefined}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold tabular-nums text-ink">
              #{order.display_id}
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-ink">
              {order.customer_name}
            </p>
            <p className="mt-1 text-xs text-ink/60">
              {cardCount} card{cardCount === 1 ? "" : "s"} ·{" "}
              {deliveryLabel(order.delivery_method)}
            </p>
            <p className="mt-1 text-xs text-ink/50">
              {formatDate(order.created_at)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-ink/10 bg-night/40 p-1">
            {previewUrls.length === 0 ? (
              <div className="aspect-[3/4] w-9 rounded-md bg-night/50" />
            ) : (
              previewUrls.map((url, index) => {
                const showMore = hasMore && index === previewUrls.length - 1;
                return (
                  <div
                    key={`${url}-${index}`}
                    className="relative aspect-[3/4] w-9 shrink-0 overflow-hidden rounded-md bg-night/50"
                  >
                    <img
                      src={url}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                    {showMore && (
                      <div className="absolute inset-0 flex items-center justify-center bg-night/70 text-xs font-bold text-cream">
                        …
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </button>
    </div>
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

function formatOrderIdList(orders, limit = 8) {
  const labels = orders.map((order) => `#${order.display_id}`);
  if (labels.length <= limit) return labels.join(", ");
  const remaining = labels.length - limit;
  return `${labels.slice(0, limit).join(", ")} and ${remaining} more`;
}

function DeleteOrderDialog({ orders, deleting, onCancel, onConfirm }) {
  useEffect(() => {
    if (!orders?.length) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [orders, deleting, onCancel]);

  if (!orders?.length) return null;

  const count = orders.length;
  const isBulk = count > 1;
  const title = isBulk
    ? `Delete ${count} orders?`
    : `Delete order #${orders[0].display_id}?`;
  const confirmLabel = isBulk
    ? `Yes, delete ${count} orders`
    : "Yes, delete this order";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-night/70 px-4"
      role="presentation"
      onClick={() => {
        if (!deleting) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-order-title"
        className="w-full max-w-md rounded-2xl border-2 border-ink/15 bg-cream p-6 shadow-cozy"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-berry/15 text-berry">
            <TrashIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2
              id="delete-order-title"
              className="font-display text-xl font-bold text-ink"
            >
              {title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink/70">
              Are you sure you want to delete{" "}
              {isBulk ? "these orders" : "this order"}? This permanently
              removes {isBulk ? "them" : "it"}, including contacts, cards, and
              photos. This cannot be undone.
            </p>
            <p className="mt-3 rounded-lg border border-ink/10 bg-night/30 px-3 py-2 text-xs font-semibold tabular-nums text-ink/80">
              {formatOrderIdList(orders)}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-xl border-2 border-ink/20 px-4 py-2 text-sm font-semibold text-ink transition hover:border-blush disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-xl bg-berry px-4 py-2 text-sm font-semibold text-night shadow-cozy transition hover:brightness-110 disabled:opacity-40"
          >
            {deleting ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function KanbanBoard({
  orders,
  onOpenOrder,
  onStatusChange,
  onRequestDelete,
  selectedOrderId,
  loadingOrderId,
}) {
  const [dragOrderId, setDragOrderId] = useState(null);
  const [trashArmed, setTrashArmed] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [checkedIds, setCheckedIds] = useState(() => new Set());
  const [showAllCompleted, setShowAllCompleted] = useState(false);
  const [showAllCanceled, setShowAllCanceled] = useState(false);

  const columns = useMemo(() => groupOrdersByStatus(orders), [orders]);
  const dragOrder = useMemo(
    () => orders.find((order) => order.id === dragOrderId) ?? null,
    [orders, dragOrderId]
  );
  const checkedOrders = useMemo(
    () => orders.filter((order) => checkedIds.has(order.id)),
    [orders, checkedIds]
  );

  useEffect(() => {
    setCheckedIds((current) => {
      const valid = new Set(orders.map((order) => order.id));
      let changed = false;
      const next = new Set();
      for (const id of current) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [orders]);

  useEffect(() => {
    if (!contextMenu) return undefined;

    function closeMenu() {
      setContextMenu(null);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") closeMenu();
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  function toggleCheck(orderId) {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function clearChecked() {
    setCheckedIds(new Set());
  }

  function setColumnChecked(columnOrders, checked) {
    setCheckedIds((current) => {
      const next = new Set(current);
      for (const order of columnOrders) {
        if (checked) next.add(order.id);
        else next.delete(order.id);
      }
      return next;
    });
  }

  function ordersForDeleteRequest(seedOrders) {
    const seeds = (Array.isArray(seedOrders) ? seedOrders : [seedOrders]).filter(
      Boolean
    );
    if (
      checkedOrders.length > 1 &&
      seeds.some((order) => checkedIds.has(order.id))
    ) {
      return checkedOrders;
    }
    return seeds;
  }

  function requestDelete(seedOrders) {
    const targets = ordersForDeleteRequest(seedOrders);
    if (!targets.length) return;
    onRequestDelete(targets);
  }

  function handleDragStart(event, orderId) {
    event.dataTransfer.setData("text/plain", orderId);
    event.dataTransfer.effectAllowed = "move";
    setDragOrderId(orderId);
    setContextMenu(null);
  }

  function handleDragEnd() {
    setDragOrderId(null);
    setTrashArmed(false);
  }

  async function handleDrop(event, status) {
    event.preventDefault();
    const orderId = event.dataTransfer.getData("text/plain");
    setDragOrderId(null);
    setTrashArmed(false);
    if (!orderId) return;
    await onStatusChange(orderId, status);
  }

  function handleTrashDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setTrashArmed(true);
  }

  function handleTrashDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setTrashArmed(false);
  }

  function handleTrashDrop(event) {
    event.preventDefault();
    const orderId = event.dataTransfer.getData("text/plain");
    const order =
      orders.find((entry) => entry.id === orderId) ??
      (dragOrderId === orderId ? dragOrder : null);
    setDragOrderId(null);
    setTrashArmed(false);
    if (!order) return;
    requestDelete(order);
  }

  function handleCardContextMenu(event, order) {
    setContextMenu({
      order,
      x: Math.min(event.clientX, window.innerWidth - 200),
      y: Math.min(event.clientY, window.innerHeight - 100),
    });
  }

  function showAllForClosedStatus(statusId) {
    if (statusId === "completed") return showAllCompleted;
    if (statusId === "canceled") return showAllCanceled;
    return false;
  }

  function renderColumn(status, { closed }) {
    const rawOrders = columns[status.id] ?? [];
    const showAll = closed ? showAllForClosedStatus(status.id) : false;
    const columnOrders = closed
      ? filterClosedColumnOrders(rawOrders, showAll)
      : rawOrders;
    const checkedInColumn = columnOrders.filter((order) =>
      checkedIds.has(order.id)
    ).length;
    const allColumnChecked =
      columnOrders.length > 0 && checkedInColumn === columnOrders.length;

    return (
      <section
        key={status.id}
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border-2 border-ink/10 bg-night/40 p-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, status.id)}
      >
        <div className="mb-3 flex shrink-0 flex-nowrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <input
              type="checkbox"
              checked={allColumnChecked}
              disabled={columnOrders.length === 0}
              ref={(node) => {
                if (node) {
                  node.indeterminate =
                    checkedInColumn > 0 && !allColumnChecked;
                }
              }}
              onChange={(event) =>
                setColumnChecked(columnOrders, event.target.checked)
              }
              aria-label={`Select all in ${status.label}`}
              className="h-3.5 w-3.5 shrink-0 accent-berry disabled:opacity-40"
            />
            <h2
              className={`min-w-0 truncate font-display text-base font-bold leading-none sm:text-lg ${orderStatusHeadingClass(
                status.id
              )}`}
            >
              {status.label}
              {columnOrders.length > 0 && (
                <span className="ml-1.5 text-sm font-semibold text-ink/40">
                  {columnOrders.length}
                </span>
              )}
            </h2>
          </div>
          {closed && (
            <label className="flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap text-xs font-semibold text-ink/60">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => {
                  if (status.id === "completed") {
                    setShowAllCompleted(event.target.checked);
                  } else if (status.id === "canceled") {
                    setShowAllCanceled(event.target.checked);
                  }
                }}
                className="h-3.5 w-3.5 accent-berry"
              />
              Show all
            </label>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-0.5">
          {columnOrders.map((order) => (
            <div
              key={order.id}
              draggable
              onDragStart={(event) => handleDragStart(event, order.id)}
              onDragEnd={handleDragEnd}
            >
              <KanbanCard
                order={order}
                onOpen={onOpenOrder}
                onToggleCheck={toggleCheck}
                onContextMenu={handleCardContextMenu}
                dragging={dragOrderId === order.id}
                editorSelected={order.id === selectedOrderId}
                checked={checkedIds.has(order.id)}
                loading={order.id === loadingOrderId}
              />
            </div>
          ))}
          {columnOrders.length === 0 && (
            <p className="flex h-full min-h-[6rem] items-center justify-center rounded-lg border border-dashed border-ink/15 px-3 py-6 text-center text-xs text-ink/40">
              {closed
                ? `Drop to mark ${status.label.toLowerCase()}`
                : "Drop orders here"}
            </p>
          )}
        </div>
      </section>
    );
  }

  const trashTargets =
    dragOrderId && checkedIds.has(dragOrderId) && checkedOrders.length > 1
      ? checkedOrders
      : dragOrder
        ? [dragOrder]
        : [];
  const contextDeleteTargets = contextMenu
    ? ordersForDeleteRequest(contextMenu.order)
    : [];

  return (
    <div className="space-y-4">
      <div className="grid h-[min(66vh,calc(100dvh-16rem))] grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {ACTIVE_ORDER_STATUSES.map((status) =>
          renderColumn(status, { closed: false })
        )}
        {CLOSED_ORDER_STATUSES.map((status) =>
          renderColumn(status, { closed: true })
        )}
      </div>

      {checkedOrders.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-berry/30 bg-berry/10 px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            {checkedOrders.length} selected
            <span className="ml-2 font-normal text-ink/60">
              {formatOrderIdList(checkedOrders, 4)}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={clearChecked}
              className="rounded-xl border-2 border-ink/20 px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-blush"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => requestDelete(checkedOrders)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-berry px-3 py-1.5 text-sm font-semibold text-night shadow-cozy transition hover:brightness-110"
            >
              <TrashIcon className="h-4 w-4" />
              Delete selected
            </button>
          </div>
        </div>
      )}

      <div
        role="region"
        aria-label="Delete order drop zone"
        onDragOver={handleTrashDragOver}
        onDragLeave={handleTrashDragLeave}
        onDrop={handleTrashDrop}
        className={`flex items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 py-4 transition ${
          dragOrderId
            ? trashArmed
              ? "border-berry bg-berry/20 text-berry shadow-cozy"
              : "border-berry/50 bg-berry/10 text-berry/90"
            : "border-ink/15 bg-night/30 text-ink/45"
        }`}
      >
        <TrashIcon
          className={`h-6 w-6 transition ${
            trashArmed ? "scale-110" : ""
          }`}
        />
        <div className="text-center sm:text-left">
          <p className="text-sm font-semibold">
            {trashArmed
              ? trashTargets.length > 1
                ? `Release to delete ${trashTargets.length} orders`
                : `Release to delete #${dragOrder?.display_id ?? ""}`
              : dragOrderId
                ? trashTargets.length > 1
                  ? `Drop to delete ${trashTargets.length} selected`
                  : "Drop here to delete"
                : "Recycling bin"}
          </p>
          <p className="mt-0.5 text-xs opacity-80">
            {dragOrderId
              ? "You’ll confirm before anything is deleted"
              : "Select cards, right-click, or drag here — always confirms first"}
          </p>
        </div>
      </div>

      {contextMenu && (
        <div
          role="menu"
          className="fixed z-40 min-w-[12rem] overflow-hidden rounded-xl border-2 border-ink/15 bg-cream py-1 shadow-cozy"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-berry transition hover:bg-berry/10"
            onClick={() => {
              const targets = contextDeleteTargets;
              setContextMenu(null);
              onRequestDelete(targets);
            }}
          >
            <TrashIcon className="h-4 w-4" />
            {contextDeleteTargets.length > 1
              ? `Delete ${contextDeleteTargets.length} selected`
              : "Delete order"}
          </button>
        </div>
      )}
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
          <h2 className="text-2xl font-bold tabular-nums text-ink">Order #{displayId}</h2>
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
            {ORDER_STATUSES.map((status) => (
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
  const [deleteTargets, setDeleteTargets] = useState(null);
  const [deletingOrder, setDeletingOrder] = useState(false);

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
    const nextStatus = normalizeOrderStatus(status);
    setOrders((current) =>
      current.map((order) => {
        if (order.id !== orderId) return order;
        const wasClosed = isClosedOrderStatus(order.status);
        const nextClosed = isClosedOrderStatus(nextStatus);
        return {
          ...order,
          status: nextStatus,
          status_changed_at: new Date().toISOString(),
          completed_at: nextClosed
            ? wasClosed
              ? order.completed_at
              : new Date().toISOString()
            : null,
        };
      })
    );
    try {
      await adminSetStatus(orderId, nextStatus);
      if (selectedOrderId === orderId) {
        setDraft((current) => {
          if (!current) return current;
          const next = { ...current, status: nextStatus };
          setSavedSnapshot(JSON.stringify(draftPayload(next)));
          return next;
        });
      }
    } catch (err) {
      setOrders(previous);
      setListError(err.message || "Could not update status.");
    }
  }

  function handleRequestDelete(ordersToDelete) {
    const list = (Array.isArray(ordersToDelete)
      ? ordersToDelete
      : [ordersToDelete]
    )
      .filter(Boolean)
      .map((order) => ({
        id: order.id,
        display_id: order.display_id,
      }));
    if (list.length === 0) return;
    setDeleteTargets(list);
  }

  const handleCancelDelete = useCallback(() => {
    if (!deletingOrder) setDeleteTargets(null);
  }, [deletingOrder]);

  async function handleConfirmDelete() {
    if (!deleteTargets?.length) return;
    setDeletingOrder(true);
    setListError("");
    const ids = deleteTargets.map((order) => order.id);
    try {
      await adminDeleteOrders(ids);
      const deleted = new Set(ids);
      setOrders((current) => current.filter((order) => !deleted.has(order.id)));
      if (selectedOrderId && deleted.has(selectedOrderId)) {
        setSelectedOrderId(null);
        setSelectedDisplayId(null);
        setDraft(null);
        setSavedSnapshot("");
        setEditorError("");
      }
      setDeleteTargets(null);
    } catch (err) {
      setListError(err.message || "Could not delete order.");
    } finally {
      setDeletingOrder(false);
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
              onRequestDelete={handleRequestDelete}
              selectedOrderId={selectedOrderId}
              loadingOrderId={loadingOrderId}
            />
          )}

          <DeleteOrderDialog
            orders={deleteTargets}
            deleting={deletingOrder}
            onCancel={handleCancelDelete}
            onConfirm={handleConfirmDelete}
          />

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

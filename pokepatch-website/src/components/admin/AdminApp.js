"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import SectionHeading from "@/components/SectionHeading";
import { CardPhotoPreviewGrid } from "@/components/CardPhotoPreviews";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminAllowedEmail } from "@/lib/adminAccess";
import {
  adminDeleteOrders,
  adminGetOrder,
  adminListOrders,
  adminLoginWithSession,
  adminLogout,
  adminSaveOrder,
  adminSetStatus,
  adminValidate,
  isAdminApiConfigured,
} from "@/lib/adminApi";
import { supabase } from "@/lib/supabaseClient";
import GalleryManager from "@/components/admin/GalleryManager";
import StudioTool from "@/components/StudioTool";
import QuoteReceipt from "@/components/QuoteReceipt";
import {
  ORDER_STATUSES,
  ACTIVE_ORDER_STATUSES,
  CLOSED_ORDER_STATUSES,
  groupOrdersByStatus,
  normalizeOrderStatus,
  orderStatusHeadingClass,
  orderStatusLabel,
  orderStatusBadgeClass,
  isClosedOrderStatus,
  filterClosedColumnOrders,
} from "@/lib/orderStatus";
import {
  QUOTE_SERVICES,
  SERVICE_KEYS,
  HV_PERCENT_OPTIONS,
  analyzeQuoteCardCoverage,
  bulkPerCardOff,
  bulkTotalOff,
  defaultBaseAmount,
  defaultServiceLabel,
  formatMoney,
  highValueSurchargeFromValue,
  normalizeBulkCalcs,
  normalizeBulkEntry,
  parseMoneyInput,
  quoteItemCardLabel,
  suggestBulkCalcsFromItems,
} from "@/lib/servicePricing";

function newClientId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function findMatchingOrderCardId(item, cards) {
  const name = (item?.card_name || "").trim().toLowerCase();
  const set = (item?.set_name || "").trim().toLowerCase();
  if (!name) return null;
  const match = (cards ?? []).find(
    (card) =>
      (card.card_name || "").trim().toLowerCase() === name &&
      (card.set_name || "").trim().toLowerCase() === set
  );
  return match?.id != null ? String(match.id) : null;
}

function emptyQuoteItem(serviceKey = SERVICE_KEYS.SURFACE) {
  const base = defaultBaseAmount(serviceKey);
  return {
    id: newClientId(),
    card_pick: "",
    card_name: "",
    set_name: "",
    service_key: serviceKey,
    service_label: defaultServiceLabel(serviceKey),
    quote_base_amount: base != null ? String(base) : "",
    high_value_surcharge: "",
  };
}

function cleanBulkCalcs(calcs) {
  const normalized = normalizeBulkCalcs(calcs);
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function moneyFieldToPayload(value) {
  const parsed = parseMoneyInput(value);
  return parsed;
}

const ADMIN_TABS = [
  {
    id: "orders",
    label: "Orders",
    path: "/admin/orders/",
    title: "Orders admin",
    subtitle:
      "Drag rows between columns to update status. Hover to inspect, click to edit. Closed columns show the last 7 days — use Show all for older orders. Right-click or drag to the bin to delete.",
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

const ORDERS_ALL_META = {
  id: "orders-all",
  title: "All orders",
  subtitle:
    "Spreadsheet view of every order. Click a row to open it.",
};

const ORDERS_EDIT_META = {
  id: "orders-edit",
  title: "Edit order",
  subtitle: "",
};

function tabFromPathname(pathname) {
  const path = pathname?.replace(/\/$/, "") ?? "";
  if (path.endsWith("/admin/orders/all")) return "orders-all";
  const match = ADMIN_TABS.find((entry) =>
    path.startsWith(entry.path.replace(/\/$/, "")),
  );
  return match?.id ?? "orders";
}

const CONTACT_TYPES = [
  { value: "phone", label: "Phone" },
  { value: "discord", label: "Discord" },
  { value: "instagram", label: "Instagram" },
];

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

function deliveryShortLabel(value) {
  if (value === "local_dropoff") return "Local";
  if (value === "shipping") return "Ship";
  return deliveryLabel(value);
}

function orderToDraft(order) {
  const orderCards = order.cards ?? [];
  const quoteItems = (order.quote_items ?? []).map((item) => {
    const card_name = item.card_name ?? "";
    const set_name = item.set_name ?? "";
    const matchedId = findMatchingOrderCardId(
      { card_name, set_name },
      orderCards
    );
    return {
      id: item.id ?? newClientId(),
      card_pick: matchedId ?? "",
      card_name,
      set_name,
      service_key: item.service_key ?? SERVICE_KEYS.CUSTOM,
      service_label: item.service_label ?? "",
      quote_base_amount:
        item.quote_base_amount != null ? String(item.quote_base_amount) : "",
      high_value_surcharge:
        item.high_value_surcharge != null
          ? String(item.high_value_surcharge)
          : "",
    };
  });
  const suggestedCalcs = suggestBulkCalcsFromItems(quoteItems);
  const storedCalcs =
    order.quote_bulk_counts &&
    typeof order.quote_bulk_counts === "object" &&
    !Array.isArray(order.quote_bulk_counts)
      ? normalizeBulkCalcs(order.quote_bulk_counts)
      : null;
  const hasOverride =
    (order.quote_override_label != null &&
      String(order.quote_override_label).trim() !== "") ||
    order.quote_override_amount != null;

  return {
    customer_name: order.customer_name ?? "",
    customer_email: order.customer_email ?? "",
    delivery_method: order.delivery_method ?? "local_dropoff",
    general_notes: order.general_notes ?? "",
    photos_drive_url: order.photos_drive_url ?? "",
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
    })),
    quote_items: quoteItems,
    quote_bulk_counts: Object.keys(storedCalcs ?? {}).length
      ? storedCalcs
      : suggestedCalcs,
    quote_override_enabled: hasOverride,
    quote_override_label: order.quote_override_label ?? "",
    quote_override_amount:
      order.quote_override_amount != null
        ? String(order.quote_override_amount)
        : "",
  };
}

function draftPayload(draft) {
  const overrideEnabled = Boolean(draft.quote_override_enabled);
  const overrideLabel = draft.quote_override_label.trim();
  const overrideAmount = overrideEnabled
    ? moneyFieldToPayload(draft.quote_override_amount)
    : null;

  return {
    order: {
      customer_name: draft.customer_name.trim(),
      delivery_method: draft.delivery_method,
      general_notes: draft.general_notes.trim(),
      photos_drive_url: draft.photos_drive_url.trim(),
      status: draft.status,
      quote_bulk_counts: cleanBulkCalcs(draft.quote_bulk_counts),
      quote_override_label: overrideEnabled ? overrideLabel : "",
      quote_override_amount: overrideEnabled ? overrideAmount : null,
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
    quote_items: (draft.quote_items ?? []).map((item, index) => {
      const linked =
        item.card_pick && item.card_pick !== "custom"
          ? draft.cards.find(
              (card) => String(card.id) === String(item.card_pick)
            )
          : null;
      const card_name = (linked?.card_name ?? item.card_name).trim();
      const set_name = (linked?.set_name ?? item.set_name).trim();
      return {
        id: item.id,
        sort_order: index,
        card_name,
        set_name,
        service_key: item.service_key,
        service_label: item.service_label.trim(),
        quote_base_amount: moneyFieldToPayload(item.quote_base_amount),
        high_value_surcharge: moneyFieldToPayload(item.high_value_surcharge),
      };
    }),
  };
}

function validateDraftForSave(draft) {
  if (!draft.customer_name.trim()) {
    return "Customer name is required.";
  }
  const driveUrl = draft.photos_drive_url.trim();
  if (driveUrl) {
    try {
      const parsed = new URL(driveUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "Google Drive link must be an http(s) URL.";
      }
    } catch {
      return "Google Drive link must be a valid URL.";
    }
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
  for (let index = 0; index < (draft.quote_items ?? []).length; index += 1) {
    const item = draft.quote_items[index];
    if (!item.card_name.trim()) {
      return `Quote line ${index + 1} needs a card name.`;
    }
    if (!item.service_label.trim()) {
      return `Quote line ${index + 1} needs a service label.`;
    }
    if (moneyFieldToPayload(item.quote_base_amount) == null) {
      return `Quote line ${index + 1} needs a valid base amount.`;
    }
    if (
      item.high_value_surcharge.trim() !== "" &&
      moneyFieldToPayload(item.high_value_surcharge) == null
    ) {
      return `Quote line ${index + 1} has an invalid high-value surcharge.`;
    }
  }
  if (draft.quote_override_enabled) {
    if (!draft.quote_override_label.trim()) {
      return "Quote override needs a label, or turn the override off.";
    }
    if (moneyFieldToPayload(draft.quote_override_amount) == null) {
      return "Quote override needs a valid amount, or turn the override off.";
    }
  }
  return null;
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

const INSPECT_OPEN_DELAY_MS = 150;
const INSPECT_CLOSE_DELAY_MS = 100;
const INSPECT_PANEL_WIDTH = 280;
const INSPECT_CURSOR_OFFSET = 14;
const INSPECT_PANEL_HEIGHT_ESTIMATE = 220;

function clampInspectPosition(clientX, clientY, panelHeight = INSPECT_PANEL_HEIGHT_ESTIMATE) {
  let left = clientX + INSPECT_CURSOR_OFFSET;
  let top = clientY + INSPECT_CURSOR_OFFSET;

  if (left + INSPECT_PANEL_WIDTH > window.innerWidth - 8) {
    left = clientX - INSPECT_PANEL_WIDTH - INSPECT_CURSOR_OFFSET;
  }
  if (top + panelHeight > window.innerHeight - 8) {
    top = clientY - panelHeight - INSPECT_CURSOR_OFFSET;
  }

  return {
    left: Math.max(8, Math.min(left, window.innerWidth - INSPECT_PANEL_WIDTH - 8)),
    top: Math.max(8, Math.min(top, window.innerHeight - panelHeight - 8)),
  };
}

function KanbanCard({
  order,
  onOpen,
  onContextMenu,
  dragging,
}) {
  const panelElRef = useRef(null);
  const cursorRef = useRef({ x: 0, y: 0 });
  const openTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [panelPos, setPanelPos] = useState(null);

  const cardCount = order.card_count ?? order.cards?.length ?? 0;
  const previewUrls = Array.isArray(order.preview_urls)
    ? order.preview_urls.filter(Boolean).slice(0, 4)
    : [];
  const thumbUrl = previewUrls[0] ?? null;
  const hasMore = cardCount > previewUrls.length && previewUrls.length > 0;
  const metaChip = `${cardCount} · ${deliveryShortLabel(order.delivery_method)}`;

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const placeAtCursor = useCallback((clientX, clientY, { syncState = false } = {}) => {
    cursorRef.current = { x: clientX, y: clientY };
    const height =
      panelElRef.current?.offsetHeight ?? INSPECT_PANEL_HEIGHT_ESTIMATE;
    const next = clampInspectPosition(clientX, clientY, height);
    if (panelElRef.current) {
      panelElRef.current.style.top = `${next.top}px`;
      panelElRef.current.style.left = `${next.left}px`;
    }
    if (syncState || !panelElRef.current) {
      setPanelPos(next);
    }
  }, []);

  const showInspect = useCallback(() => {
    clearTimers();
    const { x, y } = cursorRef.current;
    placeAtCursor(x, y, { syncState: true });
    setInspectOpen(true);
  }, [clearTimers, placeAtCursor]);

  const hideInspect = useCallback(() => {
    clearTimers();
    setInspectOpen(false);
  }, [clearTimers]);

  const scheduleOpen = useCallback(() => {
    if (dragging) return;
    clearTimers();
    openTimerRef.current = setTimeout(showInspect, INSPECT_OPEN_DELAY_MS);
  }, [clearTimers, dragging, showInspect]);

  const scheduleClose = useCallback(() => {
    clearTimers();
    closeTimerRef.current = setTimeout(hideInspect, INSPECT_CLOSE_DELAY_MS);
  }, [clearTimers, hideInspect]);

  function handleMouseEnter(event) {
    placeAtCursor(event.clientX, event.clientY, { syncState: true });
    scheduleOpen();
  }

  function handleMouseMove(event) {
    placeAtCursor(event.clientX, event.clientY, {
      syncState: !inspectOpen,
    });
  }

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (dragging) hideInspect();
  }, [dragging, hideInspect]);

  useEffect(() => {
    if (!inspectOpen) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") hideInspect();
    }
    // Re-measure once the panel is in the DOM so viewport clamping is accurate.
    const { x, y } = cursorRef.current;
    placeAtCursor(x, y, { syncState: true });
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inspectOpen, hideInspect, placeAtCursor]);

  const card = (
    <div
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu?.(event, order);
      }}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={scheduleClose}
      className={`relative flex w-full items-center gap-2 rounded-lg border-2 border-ink/10 bg-cream px-2 py-1.5 text-left shadow-cozy-sm transition hover:border-blush/60 ${
        dragging ? "opacity-50" : ""
      }`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => onOpen(order.id)}
        onFocus={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          placeAtCursor(rect.left + rect.width / 2, rect.top + rect.height / 2, {
            syncState: true,
          });
          scheduleOpen();
        }}
        onBlur={scheduleClose}
        aria-describedby={
          inspectOpen ? `order-inspect-${order.id}` : undefined
        }
      >
        <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
          #{order.display_id}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {order.customer_name}
        </span>
        <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-ink/55">
          {metaChip}
        </span>
        <span className="relative aspect-[3/4] w-7 shrink-0 overflow-hidden rounded bg-night/50">
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : null}
          {cardCount > 1 && (
            <span className="absolute inset-x-0 bottom-0 bg-night/75 py-px text-center text-[9px] font-bold leading-none text-cream">
              {cardCount}
            </span>
          )}
        </span>
      </button>
    </div>
  );

  const inspectPortal =
    inspectOpen &&
    panelPos &&
    typeof document !== "undefined" &&
    createPortal(
      <div className="pointer-events-none fixed inset-0 z-[200]">
        <div
          ref={panelElRef}
          role="tooltip"
          id={`order-inspect-${order.id}`}
          className="absolute rounded-xl border-2 border-ink/15 bg-cream p-3 shadow-cozy"
          style={{
            top: panelPos.top,
            left: panelPos.left,
            width: INSPECT_PANEL_WIDTH,
          }}
        >
          <p className="text-sm font-bold tabular-nums text-ink">
            #{order.display_id}
          </p>
          <p className="mt-1 text-sm font-semibold text-ink">
            {order.customer_name}
          </p>
          <p className="mt-1 text-xs text-ink/60">
            {cardCount} card{cardCount === 1 ? "" : "s"} ·{" "}
            {deliveryLabel(order.delivery_method)}
          </p>
          <p className="mt-0.5 text-xs text-ink/50">
            {formatDate(order.created_at)}
          </p>
          <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-ink/10 bg-night/40 p-1.5">
            {previewUrls.length === 0 ? (
              <div className="aspect-[3/4] w-12 rounded-md bg-night/50" />
            ) : (
              previewUrls.map((url, index) => {
                const showMoreOverlay =
                  hasMore && index === previewUrls.length - 1;
                return (
                  <div
                    key={`${url}-${index}`}
                    className="relative aspect-[3/4] w-12 shrink-0 overflow-hidden rounded-md bg-night/50"
                  >
                    <img
                      src={url}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                    {showMoreOverlay && (
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
      </div>,
      document.body
    );

  return (
    <>
      {card}
      {inspectPortal}
    </>
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
              className="text-xl font-bold text-ink"
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

function formatDateShort(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function OrdersAllList({ orders, onOpenOrder }) {
  const sorted = useMemo(() => {
    return [...(orders ?? [])].sort((a, b) => {
      const aId = Number(a.display_id) || 0;
      const bId = Number(b.display_id) || 0;
      return bId - aId;
    });
  }, [orders]);

  if (sorted.length === 0) {
    return (
      <p className="rounded border border-dashed border-ink/20 px-4 py-10 text-center text-sm text-ink/50">
        No orders yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-ink/20 bg-cream">
      <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-ink/20 bg-night/40 text-xs font-semibold uppercase tracking-wide text-ink/60">
            <th className="whitespace-nowrap px-3 py-2">#</th>
            <th className="whitespace-nowrap px-3 py-2">Customer</th>
            <th className="whitespace-nowrap px-3 py-2">Email</th>
            <th className="whitespace-nowrap px-3 py-2">Status</th>
            <th className="whitespace-nowrap px-3 py-2">Cards</th>
            <th className="whitespace-nowrap px-3 py-2">Delivery</th>
            <th className="whitespace-nowrap px-3 py-2">Created</th>
            <th className="whitespace-nowrap px-3 py-2">Closed</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((order) => {
            const status = normalizeOrderStatus(order.status);
            const cardCount = order.card_count ?? order.cards?.length ?? 0;
            return (
              <tr
                key={order.id}
                onClick={() => onOpenOrder(order.id)}
                className="cursor-pointer border-b border-ink/10 odd:bg-night/15 transition hover:bg-blush/20"
              >
                <td className="whitespace-nowrap px-3 py-1.5 font-semibold tabular-nums text-ink">
                  {order.display_id}
                </td>
                <td className="max-w-[12rem] truncate px-3 py-1.5 font-medium text-ink">
                  {order.customer_name}
                </td>
                <td className="max-w-[14rem] truncate px-3 py-1.5 text-ink/70">
                  {order.customer_email || "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${orderStatusBadgeClass(
                      status
                    )}`}
                  >
                    {orderStatusLabel(status)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-ink/80">
                  {cardCount}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-ink/70">
                  {deliveryShortLabel(order.delivery_method)}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-ink/60">
                  {formatDateShort(order.created_at)}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-ink/60">
                  {isClosedOrderStatus(status)
                    ? formatDateShort(order.completed_at) || "—"
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function KanbanBoard({
  orders,
  onOpenOrder,
  onStatusChange,
  onRequestDelete,
  onViewAllOrders,
}) {
  const [dragOrderId, setDragOrderId] = useState(null);
  const [trashArmed, setTrashArmed] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);

  const columns = useMemo(() => groupOrdersByStatus(orders), [orders]);
  const dragOrder = useMemo(
    () => orders.find((order) => order.id === dragOrderId) ?? null,
    [orders, dragOrderId]
  );

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
    onRequestDelete([order]);
  }

  function handleCardContextMenu(event, order) {
    setContextMenu({
      order,
      x: Math.min(event.clientX, window.innerWidth - 200),
      y: Math.min(event.clientY, window.innerHeight - 100),
    });
  }

  function renderColumn(status, { closed }) {
    const rawOrders = columns[status.id] ?? [];
    const columnOrders = closed
      ? filterClosedColumnOrders(rawOrders)
      : rawOrders;
    const hiddenCount = closed
      ? Math.max(0, rawOrders.length - columnOrders.length)
      : 0;

    return (
      <section
        key={status.id}
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border-2 border-ink/10 bg-night/40 p-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, status.id)}
      >
        <div className="mb-3 flex shrink-0 flex-nowrap items-center justify-between gap-2">
          <h2
            className={`min-w-0 truncate text-base font-bold leading-none sm:text-lg ${orderStatusHeadingClass(
              status.id
            )}`}
          >
            {status.label}
            {rawOrders.length > 0 && (
              <span className="ml-1.5 text-sm font-semibold text-ink/40">
                {rawOrders.length}
              </span>
            )}
          </h2>
          {closed && hiddenCount > 0 && (
            <button
              type="button"
              onClick={onViewAllOrders}
              className="shrink-0 whitespace-nowrap text-xs font-semibold text-ink/60 underline-offset-2 hover:text-ink hover:underline"
            >
              Show all
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-0.5">
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
                onContextMenu={handleCardContextMenu}
                dragging={dragOrderId === order.id}
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
          {closed && hiddenCount > 0 && (
            <button
              type="button"
              onClick={onViewAllOrders}
              className="w-full rounded-lg border border-dashed border-ink/20 px-2 py-2 text-center text-xs font-semibold text-ink/50 transition hover:border-blush/50 hover:text-ink/70"
            >
              +{hiddenCount} older than 7 days — show all
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onViewAllOrders}
          className="rounded-xl border-2 border-ink/20 px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-blush"
        >
          View all orders
        </button>
      </div>

      <div className="grid h-[min(66vh,calc(100dvh-16rem))] grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {ACTIVE_ORDER_STATUSES.map((status) =>
          renderColumn(status, { closed: false })
        )}
        {CLOSED_ORDER_STATUSES.map((status) =>
          renderColumn(status, { closed: true })
        )}
      </div>

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
              ? `Release to delete #${dragOrder?.display_id ?? ""}`
              : dragOrderId
                ? "Drop here to delete"
                : "Recycling bin"}
          </p>
          <p className="mt-0.5 text-xs opacity-80">
            {dragOrderId
              ? "You’ll confirm before anything is deleted"
              : "Right-click or drag here — always confirms first"}
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
              const order = contextMenu.order;
              setContextMenu(null);
              onRequestDelete([order]);
            }}
          >
            <TrashIcon className="h-4 w-4" />
            Delete order
          </button>
        </div>
      )}
    </div>
  );
}

function editorFieldClass() {
  return "w-full rounded-xl border border-ink/15 bg-cream px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-blush";
}

function EditorSection({ title, action, children }) {
  return (
    <section className="rounded-2xl border border-ink/10 bg-cream/80 p-5 shadow-cozy-sm sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {action ?? null}
      </div>
      {children}
    </section>
  );
}

function EditorLabel({ children }) {
  return (
    <span className="mb-1.5 block text-sm font-medium text-ink/65">
      {children}
    </span>
  );
}

function OrderEditor({
  displayId,
  draft,
  dirty,
  saving,
  error,
  onBack,
  backLabel = "Back",
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
      contacts: [...draft.contacts, { contact_type: "phone", value: "" }],
    });
  }

  function removeContact(index) {
    updateDraft({
      contacts: draft.contacts.filter((_, i) => i !== index),
    });
  }

  function updateCard(index, patch) {
    const cards = draft.cards.map((card, i) =>
      i === index ? { ...card, ...patch } : card
    );
    const updated = cards[index];
    const touchesName = "card_name" in patch || "set_name" in patch;
    if (!touchesName || updated?.id == null) {
      updateDraft({ cards });
      return;
    }
    const cardId = String(updated.id);
    const quote_items = (draft.quote_items ?? []).map((item) =>
      item.card_pick && String(item.card_pick) === cardId
        ? {
            ...item,
            card_name: updated.card_name ?? "",
            set_name: updated.set_name ?? "",
          }
        : item
    );
    updateDraft({ cards, quote_items });
  }

  function updateQuoteItem(index, patch) {
    const quote_items = (draft.quote_items ?? []).map((item, i) =>
      i === index ? { ...item, ...patch } : item
    );
    updateDraft({ quote_items });
  }

  function syncBulkCountsFromItems(quote_items) {
    return suggestBulkCalcsFromItems(quote_items);
  }

  function addQuoteItem() {
    const quote_items = [...(draft.quote_items ?? []), emptyQuoteItem()];
    updateDraft({
      quote_items,
      quote_bulk_counts: syncBulkCountsFromItems(quote_items),
    });
  }

  function removeQuoteItem(index) {
    const quote_items = (draft.quote_items ?? []).filter((_, i) => i !== index);
    updateDraft({
      quote_items,
      quote_bulk_counts: syncBulkCountsFromItems(quote_items),
    });
  }

  function applyCardPickToQuoteItem(index, cardId) {
    if (!cardId) {
      updateQuoteItem(index, {
        card_pick: "",
        card_name: "",
        set_name: "",
      });
      return;
    }
    const card = draft.cards.find((entry) => String(entry.id) === String(cardId));
    if (!card) return;
    updateQuoteItem(index, {
      card_pick: String(card.id),
      card_name: card.card_name ?? "",
      set_name: card.set_name ?? "",
    });
  }

  function quoteCardPickValue(item) {
    if (item.card_pick && item.card_pick !== "custom") {
      return String(item.card_pick);
    }
    return findMatchingOrderCardId(item, draft.cards) ?? "";
  }

  function applyServiceToQuoteItem(index, serviceKey) {
    const base = defaultBaseAmount(serviceKey);
    const label = defaultServiceLabel(serviceKey);
    const quote_items = (draft.quote_items ?? []).map((item, i) =>
      i === index
        ? {
            ...item,
            service_key: serviceKey,
            service_label:
              serviceKey === SERVICE_KEYS.CUSTOM
                ? item.service_label
                : label,
            quote_base_amount:
              base != null ? String(base) : item.quote_base_amount,
          }
        : item
    );
    updateDraft({
      quote_items,
      quote_bulk_counts: syncBulkCountsFromItems(quote_items),
    });
  }

  function applyHvSuggestion(index, percent) {
    if (Number(percent) === 0) {
      updateQuoteItem(index, { high_value_surcharge: "" });
      return;
    }
    const item = draft.quote_items[index];
    const amount = highValueSurchargeFromValue(
      item.quote_base_amount,
      percent
    );
    if (amount == null) return;
    updateQuoteItem(index, { high_value_surcharge: String(amount) });
  }

  function setBulkCount(serviceKey, value) {
    const count =
      value === "" ? 0 : Math.max(0, Math.floor(Number(value) || 0));
    const prev = normalizeBulkEntry(
      draft.quote_bulk_counts?.[serviceKey],
      serviceKey
    );
    updateDraft({
      quote_bulk_counts: {
        ...(draft.quote_bulk_counts ?? {}),
        [serviceKey]: {
          count,
          // Refresh tier default when count changes; admin can re-override off.
          per_card_off:
            prev.count === count
              ? prev.per_card_off
              : bulkPerCardOff(serviceKey, count),
        },
      },
    });
  }

  function setBulkPerCardOff(serviceKey, value) {
    const prev = normalizeBulkEntry(
      draft.quote_bulk_counts?.[serviceKey],
      serviceKey
    );
    const per_card_off =
      value === "" ? 0 : Number.isFinite(Number(value)) ? Number(value) : 0;
    updateDraft({
      quote_bulk_counts: {
        ...(draft.quote_bulk_counts ?? {}),
        [serviceKey]: {
          count: prev.count,
          per_card_off,
        },
      },
    });
  }

  function resetBulkCountsFromLines() {
    updateDraft({
      quote_bulk_counts: syncBulkCountsFromItems(draft.quote_items),
    });
  }

  const quoteItems = draft.quote_items ?? [];
  const receiptItems = quoteItems.map((item) => ({
    id: item.id,
    card_name: item.card_name,
    set_name: item.set_name,
    service_label: item.service_label,
    quote_base_amount: moneyFieldToPayload(item.quote_base_amount) ?? 0,
    high_value_surcharge: moneyFieldToPayload(item.high_value_surcharge),
  }));
  const receiptBulkCounts = cleanBulkCalcs(draft.quote_bulk_counts);
  const receiptOverrideAmount = draft.quote_override_enabled
    ? moneyFieldToPayload(draft.quote_override_amount)
    : null;
  const bulkServiceKeys = [
    ...new Set([
      ...Object.keys(draft.quote_bulk_counts ?? {}),
      ...quoteItems
        .map((item) => item.service_key)
        .filter((key) => key && key !== SERVICE_KEYS.CUSTOM),
    ]),
  ].filter((key) => key !== SERVICE_KEYS.CUSTOM);
  const quoteCoverage = analyzeQuoteCardCoverage(draft.cards, quoteItems);

  const driveUrl = draft.photos_drive_url.trim();

  return (
    <div
      className={`mx-auto max-w-3xl space-y-5 ${
        saving ? "pointer-events-none opacity-60" : ""
      }`}
    >
      <div className="space-y-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-medium text-ink/55 transition hover:text-ink"
          >
            ← {backLabel}
          </button>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h2 className="text-2xl font-bold tabular-nums tracking-tight text-ink sm:text-3xl">
              Order #{displayId}
            </h2>
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${orderStatusBadgeClass(
                draft.status
              )}`}
            >
              {orderStatusLabel(draft.status)}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving || !dirty}
              className="rounded-xl border border-ink/20 bg-cream px-4 py-2 text-sm font-semibold text-ink transition hover:border-blush disabled:opacity-40"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !dirty}
              className="rounded-xl bg-berry px-4 py-2 text-sm font-semibold text-night shadow-cozy-sm transition hover:brightness-110 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm text-berry">
          {error}
        </p>
      )}

      <EditorSection title="Customer">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <EditorLabel>Customer name</EditorLabel>
            <input
              className={editorFieldClass()}
              value={draft.customer_name}
              onChange={(event) =>
                updateDraft({ customer_name: event.target.value })
              }
            />
          </label>
          {draft.customer_email ? (
            <div>
              <EditorLabel>Email</EditorLabel>
              <p className="truncate rounded-xl border border-transparent px-3.5 py-2.5 text-sm text-ink/70">
                {draft.customer_email}
              </p>
            </div>
          ) : null}
          <label className="block">
            <EditorLabel>Delivery</EditorLabel>
            <select
              className={editorFieldClass()}
              value={draft.delivery_method}
              onChange={(event) =>
                updateDraft({ delivery_method: event.target.value })
              }
            >
              <option value="local_dropoff">Local drop-off</option>
              <option value="shipping">Shipping</option>
            </select>
          </label>
          <label className="block">
            <EditorLabel>Status</EditorLabel>
            <select
              className={editorFieldClass()}
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
          <label className="block sm:col-span-2">
            <EditorLabel>Notes</EditorLabel>
            <textarea
              className={`${editorFieldClass()} min-h-[88px]`}
              value={draft.general_notes}
              onChange={(event) =>
                updateDraft({ general_notes: event.target.value })
              }
            />
          </label>
        </div>
      </EditorSection>

      <EditorSection
        title="Quote"
        action={
          quoteItems.length > 0 ? (
            <button
              type="button"
              onClick={addQuoteItem}
              className="text-sm font-semibold text-berry transition hover:underline"
            >
              Add line
            </button>
          ) : null
        }
      >
        {quoteItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-berry/40 bg-berry/5 px-4 py-5 text-center">
            <p className="text-sm text-ink/70">
              No quote on this order yet. Add priced lines here — customers see
              them under My Orders after you save.
            </p>
            <button
              type="button"
              onClick={addQuoteItem}
              className="mt-3 rounded-xl bg-berry px-4 py-2 text-sm font-semibold text-night shadow-cozy-sm transition hover:brightness-110"
            >
              Add quote line
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {quoteItems.map((item, index) => {
              const base = moneyFieldToPayload(item.quote_base_amount) ?? 0;
              const hv = moneyFieldToPayload(item.high_value_surcharge) ?? 0;
              const lineTotal = base + hv;
              return (
              <div
                key={item.id ?? `quote-${index}`}
                className="space-y-2 rounded-xl border border-ink/10 bg-night/5 px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.06em] text-ink/45">
                    Line {index + 1}
                  </p>
                  <div className="flex items-center gap-3">
                    <p className="text-right text-sm tabular-nums text-ink">
                      <span className="text-ink/65">
                        {formatMoney(base)}
                        {hv !== 0 ? <> + {formatMoney(hv)}</> : null}
                        {" "}
                        =
                      </span>{" "}
                      <span className="font-bold">{formatMoney(lineTotal)}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => removeQuoteItem(index)}
                      className="text-xs font-semibold text-ink/40 transition hover:text-berry"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block min-w-0">
                    <span className="mb-1 block text-xs font-medium text-ink/55">
                      Card
                    </span>
                    {draft.cards.length > 0 ? (
                      <select
                        className={editorFieldClass()}
                        value={quoteCardPickValue(item)}
                        onChange={(event) =>
                          applyCardPickToQuoteItem(index, event.target.value)
                        }
                      >
                        <option value="">Select a card…</option>
                        {draft.cards.map((card) => (
                          <option key={card.id} value={card.id}>
                            {quoteItemCardLabel(card)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="rounded-xl border border-ink/10 bg-night/10 px-3 py-2 text-xs text-ink/50">
                        No cards on this order yet.
                      </p>
                    )}
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-1 block text-xs font-medium text-ink/55">
                      Service
                    </span>
                    <select
                      className={editorFieldClass()}
                      value={item.service_key}
                      onChange={(event) =>
                        applyServiceToQuoteItem(index, event.target.value)
                      }
                    >
                      {QUOTE_SERVICES.map((service) => (
                        <option key={service.key} value={service.key}>
                          {service.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {item.service_key === SERVICE_KEYS.CUSTOM ? (
                    <label className="block min-w-0 sm:col-span-2">
                      <span className="mb-1 block text-xs font-medium text-ink/55">
                        Service label
                      </span>
                      <input
                        className={editorFieldClass()}
                        value={item.service_label}
                        onChange={(event) =>
                          updateQuoteItem(index, {
                            service_label: event.target.value,
                          })
                        }
                        placeholder="Custom service name"
                      />
                    </label>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="block min-w-0 sm:w-32">
                    <span className="mb-1 block text-xs font-medium text-ink/55">
                      Base ($)
                    </span>
                    <input
                      className={editorFieldClass()}
                      inputMode="decimal"
                      value={item.quote_base_amount}
                      onChange={(event) =>
                        updateQuoteItem(index, {
                          quote_base_amount: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="block min-w-0 sm:w-32">
                    <span className="mb-1 block text-xs font-medium text-ink/55">
                      HV surcharge ($)
                    </span>
                    <input
                      className={editorFieldClass()}
                      inputMode="decimal"
                      value={item.high_value_surcharge}
                      onChange={(event) =>
                        updateQuoteItem(index, {
                          high_value_surcharge: event.target.value,
                        })
                      }
                      placeholder="0"
                    />
                  </label>
                  <div className="flex flex-wrap gap-1.5 pb-0.5">
                    {HV_PERCENT_OPTIONS.map((option) => (
                      <button
                        key={option.percent}
                        type="button"
                        onClick={() =>
                          applyHvSuggestion(index, option.percent)
                        }
                        className="rounded-lg border border-ink/15 bg-cream px-2.5 py-1.5 text-xs font-semibold text-ink transition hover:border-berry"
                        title={`${option.percent}% of quote base amount`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}

        {quoteItems.length > 0 || (draft.cards ?? []).length > 0 ? (
          <div className="mt-4 space-y-2 rounded-xl border border-lavender/40 bg-lavender/20 px-3 py-3">
            <EditorLabel>Service coverage</EditorLabel>
            {quoteCoverage.assignments.length > 0 ? (
              <ul className="space-y-1 text-sm text-ink/80">
                {quoteCoverage.assignments.map((row) => (
                  <li key={`${row.number}-${row.label}`}>
                    <span className="font-semibold text-ink">
                      {row.number}. {row.label}
                    </span>
                    <span className="text-ink/50"> — </span>
                    {row.services
                      .map((service) =>
                        service.count > 1
                          ? `${service.label} (×${service.count})`
                          : service.label
                      )
                      .join(", ")}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink/45">
                No services assigned to cards yet.
              </p>
            )}

            {quoteCoverage.uncoveredCards.length > 0 ? (
              <p className="rounded-lg border-2 border-berry bg-berry/35 px-2.5 py-2 text-xs text-ink">
                <span className="font-semibold text-berry">
                  Missing service:
                </span>{" "}
                {quoteCoverage.uncoveredCards
                  .map((row) => `${row.number}. ${row.label}`)
                  .join(", ")}
              </p>
            ) : null}

            {quoteCoverage.duplicateServiceCards.length > 0 ? (
              <p className="rounded-lg border-2 border-berry bg-berry/35 px-2.5 py-2 text-xs text-ink">
                <span className="font-semibold text-berry">
                  Same service more than once:
                </span>{" "}
                {quoteCoverage.duplicateServiceCards
                  .map(
                    (row) =>
                      `${row.number}. ${row.label} (${row.services
                        .map((s) => `${s.label} ×${s.count}`)
                        .join(", ")})`
                  )
                  .join("; ")}
              </p>
            ) : null}

            {quoteCoverage.uncoveredCards.length === 0 &&
            quoteCoverage.duplicateServiceCards.length === 0 &&
            quoteCoverage.assignments.length > 0 &&
            (draft.cards ?? []).length > 0 ? (
              <p className="text-xs text-ink/45">
                Every order card has a service, with no duplicates.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 space-y-3 border-t border-ink/10 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <EditorLabel>Bulk calculations</EditorLabel>
              <p className="text-xs text-ink/50">
                Card counts update when you change a line’s service. Per-card
                discount defaults from pricing tiers and can be overridden.
              </p>
            </div>
            <button
              type="button"
              onClick={resetBulkCountsFromLines}
              className="text-sm font-semibold text-berry transition hover:underline"
            >
              Check for bulk counts
            </button>
          </div>
          {bulkServiceKeys.length === 0 ? (
            <p className="text-sm text-ink/45">
              Add quote lines with a service to see bulk calculations.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-ink/10">
              <div className="min-w-[28rem] px-3 py-2">
                <div className="grid grid-cols-[minmax(8rem,1.4fr)_4.5rem_auto_5.5rem_auto_5.5rem] items-center gap-x-2 border-b border-ink/10 pb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink/45">
                    Service
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink/45">
                    Count
                  </span>
                  <span className="text-[11px] font-semibold text-ink/35">
                    ×
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink/45">
                    Discount (−$/card)
                  </span>
                  <span className="text-[11px] font-semibold text-ink/35">
                    =
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink/45">
                    Result
                  </span>
                </div>

                <div className="divide-y divide-ink/10">
                  {bulkServiceKeys.map((serviceKey) => {
                    const service = QUOTE_SERVICES.find(
                      (s) => s.key === serviceKey
                    );
                    const entry = normalizeBulkEntry(
                      draft.quote_bulk_counts?.[serviceKey],
                      serviceKey
                    );
                    const totalOff = bulkTotalOff(
                      serviceKey,
                      entry.count,
                      entry.per_card_off
                    );
                    return (
                      <div
                        key={serviceKey}
                        className="grid grid-cols-[minmax(8rem,1.4fr)_4.5rem_auto_5.5rem_auto_5.5rem] items-center gap-x-2 py-2.5"
                      >
                        <div className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink">
                            {service?.title ?? serviceKey}
                          </span>
                          <p className="mt-0.5 pl-2 text-[11px] leading-snug text-ink/40">
                            {(service?.bulkTiers ?? []).length > 0
                              ? (service.bulkTiers ?? [])
                                  .map(
                                    (tier) =>
                                      `${tier.minCount}+ → −$${tier.perCardOff}/card`
                                  )
                                  .join(" · ")
                              : "No bulk tiers."}
                          </p>
                        </div>
                        <input
                          className={`${editorFieldClass()} w-full`}
                          inputMode="numeric"
                          value={entry.count || ""}
                          onChange={(event) =>
                            setBulkCount(serviceKey, event.target.value)
                          }
                          placeholder="0"
                          aria-label={`${service?.title ?? serviceKey} card count`}
                        />
                        <span className="text-sm text-ink/45">×</span>
                        <input
                          className={`${editorFieldClass()} w-full`}
                          inputMode="decimal"
                          value={
                            entry.count > 0 || entry.per_card_off
                              ? entry.per_card_off
                              : ""
                          }
                          onChange={(event) =>
                            setBulkPerCardOff(serviceKey, event.target.value)
                          }
                          placeholder="0"
                          aria-label={`${service?.title ?? serviceKey} per-card discount`}
                        />
                        <span className="text-sm text-ink/45">=</span>
                        <span className="text-sm font-semibold tabular-nums text-ink">
                          {totalOff > 0
                            ? `−${formatMoney(totalOff)}`
                            : formatMoney(0)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 space-y-3 border-t border-ink/10 pt-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={Boolean(draft.quote_override_enabled)}
              onChange={(event) =>
                updateDraft({
                  quote_override_enabled: event.target.checked,
                  ...(event.target.checked
                    ? {}
                    : { quote_override_label: "", quote_override_amount: "" }),
                })
              }
            />
            Order override (optional)
          </label>
          {draft.quote_override_enabled ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <EditorLabel>Override label</EditorLabel>
                <input
                  className={editorFieldClass()}
                  value={draft.quote_override_label}
                  onChange={(event) =>
                    updateDraft({ quote_override_label: event.target.value })
                  }
                  placeholder="Rush / loyalty / etc."
                />
              </label>
              <label className="block">
                <EditorLabel>Override amount ($)</EditorLabel>
                <input
                  className={editorFieldClass()}
                  inputMode="decimal"
                  value={draft.quote_override_amount}
                  onChange={(event) =>
                    updateDraft({ quote_override_amount: event.target.value })
                  }
                  placeholder="Use negative for discount"
                />
              </label>
            </div>
          ) : null}
        </div>

        <QuoteReceipt
          className="mt-4"
          items={receiptItems}
          bulkCounts={receiptBulkCounts}
          overrideLabel={
            draft.quote_override_enabled
              ? draft.quote_override_label.trim()
              : ""
          }
          overrideAmount={receiptOverrideAmount}
        />
      </EditorSection>

      <EditorSection
        title="Google Drive"
        action={
          driveUrl ? (
            <a
              href={driveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-berry transition hover:underline"
            >
              Open folder
            </a>
          ) : null
        }
      >
        <label className="block">
          <EditorLabel>Folder link</EditorLabel>
          <input
            className={editorFieldClass()}
            type="url"
            inputMode="url"
            placeholder="https://drive.google.com/drive/folders/…"
            value={draft.photos_drive_url}
            onChange={(event) =>
              updateDraft({ photos_drive_url: event.target.value })
            }
          />
        </label>
      </EditorSection>

      <EditorSection
        title="Contacts"
        action={
          <button
            type="button"
            onClick={addContact}
            className="text-sm font-semibold text-berry transition hover:underline"
          >
            Add contact
          </button>
        }
      >
        {draft.contacts.length === 0 ? (
          <p className="text-sm text-ink/45">No contacts yet.</p>
        ) : (
          <div className="space-y-3">
            {draft.contacts.map((contact, index) => (
              <div
                key={contact.id ?? `new-${index}`}
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
              >
                <select
                  className={`${editorFieldClass()} sm:w-40 sm:shrink-0`}
                  value={contact.contact_type}
                  onChange={(event) =>
                    updateContact(index, {
                      contact_type: event.target.value,
                    })
                  }
                >
                  {CONTACT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <input
                  className={editorFieldClass()}
                  value={contact.value}
                  onChange={(event) =>
                    updateContact(index, { value: event.target.value })
                  }
                  placeholder="Contact value"
                />
                <button
                  type="button"
                  onClick={() => removeContact(index)}
                  aria-label="Remove contact"
                  className="shrink-0 rounded-xl px-3 py-2 text-sm font-semibold text-ink/40 transition hover:bg-berry/10 hover:text-berry sm:px-2"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </EditorSection>

      <div className="space-y-4">
        <h3 className="px-1 text-base font-semibold text-ink">Cards</h3>
        {draft.cards.map((card, cardIndex) => {
          const customerImages = (card.images ?? []).filter(
            (image) => image.image_type === "customer"
          );

          return (
            <EditorSection key={card.id} title={`Card ${cardIndex + 1}`}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <EditorLabel>Card name</EditorLabel>
                  <input
                    className={editorFieldClass()}
                    value={card.card_name}
                    onChange={(event) =>
                      updateCard(cardIndex, {
                        card_name: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="block">
                  <EditorLabel>Set</EditorLabel>
                  <input
                    className={editorFieldClass()}
                    value={card.set_name}
                    onChange={(event) =>
                      updateCard(cardIndex, { set_name: event.target.value })
                    }
                  />
                </label>
                <label className="block sm:col-span-2">
                  <EditorLabel>Description</EditorLabel>
                  <textarea
                    className={`${editorFieldClass()} min-h-[72px]`}
                    value={card.description}
                    onChange={(event) =>
                      updateCard(cardIndex, {
                        description: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              {customerImages.length > 0 ? (
                <div className="mt-4 border-t border-ink/10 pt-4">
                  <CardPhotoPreviewGrid
                    title="Customer photos"
                    items={savedPhotoItems(customerImages)}
                  />
                </div>
              ) : null}
            </EditorSection>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminApp() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const pathTab = tabFromPathname(pathname);
  const routeOrderId = searchParams.get("edit");
  const tab = routeOrderId ? "orders-edit" : pathTab;
  const editReturnPath =
    searchParams.get("from") === "all" ? "/admin/orders/all/" : "/admin/orders/";
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState("");
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
    return JSON.stringify(draftPayload(draft)) !== savedSnapshot;
  }, [draft, savedSnapshot]);

  const activeTab =
    tab === "orders-all"
      ? ORDERS_ALL_META
      : tab === "orders-edit"
        ? ORDERS_EDIT_META
        : (ADMIN_TABS.find((entry) => entry.id === tab) ?? ADMIN_TABS[0]);
  const ordersSectionActive =
    tab === "orders" || tab === "orders-all" || tab === "orders-edit";

  const clearEditor = useCallback(() => {
    setSelectedOrderId(null);
    setSelectedDisplayId(null);
    setDraft(null);
    setSavedSnapshot("");
    setEditorError("");
    setLoadingOrderId(null);
  }, []);

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

      // Reuse an existing admin token if still valid.
      const ok = await adminValidate();
      if (cancelled) return;
      if (ok) {
        setAuthed(true);
        setAuthError("");
        setReady(true);
        await refreshOrders();
        return;
      }

      // Wait for customer auth before attempting email-based admin login.
      if (authLoading) return;

      if (!user) {
        router.replace("/login?redirect=/admin/orders/");
        return;
      }

      if (!isAdminAllowedEmail(user.email)) {
        router.replace("/");
        return;
      }

      if (!supabase) {
        setAuthError("Supabase is not configured.");
        setAuthed(false);
        setReady(true);
        return;
      }

      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error("Missing session");
        await adminLoginWithSession(accessToken);
        if (cancelled) return;
        setAuthed(true);
        setAuthError("");
        setReady(true);
        await refreshOrders();
      } catch (err) {
        if (cancelled) return;
        setAuthError(err.message || "Could not start admin session.");
        setAuthed(false);
        setReady(true);
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [refreshOrders, user, authLoading, router]);

  useEffect(() => {
    if (tab !== "orders-edit") clearEditor();
  }, [tab, clearEditor]);

  useEffect(() => {
    if (!authed || tab !== "orders-edit" || !routeOrderId) return undefined;

    let cancelled = false;
    async function load() {
      setEditorError("");
      setLoadingOrderId(routeOrderId);
      setSelectedOrderId(routeOrderId);
      setDraft(null);
      try {
        const order = await adminGetOrder(routeOrderId);
        if (cancelled) return;
        const nextDraft = orderToDraft(order);
        setSelectedDisplayId(order.display_id);
        setDraft(nextDraft);
        setSavedSnapshot(JSON.stringify(draftPayload(nextDraft)));
      } catch (err) {
        if (cancelled) return;
        setSelectedOrderId(null);
        setSelectedDisplayId(null);
        setDraft(null);
        setEditorError(err.message || "Could not load order.");
      } finally {
        if (!cancelled) setLoadingOrderId(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [authed, tab, routeOrderId]);

  async function handleLogout() {
    await adminLogout();
    setAuthed(false);
    setOrders([]);
    clearEditor();
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
        clearEditor();
        router.push(editReturnPath);
      }
      setDeleteTargets(null);
    } catch (err) {
      setListError(err.message || "Could not delete order.");
    } finally {
      setDeletingOrder(false);
    }
  }

  function openOrder(orderId, { from } = {}) {
    const params = new URLSearchParams({ edit: String(orderId) });
    if (from === "all") params.set("from", "all");
    router.push(`/admin/orders/?${params.toString()}`);
  }

  function leaveEditor() {
    clearEditor();
    router.push(editReturnPath);
  }

  async function handleCancel() {
    if (!selectedOrderId || !dirty) return;
    setEditorError("");
    setLoadingOrderId(selectedOrderId);
    try {
      const order = await adminGetOrder(selectedOrderId);
      const nextDraft = orderToDraft(order);
      setSelectedDisplayId(order.display_id);
      setDraft(nextDraft);
      setSavedSnapshot(JSON.stringify(draftPayload(nextDraft)));
    } catch (err) {
      setEditorError(err.message || "Could not reload order.");
    } finally {
      setLoadingOrderId(null);
    }
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
      const refreshed = await adminSaveOrder(selectedOrderId, payload);
      const nextDraft = orderToDraft(refreshed);
      setDraft(nextDraft);
      setSavedSnapshot(JSON.stringify(draftPayload(nextDraft)));
      setOrders((current) =>
        current.map((order) =>
          order.id === selectedOrderId
            ? { ...order, ...orderToKanbanSummary(refreshed) }
            : order
        )
      );
    } catch (err) {
      setEditorError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (!ready || authLoading) {
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
    // Unsigned / unauthorized users are redirected in boot(); this is only for
    // allowlisted users whose admin session mint failed.
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <LoadingIndicator
          label={
            authError ? "Couldn't open admin. Try refreshing." : "Loading admin…"
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="relative mb-6">
        {tab !== "orders-edit" ? (
          <SectionHeading subtitle={activeTab.subtitle}>
            {activeTab.title}
          </SectionHeading>
        ) : (
          <div className="h-0 sm:h-10" aria-hidden="true" />
        )}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3 sm:absolute sm:right-0 sm:top-0 sm:mt-0 sm:justify-end">
          {ordersSectionActive && loadingOrders && orders.length > 0 && (
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
              entry.id === "orders"
                ? ordersSectionActive
                  ? "bg-berry text-night shadow-cozy"
                  : "border-2 border-ink/15 text-ink hover:border-blush"
                : tab === entry.id
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
      {ordersSectionActive && (
        <>
          {listError && tab !== "orders-edit" && (
            <p className="mb-4 rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
              {listError}
            </p>
          )}

          {tab === "orders-edit" ? (
            <div className="space-y-4">
              {!routeOrderId && (
                <p className="rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
                  Missing order id. Go back and open an order again.
                </p>
              )}

              {routeOrderId && loadingOrderId && !draft && (
                <LoadingIndicator label="Loading order…" />
              )}

              {routeOrderId && editorError && !draft && !loadingOrderId && (
                <p className="rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
                  {editorError}
                </p>
              )}

              {selectedOrderId && draft && (
                <OrderEditor
                  displayId={selectedDisplayId}
                  draft={draft}
                  dirty={dirty}
                  saving={saving}
                  error={editorError}
                  onBack={leaveEditor}
                  backLabel={
                    searchParams.get("from") === "all"
                      ? "Back to all orders"
                      : "Back to board"
                  }
                  onChange={setDraft}
                  onCancel={handleCancel}
                  onSave={handleSave}
                />
              )}
            </div>
          ) : loadingOrders && orders.length === 0 ? (
            <LoadingIndicator label="Loading orders…" />
          ) : tab === "orders-all" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink/50">
                  {orders.length} order{orders.length === 1 ? "" : "s"}
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/admin/orders/")}
                  className="rounded-xl border-2 border-ink/20 px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-blush"
                >
                  Back to board
                </button>
              </div>
              <OrdersAllList
                orders={orders}
                onOpenOrder={(orderId) => openOrder(orderId, { from: "all" })}
              />
            </div>
          ) : (
            <>
              <KanbanBoard
                orders={orders}
                onOpenOrder={openOrder}
                onStatusChange={handleStatusChange}
                onRequestDelete={handleRequestDelete}
                onViewAllOrders={() => router.push("/admin/orders/all/")}
              />
              <DeleteOrderDialog
                orders={deleteTargets}
                deleting={deletingOrder}
                onCancel={handleCancelDelete}
                onConfirm={handleConfirmDelete}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

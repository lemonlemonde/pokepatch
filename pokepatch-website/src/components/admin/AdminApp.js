"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import SectionHeading from "@/components/SectionHeading";
import { AdminOrderCardPhotoGroups } from "@/components/CardPhotoPreviews";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminAllowedEmail } from "@/lib/adminAccess";
import {
  adminDeleteOrders,
  adminDeletePhoto,
  adminGetOrder,
  adminListOrders,
  adminLoginWithSession,
  adminLogout,
  adminReorderStatusOrders,
  adminSaveOrder,
  adminSearchOrders,
  adminSendMessages,
  adminSetStatus,
  adminUploadPhoto,
  adminValidate,
  isAdminApiConfigured,
} from "@/lib/adminApi";
import { compressImageForUpload, makeThumbForUpload, thumbPath } from "@/lib/imageCompression";
import { forgetSignedUrl } from "@/lib/signedUrlCache";
import { supabase } from "@/lib/supabaseClient";
import GalleryManager from "@/components/admin/GalleryManager";
import OrderSaveChangesDialog from "@/components/admin/OrderSaveChangesDialog";
import StudioTool from "@/components/StudioTool";
import QuoteReceipt from "@/components/QuoteReceipt";
import {
  ORDER_STATUSES,
  ACTIVE_ORDER_STATUSES,
  COMPLETED_ORDER_STATUS,
  CANCELED_ORDER_STATUS,
  CARD_STATUSES,
  groupOrdersByStatus,
  normalizeOrderStatus,
  normalizeCardStatus,
  DEFAULT_CARD_STATUS,
  orderStatusHeadingClass,
  orderStatusLabel,
  orderStatusBadgeClass,
  cardStatusBadgeClass,
  isClosedOrderStatus,
  filterClosedColumnOrders,
  isPriorityElevated,
} from "@/lib/orderStatus";
import {
  QUOTE_SERVICES,
  SERVICE_KEYS,
  ADJUSTMENT_KIND_OPTIONS,
  analyzeQuoteCardCoverage,
  cardsWithQuoteHv,
  defaultBaseAmount,
  defaultServiceLabel,
  emptyQuoteAdjustment,
  formatMoney,
  hvPercentFromMarketValue,
  hvSurchargeFromMarketValue,
  HV_TIER_RANGES_LABEL,
  orderQuoteTotalFromStored,
  packQuoteAdjustments,
  parseMoneyInput,
  quoteCardHvAmount,
  unpackQuoteAdjustments,
} from "@/lib/servicePricing";

const MAX_ADMIN_PHOTOS_PER_CARD = 20;

function newClientId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyAdminCard() {
  return {
    id: newClientId(),
    card_name: "",
    set_name: "",
    description: "",
    market_value_raw_nm: "",
    status: DEFAULT_CARD_STATUS,
    images: [],
    pending_files: [],
  };
}

function validateDriveUrl(driveUrl) {
  const trimmed = (driveUrl ?? "").trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Google Drive link must be an http(s) URL.";
    }
  } catch {
    return "Google Drive link must be a valid URL.";
  }
  return null;
}

function draftHasPendingPhotos(draft) {
  return (draft?.cards ?? []).some(
    (card) => (card.pending_files ?? []).length > 0
  );
}

function copyFileList(fileList) {
  if (!fileList) return [];
  const copied = [];
  for (let i = 0; i < fileList.length; i += 1) {
    copied.push(fileList[i]);
  }
  return copied;
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

function emptyQuoteItem(card = null) {
  return {
    id: newClientId(),
    card_pick: card?.id != null ? String(card.id) : "",
    card_name: card?.card_name ?? "",
    set_name: card?.set_name ?? "",
    service_key: "",
    service_label: "",
    quote_base_amount: "",
  };
}

function quoteItemHasService(item) {
  return Boolean(item?.service_key);
}

/** True when a quote line is complete enough to collapse / count as priced. */
function quoteItemIsReady(item) {
  if (!quoteItemHasService(item)) return false;
  if (item.service_key === SERVICE_KEYS.CUSTOM) {
    return Boolean((item.service_label ?? "").trim());
  }
  return true;
}

function quoteItemCardRef(item, cards = [], index = 0) {
  const linked =
    item?.card_pick && item.card_pick !== "custom"
      ? (cards ?? []).find(
          (card) => String(card.id) === String(item.card_pick)
        )
      : null;
  const name = (linked?.card_name ?? item?.card_name ?? "").trim();
  const set = (linked?.set_name ?? item?.set_name ?? "").trim();
  if (name) return set ? `${name} (${set})` : name;
  return `quote line ${index + 1}`;
}

function quoteItemBelongsToCard(item, card, cards = null) {
  if (!card) return false;
  const cardId = String(card.id);
  if (item?.card_pick && item.card_pick !== "custom") {
    return String(item.card_pick) === cardId;
  }
  return findMatchingOrderCardId(item, cards ?? [card]) === cardId;
}

/** Ensure every order card has at least one (possibly empty) quote line. */
function ensureQuoteItemsForCards(cards, quoteItems) {
  const items = [...(quoteItems ?? [])];
  for (const card of cards ?? []) {
    const hasLine = items.some((item) =>
      quoteItemBelongsToCard(item, card, cards)
    );
    if (!hasLine) {
      items.push(emptyQuoteItem(card));
    }
  }
  return items;
}

function moneyFieldToPayload(value) {
  const parsed = parseMoneyInput(value);
  return parsed;
}

/** One card HV entry from market value (tier %); null when under threshold / empty. */
function cardHvEntryFromMarket(marketValue) {
  const amount = hvSurchargeFromMarketValue(marketValue);
  if (amount == null) return null;
  return {
    percent: String(hvPercentFromMarketValue(marketValue)),
    amount_dollars: String(amount),
  };
}

/** Build card HV map from market values only (tier %). */
function quoteCardHvFromMarkets(cards) {
  const out = {};
  for (const card of cards ?? []) {
    if (card?.id == null) continue;
    const entry = cardHvEntryFromMarket(
      moneyFieldToPayload(card.market_value_raw_nm)
    );
    if (entry) out[String(card.id)] = entry;
  }
  return out;
}

function applyCardHvFromMarket(quoteCardHv, cardId, marketValue) {
  const next = { ...(quoteCardHv ?? {}) };
  const hv = cardHvEntryFromMarket(marketValue);
  if (hv) {
    next[cardId] = hv;
  } else {
    delete next[cardId];
  }
  return next;
}

const ADMIN_TABS = [
  {
    id: "orders",
    label: "Orders",
    path: "/admin/orders/",
    title: "Orders admin",
    subtitle:
      "Search cards by name or set (scope with status chips). Drag within a column to reorder, or between columns to change status. Hover to inspect, click to edit. Closed columns show the last 7 days — use Show all for older orders. Right-click or drag to the bin to delete.",
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
      "Annotate photos, or format 1×2, 2×2 grid, and video before & after Instagram posts.",
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
  // Queue page removed — kanban owns ordering.
  if (path.startsWith("/admin/queue")) return "orders";
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
    };
  });
  const ensuredQuoteItems = ensureQuoteItemsForCards(orderCards, quoteItems);
  const quote_adjustments = unpackQuoteAdjustments(order.quote_bulk_counts, {
    overrideLabel: order.quote_override_label ?? "",
    overrideAmount: order.quote_override_amount,
  });
  const cards = orderCards.map((card) => ({
    id: card.id,
    card_name: card.card_name ?? "",
    set_name: card.set_name ?? "",
    description: card.description ?? "",
    market_value_raw_nm:
      card.market_value_raw_nm != null
        ? String(card.market_value_raw_nm)
        : "",
    status: normalizeCardStatus(card.status),
    images: card.images ?? [],
    pending_files: [],
  }));
  const quote_card_hv = quoteCardHvFromMarkets(cards);

  return {
    customer_name: order.customer_name ?? "",
    customer_email: order.customer_email ?? "",
    has_account: Boolean(order.has_account),
    delivery_method: order.delivery_method ?? "local_dropoff",
    general_notes: order.general_notes ?? "",
    photos_drive_url: order.photos_drive_url ?? "",
    status: normalizeOrderStatus(order.status),
    contacts: (order.contacts ?? []).map((contact) => ({
      id: contact.id,
      contact_type: contact.contact_type,
      value: contact.value ?? "",
    })),
    cards,
    quote_items: ensuredQuoteItems,
    quote_adjustments,
    quote_card_hv,
  };
}

function draftPayload(draft) {
  return {
    order: {
      customer_name: draft.customer_name.trim(),
      delivery_method: draft.delivery_method,
      general_notes: draft.general_notes.trim(),
      photos_drive_url: draft.photos_drive_url.trim(),
      status: draft.status,
      quote_bulk_counts: packQuoteAdjustments(
        draft.quote_adjustments,
        draft.quote_card_hv
      ),
      // Adjustments replace the old single override fields.
      quote_override_label: "",
      quote_override_amount: null,
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
      market_value_raw_nm: moneyFieldToPayload(card.market_value_raw_nm),
      status: normalizeCardStatus(card.status),
    })),
    quote_items: (draft.quote_items ?? [])
      .filter((item) => quoteItemHasService(item))
      .map((item, index) => {
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
          // HV is derived from card market value; never store per-service.
          high_value_surcharge: null,
        };
      }),
  };
}

function validateDraftForSave(draft) {
  if (!draft.customer_name.trim()) {
    return "Customer name is required.";
  }
  const driveError = validateDriveUrl(draft.photos_drive_url);
  if (driveError) {
    return driveError;
  }
  for (const contact of draft.contacts) {
    if (!contact.value.trim()) {
      return "Fill in every contact or remove empty rows before saving.";
    }
  }
  for (let index = 0; index < draft.cards.length; index += 1) {
    const card = draft.cards[index];
    if (!card.card_name.trim()) {
      return `Card ${index + 1} needs a name.`;
    }
    if (
      (card.market_value_raw_nm ?? "").trim() !== "" &&
      moneyFieldToPayload(card.market_value_raw_nm) == null
    ) {
      return `Card ${index + 1} has an invalid market value.`;
    }
  }
  for (let index = 0; index < (draft.quote_items ?? []).length; index += 1) {
    const item = draft.quote_items[index];
    if (!quoteItemHasService(item)) continue;
    const linked =
      item.card_pick && item.card_pick !== "custom"
        ? draft.cards.find(
            (card) => String(card.id) === String(item.card_pick)
          )
        : null;
    const cardName = (linked?.card_name ?? item.card_name ?? "").trim();
    const cardRef = quoteItemCardRef(item, draft.cards, index);
    if (!cardName) {
      return `Quote for ${cardRef} needs a card name.`;
    }
    if (!item.service_label.trim()) {
      return `Quote for ${cardRef} needs a service name.`;
    }
    if (moneyFieldToPayload(item.quote_base_amount) == null) {
      return `Quote for ${cardRef} needs a valid base amount.`;
    }
  }
  for (let index = 0; index < (draft.quote_adjustments ?? []).length; index += 1) {
    const row = draft.quote_adjustments[index];
    const hasDescription = Boolean((row.description ?? "").trim());
    const dollars = moneyFieldToPayload(row.amount_dollars);
    const hasAmount = dollars != null && dollars !== 0;
    if (!hasDescription && !hasAmount) continue;
    if (!hasAmount) {
      return `Adjustment ${index + 1} needs a $ amount.`;
    }
    if (dollars < 0) {
      return `Adjustment ${index + 1}: use Discount type instead of a negative $.`;
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
      if (image.signed_thumb_url || image.signed_url) {
        urls.push(image.signed_thumb_url || image.signed_url);
      }
      if (urls.length >= 4) return urls;
    }
  }
  return urls;
}

function orderAmount(order) {
  if (order?.quote_total != null && Number.isFinite(Number(order.quote_total))) {
    return Math.round(Number(order.quote_total) * 100) / 100;
  }
  return orderQuoteTotalFromStored(order);
}

function sumOrderAmounts(orders) {
  return Math.round(
    (orders ?? []).reduce((sum, order) => sum + orderAmount(order), 0) * 100
  ) / 100;
}

function AccountStatusBadge({ hasAccount, pill = false }) {
  const shape = pill
    ? "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
    : "inline-block rounded px-1.5 py-0.5 text-xs font-semibold";
  if (hasAccount) {
    return <span className={`${shape} bg-mint text-night`}>Has account</span>;
  }
  return (
    <span className={`${shape} bg-ink/10 text-ink/55`}>No account</span>
  );
}

function orderToKanbanSummary(order) {
  const status = normalizeOrderStatus(order.status);
  const isClosed = isClosedOrderStatus(status);
  return {
    id: order.id,
    display_id: order.display_id,
    created_at: order.created_at,
    customer_name: order.customer_name,
    customer_email: order.customer_email ?? "",
    has_account: Boolean(order.has_account),
    delivery_method: order.delivery_method,
    status,
    completed_at: isClosed ? (order.completed_at ?? null) : null,
    status_changed_at: order.status_changed_at ?? null,
    card_count: order.card_count ?? order.cards?.length ?? 0,
    cards_completed: order.cards_completed ?? null,
    queue_priority: order.queue_priority ?? null,
    queue_position: order.queue_position ?? null,
    preview_urls: previewUrlsFromOrder(order),
    preview_paths: Array.isArray(order.preview_paths)
      ? order.preview_paths.filter(Boolean)
      : [],
    quote_total: orderAmount(order),
  };
}

function OrderRevenueSummary({ completedTotal, pipelineTotal }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
      <p className="tabular-nums text-ink">
        <span className="font-semibold text-ink/55">Completed</span>{" "}
        <span className="font-bold text-status-green">
          {formatMoney(completedTotal)}
        </span>
      </p>
      <p className="tabular-nums text-ink">
        <span className="font-semibold text-ink/55">Pipeline</span>{" "}
        <span className="font-bold text-ink">
          {formatMoney(pipelineTotal)}
        </span>
      </p>
    </div>
  );
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

function ChevronDownIcon({ className = "h-4 w-4" }) {
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
      <path d="M6 9l6 6 6-6" />
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

function KanbanThumbImg({ url, storagePath, className }) {
  const [src, setSrc] = useState(url);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(url);
    setFailed(false);
  }, [url]);

  if (!src || failed) {
    return <div className={`bg-night/50 ${className ?? ""}`} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className={className}
      draggable={false}
      onError={() => {
        if (storagePath) {
          forgetSignedUrl("card-photos", thumbPath(storagePath));
        }
        setFailed(true);
      }}
    />
  );
}

function KanbanCard({
  order,
  onOpen,
  onContextMenu,
  dragging,
  priorityElevated = false,
}) {
  const panelElRef = useRef(null);
  const cursorRef = useRef({ x: 0, y: 0 });
  const openTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [panelPos, setPanelPos] = useState(null);

  const cardCount = order.card_count ?? order.cards?.length ?? 0;
  const cardsCompleted =
    order.cards_completed != null ? Number(order.cards_completed) : null;
  const previewUrls = Array.isArray(order.preview_urls)
    ? order.preview_urls.filter(Boolean).slice(0, 1)
    : [];
  const previewPaths = Array.isArray(order.preview_paths)
    ? order.preview_paths
    : [];
  const thumbUrl = previewUrls[0] ?? null;
  const thumbPathForPreview = previewPaths[0] ?? null;
  const hasMore = cardCount > 1 && Boolean(thumbUrl);
  const showCardProgress =
    order.status === "in_progress" &&
    cardsCompleted != null &&
    cardCount > 0;
  const metaChip = showCardProgress
    ? `${cardsCompleted}/${cardCount} done · ${deliveryShortLabel(order.delivery_method)}`
    : `${cardCount} · ${deliveryShortLabel(order.delivery_method)}`;

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
      className={`relative flex w-full cursor-grab items-center gap-2 rounded-lg border-2 border-ink/10 bg-cream px-2 py-1.5 text-left shadow-cozy-sm transition hover:border-blush/60 active:cursor-grabbing ${
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
        {priorityElevated ? (
          <span
            className="shrink-0 rounded-full bg-berry/90 px-1.5 py-0.5 text-[10px] font-bold text-white"
            title="Placed ahead of chronological order (#)"
            aria-label="Priority elevated"
          >
            ↑
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {order.customer_name}
        </span>
        <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-ink/55">
          {metaChip}
        </span>
        <span className="relative aspect-[3/4] w-7 shrink-0 overflow-hidden rounded bg-night/50">
          {thumbUrl ? (
            <KanbanThumbImg
              url={thumbUrl}
              storagePath={thumbPathForPreview}
              className="h-full w-full object-cover"
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
      <div
        ref={panelElRef}
        role="tooltip"
        id={`order-inspect-${order.id}`}
        className="pointer-events-none fixed z-[200] rounded-xl border-2 border-ink/15 bg-cream p-3 shadow-cozy"
        style={{
          top: panelPos.top,
          left: panelPos.left,
          width: INSPECT_PANEL_WIDTH,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm font-bold tabular-nums text-ink">
            #{order.display_id}
            {priorityElevated ? (
              <span className="ml-2 text-xs font-bold text-berry">
                ↑ ahead of #
              </span>
            ) : null}
          </p>
          <p
            className={`shrink-0 text-sm font-bold tabular-nums ${
              normalizeOrderStatus(order.status) === "completed"
                ? "text-status-green"
                : "text-ink"
            }`}
          >
            {formatMoney(orderAmount(order))}
          </p>
        </div>
        <p className="mt-1 text-sm font-semibold text-ink">
          {order.customer_name}
        </p>
        <div className="mt-1.5">
          <AccountStatusBadge hasAccount={order.has_account} />
        </div>
        <p className="mt-1 text-xs text-ink/60">
          {showCardProgress
            ? `${cardsCompleted}/${cardCount} cards complete`
            : `${cardCount} card${cardCount === 1 ? "" : "s"}`}{" "}
          · {deliveryLabel(order.delivery_method)}
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
                  <KanbanThumbImg
                    url={url}
                    storagePath={previewPaths[index] ?? null}
                    className="h-full w-full object-cover"
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
    const full = image.signed_url ?? "";
    const thumb = image.signed_thumb_url || full;
    return {
      id: image.id ?? image.storage_path,
      storagePath: image.storage_path ?? null,
      src: thumb,
      fullSrc: full,
      alt: label,
      label,
      href: full || undefined,
      removeAriaLabel: `Remove ${label}`,
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

function cardStatusLabel(statusId) {
  const status = normalizeCardStatus(statusId);
  return CARD_STATUSES.find((entry) => entry.id === status)?.label ?? "To do";
}

function truncateText(value, max = 140) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

const DEFAULT_SEARCH_STATUSES = ACTIVE_ORDER_STATUSES.map((status) => status.id);

function OrderCardSearch({ onOpenOrder }) {
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState(DEFAULT_SEARCH_STATUSES);
  const [results, setResults] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || statuses.length === 0) {
      requestIdRef.current += 1;
      setResults([]);
      setTruncated(false);
      setSearching(false);
      setError("");
      return undefined;
    }

    const requestId = ++requestIdRef.current;
    setSearching(true);
    setError("");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const payload = await adminSearchOrders(q, { statuses });
          if (requestId !== requestIdRef.current) return;
          setResults(payload.results ?? []);
          setTruncated(Boolean(payload.truncated));
          setOpen(true);
        } catch (err) {
          if (requestId !== requestIdRef.current) return;
          setResults([]);
          setTruncated(false);
          setError(err.message || "Search failed.");
          setOpen(true);
        } finally {
          if (requestId === requestIdRef.current) {
            setSearching(false);
          }
        }
      })();
    }, 280);

    return () => window.clearTimeout(timer);
  }, [query, statuses]);

  useEffect(() => {
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function toggleStatus(statusId) {
    setStatuses((current) => {
      if (current.includes(statusId)) {
        return current.filter((id) => id !== statusId);
      }
      return [...current, statusId];
    });
  }

  const allStatusesSelected = statuses.length === ORDER_STATUSES.length;
  const showPanel =
    open && query.trim().length >= 2 && statuses.length > 0;

  return (
    <div ref={rootRef} className="relative z-20">
      <div className="rounded-2xl border-2 border-ink/10 bg-night/30 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <label className="relative min-w-[12rem] flex-1 basis-[14rem]">
            <span className="sr-only">Search cards by name or set</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
              onFocus={() => {
                if (query.trim().length >= 2 && statuses.length > 0) {
                  setOpen(true);
                }
              }}
              placeholder="Search card name, set, or description…"
              className="w-full rounded-xl border border-ink/15 bg-cream px-3.5 py-2.5 pr-10 text-sm text-ink outline-none transition focus:border-blush"
              autoComplete="off"
            />
            {searching && (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink/45">
                …
              </span>
            )}
          </label>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:ml-auto">
            <p className="shrink-0 text-xs font-semibold text-ink/50">
              Filter by column
            </p>
            <button
              type="button"
              onClick={() =>
                setStatuses(
                  allStatusesSelected
                    ? []
                    : ORDER_STATUSES.map((status) => status.id)
                )
              }
              className="relative shrink-0 rounded-xl border-2 border-ink/20 px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-blush"
            >
              <span className="invisible block" aria-hidden="true">
                Deselect all columns
              </span>
              <span className="absolute inset-0 flex items-center justify-center px-3">
                {allStatusesSelected
                  ? "Deselect all columns"
                  : "Select all columns"}
              </span>
            </button>
            {ORDER_STATUSES.map((status) => {
              const active = statuses.includes(status.id);
              return (
                <button
                  key={status.id}
                  type="button"
                  onClick={() => toggleStatus(status.id)}
                  aria-pressed={active}
                  className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                    active
                      ? orderStatusBadgeClass(status.id)
                      : "border border-ink/15 bg-cream/60 text-ink/45 hover:border-ink/30 hover:text-ink/70"
                  }`}
                >
                  {status.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {showPanel && (
        <div className="absolute left-0 right-0 top-[calc(100%-0.5rem)] z-30 mt-2 max-h-[min(28rem,60vh)] overflow-y-auto rounded-2xl border-2 border-ink/15 bg-cream shadow-cozy">
          {error ? (
            <p className="px-4 py-3 text-sm text-berry">{error}</p>
          ) : searching && results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink/50">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink/50">
              No cards matched in the selected columns.
            </p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {results.map((hit) => {
                const orderStatus = normalizeOrderStatus(hit.status);
                const card = hit.card ?? {};
                const description = truncateText(card.description);
                const notes = truncateText(hit.general_notes, 100);
                const previewUrl = card.preview_url ?? null;
                const previewPath = card.preview_path ?? null;
                return (
                  <li key={`${hit.order_id}-${card.id}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onOpenOrder(hit.order_id, { cardId: card.id });
                      }}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-blush/15"
                    >
                      <div className="relative aspect-[3/4] w-11 shrink-0 overflow-hidden rounded-md bg-night/50">
                        {previewUrl ? (
                          <KanbanThumbImg
                            url={previewUrl}
                            storagePath={previewPath}
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold tabular-nums text-ink">
                            #{hit.display_id}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${orderStatusBadgeClass(
                              orderStatus
                            )}`}
                          >
                            {orderStatusLabel(orderStatus)}
                          </span>
                          <span className="text-sm font-semibold text-ink">
                            {hit.customer_name}
                          </span>
                          <span className="text-xs text-ink/50">
                            {deliveryShortLabel(hit.delivery_method)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-sm font-semibold text-ink">
                            {card.card_name || "Untitled card"}
                          </span>
                          {card.set_name ? (
                            <span className="text-xs text-ink/60">
                              {card.set_name}
                            </span>
                          ) : null}
                          <span
                            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${cardStatusBadgeClass(
                              card.status
                            )}`}
                          >
                            Card: {cardStatusLabel(card.status)}
                          </span>
                        </div>
                        {description ? (
                          <p className="text-xs leading-relaxed text-ink/65">
                            {description}
                          </p>
                        ) : null}
                        {notes ? (
                          <p className="text-xs text-ink/45">
                            Order notes: {notes}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {truncated && !error && (
            <p className="border-t border-ink/10 px-4 py-2 text-xs text-ink/45">
              Showing the first matches — refine the query or column scope for
              more precision.
            </p>
          )}
        </div>
      )}
    </div>
  );
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
      <table className="w-full min-w-[58rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-ink/20 bg-night/40 text-xs font-semibold uppercase tracking-wide text-ink/60">
            <th className="whitespace-nowrap px-3 py-2">#</th>
            <th className="whitespace-nowrap px-3 py-2">Customer</th>
            <th className="whitespace-nowrap px-3 py-2">Email</th>
            <th className="whitespace-nowrap px-3 py-2">Account</th>
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
                  <AccountStatusBadge hasAccount={order.has_account} />
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

/** Insert index from pointer Y vs each card's vertical midpoint in the column list. */
function resolveListDropIndex(clientY, listEl) {
  const rows = listEl?.querySelectorAll?.("[data-kanban-row]");
  if (!rows?.length) return 0;
  for (let i = 0; i < rows.length; i++) {
    const rect = rows[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return rows.length;
}

function KanbanBoard({
  orders,
  onOpenOrder,
  onPlaceOrder,
  onRequestDelete,
  onViewAllOrders,
}) {
  const [dragOrderId, setDragOrderId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { statusId, index }
  const dropTargetRef = useRef(null);
  const [trashArmed, setTrashArmed] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [canceledExpanded, setCanceledExpanded] = useState(false);

  const columns = useMemo(() => groupOrdersByStatus(orders), [orders]);
  const revenue = useMemo(
    () => ({
      completed: sumOrderAmounts(columns.completed),
      pipeline: sumOrderAmounts([
        ...(columns.new ?? []),
        ...(columns.on_hold ?? []),
        ...(columns.in_progress ?? []),
      ]),
    }),
    [columns]
  );
  const dragOrder = useMemo(
    () => orders.find((order) => order.id === dragOrderId) ?? null,
    [orders, dragOrderId]
  );

  function setDropTargetStable(next) {
    const prev = dropTargetRef.current;
    if (
      prev &&
      next &&
      prev.statusId === next.statusId &&
      prev.index === next.index
    ) {
      return;
    }
    dropTargetRef.current = next;
    setDropTarget(next);
  }

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
    dropTargetRef.current = null;
    setDropTarget(null);
    setContextMenu(null);
  }

  function handleDragEnd() {
    setDragOrderId(null);
    dropTargetRef.current = null;
    setDropTarget(null);
    setTrashArmed(false);
  }

  async function commitDrop(statusId, index) {
    const orderId = dragOrderId;
    setDragOrderId(null);
    dropTargetRef.current = null;
    setDropTarget(null);
    setTrashArmed(false);
    if (!orderId || index == null) return;
    await onPlaceOrder(orderId, statusId, index);
  }

  function handleTrashDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setTrashArmed(true);
    dropTargetRef.current = null;
    setDropTarget(null);
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
    dropTargetRef.current = null;
    setDropTarget(null);
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

  function renderColumn(status, { closed, dock = false, expanded = true, onToggleExpand }) {
    const rawOrders = columns[status.id] ?? [];
    const columnOrders = closed
      ? filterClosedColumnOrders(rawOrders)
      : rawOrders;
    const hiddenCount = closed
      ? Math.max(0, rawOrders.length - columnOrders.length)
      : 0;
    const dropIndex =
      dropTarget?.statusId === status.id ? dropTarget.index : null;
    const showList = !dock || expanded;
    const dockDropHighlight =
      dock &&
      dragOrderId &&
      dropTarget?.statusId === status.id;

    function updateColumnDropTarget(event, listEl) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (!dragOrderId) return;
      const index =
        !showList || columnOrders.length === 0
          ? 0
          : resolveListDropIndex(event.clientY, listEl);
      setDropTargetStable({ statusId: status.id, index });
    }

    function dropOnColumn(event, listEl) {
      event.preventDefault();
      const fromRef =
        dropTargetRef.current?.statusId === status.id
          ? dropTargetRef.current.index
          : null;
      const index =
        fromRef != null
          ? fromRef
          : !showList || columnOrders.length === 0
            ? 0
            : resolveListDropIndex(event.clientY, listEl);
      void commitDrop(status.id, index);
    }

    return (
      <section
        key={status.id}
        className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border-2 bg-night/40 p-3 ${
          dock
            ? dockDropHighlight
              ? "border-berry/60 bg-berry/10"
              : "border-ink/10"
            : "h-full border-ink/10"
        }`}
        onDragOver={(event) => {
          if (showList && columnOrders.length > 0) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (!dragOrderId) return;
          setDropTargetStable({ statusId: status.id, index: 0 });
        }}
        onDrop={(event) => {
          if (showList && columnOrders.length > 0) return;
          event.preventDefault();
          void commitDrop(status.id, 0);
        }}
      >
        {dock ? (
          <button
            type="button"
            onClick={() => onToggleExpand?.(!expanded)}
            aria-expanded={expanded}
            className={`flex w-full shrink-0 flex-nowrap items-center justify-between gap-2 rounded-lg text-left transition hover:bg-ink/5 ${
              showList ? "mb-3" : ""
            }`}
          >
            <h2
              className={`min-w-0 truncate text-base font-bold leading-none sm:text-lg ${orderStatusHeadingClass(
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
            <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-ink/60">
              {expanded ? "See less" : `See more (${columnOrders.length})`}
            </span>
          </button>
        ) : (
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
        )}
        {showList && (
          <div
            data-kanban-scroll
            className={`min-h-0 space-y-2 overflow-y-auto pr-0.5 ${
              dock ? "max-h-48 flex-none" : "flex-1"
            }`}
            onDragOver={(event) =>
              updateColumnDropTarget(event, event.currentTarget)
            }
            onDrop={(event) => dropOnColumn(event, event.currentTarget)}
          >
            {columnOrders.map((order, index) => (
              <div
                key={order.id}
                data-kanban-row
                className="relative"
                draggable
                onDragStart={(event) => handleDragStart(event, order.id)}
                onDragEnd={handleDragEnd}
              >
                {dropIndex === index &&
                  dragOrderId &&
                  dragOrderId !== order.id && (
                    <div
                      className={`pointer-events-none absolute right-0 left-0 z-10 h-1 rounded-full bg-berry ${
                        index === 0 ? "top-0" : "-top-1.5"
                      }`}
                      aria-hidden="true"
                    />
                  )}
                <KanbanCard
                  order={order}
                  onOpen={onOpenOrder}
                  onContextMenu={handleCardContextMenu}
                  dragging={dragOrderId === order.id}
                  priorityElevated={isPriorityElevated(order, columnOrders)}
                />
              </div>
            ))}
            {dropIndex === columnOrders.length &&
              dragOrderId &&
              columnOrders.length > 0 && (
                <div
                  className="pointer-events-none h-1 rounded-full bg-berry"
                  aria-hidden="true"
                />
              )}
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
        )}
        {dock && !expanded && (
          <p className="mt-1 text-xs text-ink/45">
            {dragOrderId
              ? "Drop here to cancel"
              : "Collapsed — drop orders here or see more"}
          </p>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <OrderRevenueSummary
          completedTotal={revenue.completed}
          pipelineTotal={revenue.pipeline}
        />
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
        {COMPLETED_ORDER_STATUS
          ? renderColumn(COMPLETED_ORDER_STATUS, { closed: true })
          : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CANCELED_ORDER_STATUS
          ? renderColumn(CANCELED_ORDER_STATUS, {
              closed: true,
              dock: true,
              expanded: canceledExpanded,
              onToggleExpand: setCanceledExpanded,
            })
          : null}
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

function adminCardIsComplete(card) {
  const hasName = Boolean((card?.card_name ?? "").trim());
  const hasDescription = Boolean((card?.description ?? "").trim());
  const photoCount =
    (card?.images ?? []).length + (card?.pending_files ?? []).length;
  return hasName && hasDescription && photoCount > 0;
}

function EditorSection({ title, titleExtra, action, children, className = "", id }) {
  return (
    <section
      id={id}
      className={`rounded-2xl border bg-cream/80 p-5 shadow-cozy-sm sm:p-6 ${
        className || "border-ink/10"
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {titleExtra ?? null}
        </div>
        {action ?? null}
      </div>
      {children}
    </section>
  );
}

function CardStatusPills({ value, onChange, ariaLabel }) {
  const selectedId = normalizeCardStatus(value);
  return (
    <span className="flex flex-wrap gap-1" role="group" aria-label={ariaLabel}>
      {CARD_STATUSES.map((status) => {
        const selected = selectedId === status.id;
        return (
          <button
            key={status.id}
            type="button"
            onClick={() => onChange(status.id)}
            aria-pressed={selected}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
              selected
                ? cardStatusBadgeClass(status.id)
                : "bg-ink/5 text-ink/45 hover:bg-ink/10 hover:text-ink/70"
            }`}
          >
            {status.label}
          </button>
        );
      })}
    </span>
  );
}

function EditorSubsection({ title, description, action, children }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-night/[0.03] px-3.5 py-3.5 sm:px-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-ink">{title}</h4>
          {description ? (
            <p className="mt-0.5 text-xs text-ink/50">{description}</p>
          ) : null}
        </div>
        {action ?? null}
      </div>
      {children}
    </div>
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
  orderId,
  draft,
  dirty,
  saving,
  error,
  onBack,
  backLabel = "Back",
  onChange,
  onCancel,
  onSave,
  onError,
  focusCardId = null,
}) {
  const [expandedQuoteLineId, setExpandedQuoteLineId] = useState(null);
  const [removingPhotoId, setRemovingPhotoId] = useState(null);
  const [highlightedCardId, setHighlightedCardId] = useState(null);
  const scrollToCardIdRef = useRef(null);
  const scrolledFocusKeyRef = useRef("");

  function updateDraft(patch) {
    // Functional update so quote-sync / rapid edits can't clobber a just-added card.
    onChange((current) => ({ ...(current ?? draft), ...patch }));
  }

  const cardIdsKey = (draft.cards ?? []).map((card) => card.id).join("|");

  useEffect(() => {
    if (!focusCardId) {
      setHighlightedCardId(null);
      return;
    }
    setHighlightedCardId(String(focusCardId));
  }, [focusCardId, orderId]);

  useEffect(() => {
    if (!highlightedCardId) return;
    const focusKey = `${orderId}:${highlightedCardId}:${cardIdsKey}`;
    if (scrolledFocusKeyRef.current === focusKey) return;
    if (
      !(draft.cards ?? []).some(
        (card) => String(card.id) === String(highlightedCardId)
      )
    ) {
      return;
    }
    scrolledFocusKeyRef.current = focusKey;
    // Wait a frame so the card section is laid out before scrolling.
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`admin-order-card-${highlightedCardId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightedCardId, cardIdsKey, draft.cards, orderId]);

  useEffect(() => {
    if (!highlightedCardId) return undefined;
    function clearHighlight() {
      setHighlightedCardId(null);
    }
    // Skip the opening click that navigated into the editor.
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", clearHighlight, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", clearHighlight, true);
    };
  }, [highlightedCardId]);

  useEffect(() => {
    onChange((current) => {
      if (!current) return current;
      const nextItems = ensureQuoteItemsForCards(
        current.cards,
        current.quote_items
      );
      const missing = (current.cards ?? []).some(
        (card) =>
          !(current.quote_items ?? []).some((item) =>
            quoteItemBelongsToCard(item, card, current.cards)
          )
      );
      if (!missing) return current;
      return { ...current, quote_items: nextItems };
    });
    // Only re-run when the set of order cards changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardIdsKey]);

  useEffect(() => {
    if (!expandedQuoteLineId) return;
    function onPointerDown(event) {
      const root = document.querySelector(
        `[data-quote-line-id="${CSS.escape(String(expandedQuoteLineId))}"]`
      );
      if (root && root.contains(event.target)) return;

      const item = (draft.quote_items ?? []).find(
        (entry) => String(entry.id) === String(expandedQuoteLineId)
      );
      if (item && quoteItemIsReady(item)) {
        setExpandedQuoteLineId(null);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [expandedQuoteLineId, draft.quote_items]);

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

  function addCard() {
    const card = emptyAdminCard();
    setHighlightedCardId(String(card.id));
    onChange((current) => {
      const base = current ?? draft;
      return {
        ...base,
        cards: [...(base.cards ?? []), card],
      };
    });
  }

  function removeCard(cardIndex) {
    const removed = draft.cards[cardIndex];
    if (!removed) return;
    const cardId = String(removed.id);
    const cards = draft.cards.filter((_, i) => i !== cardIndex);
    const quote_items = (draft.quote_items ?? []).filter(
      (item) => !quoteItemBelongsToCard(item, removed, draft.cards)
    );
    const quote_card_hv = { ...(draft.quote_card_hv ?? {}) };
    delete quote_card_hv[cardId];
    updateDraft({ cards, quote_items, quote_card_hv });
  }

  function addCardPendingFiles(cardIndex, fileList) {
    const card = draft.cards[cardIndex];
    if (!card) return;
    const incoming = copyFileList(fileList).filter((file) =>
      file.type?.startsWith("image/")
    );
    if (incoming.length === 0) return;

    const nextPending = [
      ...(card.pending_files ?? []),
      ...incoming.map((file) => ({ id: newClientId(), file })),
    ].slice(0, MAX_ADMIN_PHOTOS_PER_CARD);

    updateCard(cardIndex, {
      pending_files: nextPending,
    });
  }

  function removeCardPendingFile(cardIndex, fileId) {
    const card = draft.cards[cardIndex];
    if (!card) return;
    updateCard(cardIndex, {
      pending_files: (card.pending_files ?? []).filter(
        (entry) => entry.id !== fileId
      ),
    });
  }

  async function removeAdminPhoto(cardIndex, imageId) {
    if (!orderId || removingPhotoId != null) return;
    setRemovingPhotoId(imageId);
    onError?.("");
    try {
      await adminDeletePhoto(orderId, imageId);
      onChange((current) => {
        const base = current ?? draft;
        return {
          ...base,
          cards: (base.cards ?? []).map((card, index) =>
            index === cardIndex
              ? {
                  ...card,
                  images: (card.images ?? []).filter(
                    (image) => String(image.id) !== String(imageId)
                  ),
                }
              : card
          ),
        };
      });
    } catch (err) {
      onError?.(err.message || "Could not remove photo.");
    } finally {
      setRemovingPhotoId(null);
    }
  }

  function updateCard(index, patch) {
    const cards = draft.cards.map((card, i) =>
      i === index ? { ...card, ...patch } : card
    );
    const updated = cards[index];
    const touchesName = "card_name" in patch || "set_name" in patch;
    const touchesMarket = "market_value_raw_nm" in patch;
    let quote_items = draft.quote_items ?? [];
    let quote_card_hv = draft.quote_card_hv ?? {};

    if (touchesName && updated?.id != null) {
      const cardId = String(updated.id);
      quote_items = quote_items.map((item) =>
        item.card_pick && String(item.card_pick) === cardId
          ? {
              ...item,
              card_name: updated.card_name ?? "",
              set_name: updated.set_name ?? "",
            }
          : item
      );
    }

    if (touchesMarket && updated?.id != null) {
      const cardId = String(updated.id);
      const marketValue = moneyFieldToPayload(patch.market_value_raw_nm);
      quote_card_hv = applyCardHvFromMarket(
        quote_card_hv,
        cardId,
        marketValue
      );
    }

    if (touchesName || touchesMarket) {
      updateDraft({ cards, quote_items, quote_card_hv });
      return;
    }
    updateDraft({ cards });
  }

  function setCardHvMarket(cardIndex, value) {
    const card = draft.cards[cardIndex];
    if (!card?.id) return;
    const cardId = String(card.id);
    const marketValue = moneyFieldToPayload(value);
    const cards = draft.cards.map((entry, i) =>
      i === cardIndex ? { ...entry, market_value_raw_nm: value } : entry
    );
    updateDraft({
      cards,
      quote_card_hv: applyCardHvFromMarket(
        draft.quote_card_hv,
        cardId,
        marketValue
      ),
    });
  }

  function updateQuoteItem(index, patch) {
    const quote_items = (draft.quote_items ?? []).map((item, i) =>
      i === index ? { ...item, ...patch } : item
    );
    updateDraft({ quote_items });
  }

  function addQuoteItem(card = null) {
    const next = emptyQuoteItem(card);
    const quote_items = [...(draft.quote_items ?? []), next];
    setExpandedQuoteLineId(next.id);
    updateDraft({ quote_items });
  }

  function removeQuoteItem(index) {
    const removed = draft.quote_items?.[index];
    let quote_items = (draft.quote_items ?? []).filter((_, i) => i !== index);
    const card =
      removed &&
      (draft.cards ?? []).find((entry) =>
        quoteItemBelongsToCard(removed, entry, draft.cards)
      );
    if (card) {
      const stillHasLine = quote_items.some((item) =>
        quoteItemBelongsToCard(item, card, draft.cards)
      );
      if (!stillHasLine) {
        quote_items = [...quote_items, emptyQuoteItem(card)];
      }
    }
    updateDraft({ quote_items });
  }

  function applyServiceToQuoteItem(index, serviceKey) {
    if (!serviceKey) {
      const quote_items = (draft.quote_items ?? []).map((item, i) =>
        i === index
          ? {
              ...item,
              service_key: "",
              service_label: "",
              quote_base_amount: "",
            }
          : item
      );
      updateDraft({ quote_items });
      return;
    }
    const base = defaultBaseAmount(serviceKey);
    const label = defaultServiceLabel(serviceKey);
    const quote_items = (draft.quote_items ?? []).map((item, i) =>
      i === index
        ? {
            ...item,
            service_key: serviceKey,
            service_label:
              serviceKey === SERVICE_KEYS.CUSTOM ? "" : label,
            quote_base_amount: base != null ? String(base) : "",
          }
        : item
    );
    updateDraft({ quote_items });
  }

  function addQuoteAdjustment() {
    updateDraft({
      quote_adjustments: [
        ...(draft.quote_adjustments ?? []),
        emptyQuoteAdjustment("discount"),
      ],
    });
  }

  function updateQuoteAdjustment(index, patch) {
    const quote_adjustments = (draft.quote_adjustments ?? []).map(
      (row, i) => (i === index ? { ...row, ...patch } : row)
    );
    updateDraft({ quote_adjustments });
  }

  function setAdjustmentDollars(index, value) {
    updateQuoteAdjustment(index, {
      amount_dollars: value,
      amount_percent: "",
    });
  }

  function removeQuoteAdjustment(index) {
    updateDraft({
      quote_adjustments: (draft.quote_adjustments ?? []).filter(
        (_, i) => i !== index
      ),
    });
  }

  const quoteItems = draft.quote_items ?? [];
  const receiptItems = quoteItems.filter(quoteItemIsReady).map((item) => ({
    id: item.id,
    card_name: item.card_name,
    set_name: item.set_name,
    service_label: item.service_label,
    quote_base_amount: moneyFieldToPayload(item.quote_base_amount) ?? 0,
  }));
  const receiptCards = cardsWithQuoteHv(
    (draft.cards ?? []).map((card) => ({
      id: card.id,
      card_name: card.card_name,
      set_name: card.set_name,
      market_value_raw_nm: moneyFieldToPayload(card.market_value_raw_nm),
    })),
    draft.quote_card_hv ?? {}
  );
  const receiptAdjustments = draft.quote_adjustments ?? [];
  const quoteCoverage = analyzeQuoteCardCoverage(draft.cards, quoteItems);
  const quoteLinesByCard = useMemo(() => {
    const cards = draft.cards ?? [];
    const indicesByCardId = new Map(
      cards.map((card) => [String(card.id), []])
    );
    const orphans = [];
    quoteItems.forEach((item, index) => {
      const pickId =
        item.card_pick && item.card_pick !== "custom"
          ? String(item.card_pick)
          : findMatchingOrderCardId(item, cards);
      const indices = pickId ? indicesByCardId.get(pickId) : null;
      if (indices) {
        indices.push(index);
        return;
      }
      orphans.push(index);
    });
    return { indicesByCardId, orphans };
  }, [draft.cards, quoteItems]);

  const driveUrl = draft.photos_drive_url.trim();

  function renderQuoteHvLine(card) {
    if (!card?.id) return null;
    const cardId = String(card.id);
    const hv = draft.quote_card_hv?.[cardId];
    const cardIndex = (draft.cards ?? []).findIndex(
      (entry) => String(entry.id) === cardId
    );
    const amount = moneyFieldToPayload(hv?.amount_dollars) ?? 0;

    return (
      <div className="space-y-2 rounded-lg border border-peach/40 bg-peach/15 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-ink/55">
              High-value fee
            </span>
            <span className="text-[10px] font-medium text-ink/40">
              {HV_TIER_RANGES_LABEL}
            </span>
          </div>
          {amount > 0 ? (
            <p className="text-right text-sm font-bold tabular-nums text-ink">
              {formatMoney(amount)}
            </p>
          ) : null}
        </div>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-medium text-ink/55">
            Market ($)
          </span>
          <input
            className={editorFieldClass()}
            inputMode="decimal"
            value={card.market_value_raw_nm ?? ""}
            onChange={(event) => {
              if (cardIndex < 0) return;
              setCardHvMarket(cardIndex, event.target.value);
            }}
            placeholder="e.g. 250"
          />
        </label>
      </div>
    );
  }

  function renderQuoteServiceLine(item, index) {
    const hasService = quoteItemHasService(item);
    const serviceReady = quoteItemIsReady(item);
    const lineId = String(item.id ?? `quote-${index}`);
    const isExpanded =
      !serviceReady || String(expandedQuoteLineId) === lineId;
    const base = moneyFieldToPayload(item.quote_base_amount) ?? 0;
    const lineTotal = base;
    const serviceName =
      item.service_label?.trim() ||
      defaultServiceLabel(item.service_key) ||
      (item.service_key === SERVICE_KEYS.CUSTOM ? "Custom" : "Service");
    const fieldClass = `${editorFieldClass()}${
      hasService ? "" : " cursor-not-allowed opacity-45"
    }`;

    if (serviceReady && !isExpanded) {
      return (
        <div
          key={lineId}
          data-quote-line-id={lineId}
          className="flex items-center gap-2"
        >
          <button
            type="button"
            onClick={() => setExpandedQuoteLineId(lineId)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-sky/30 bg-sky/15 px-3 py-2 text-left transition hover:border-sky/50"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
              {serviceName}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
              {formatMoney(lineTotal)}
            </span>
            <ChevronDownIcon className="h-4 w-4 shrink-0 text-ink/40" />
          </button>
          <button
            type="button"
            onClick={() => removeQuoteItem(index)}
            className="shrink-0 text-xs font-semibold text-ink/40 transition hover:text-berry"
          >
            Remove
          </button>
        </div>
      );
    }

    return (
      <div
        key={lineId}
        data-quote-line-id={lineId}
        className={`space-y-2 rounded-lg border border-sky/35 bg-sky/15 px-3 py-2.5 ${
          hasService ? "" : "opacity-90"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() =>
              setExpandedQuoteLineId(serviceReady ? null : lineId)
            }
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            disabled={!serviceReady}
          >
            <span className="truncate text-xs font-semibold uppercase tracking-[0.06em] text-ink/55">
              {hasService
                ? serviceName
                : "Select a service"}
            </span>
            {serviceReady ? (
              <ChevronDownIcon className="ml-auto h-4 w-4 shrink-0 rotate-180 text-ink/40" />
            ) : null}
          </button>
          <div className="flex items-center gap-3">
            {serviceReady ? (
              <p className="text-right text-sm tabular-nums font-bold text-ink">
                {formatMoney(lineTotal)}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => removeQuoteItem(index)}
              className="text-xs font-semibold text-ink/40 transition hover:text-berry"
            >
              Remove
            </button>
          </div>
        </div>

        <div className="grid gap-2">
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-ink/55">
              Service
            </span>
            <select
              className={editorFieldClass()}
              value={item.service_key || ""}
              onChange={(event) => {
                applyServiceToQuoteItem(index, event.target.value);
                setExpandedQuoteLineId(lineId);
              }}
              onFocus={() => setExpandedQuoteLineId(lineId)}
            >
              <option value="">Select a service…</option>
              {QUOTE_SERVICES.map((service) => (
                <option key={service.key} value={service.key}>
                  {service.title}
                </option>
              ))}
            </select>
          </label>
          {item.service_key === SERVICE_KEYS.CUSTOM ? (
            <label className="block min-w-0">
              <span className="mb-1 block text-xs font-medium text-ink/55">
                Service name
              </span>
              <input
                className={editorFieldClass()}
                value={item.service_label}
                onChange={(event) =>
                  updateQuoteItem(index, {
                    service_label: event.target.value,
                  })
                }
                onFocus={() => setExpandedQuoteLineId(lineId)}
                placeholder="Custom service name"
              />
            </label>
          ) : null}
        </div>

        <div
          className={`flex flex-col gap-2 sm:flex-row sm:items-end ${
            hasService ? "" : "pointer-events-none"
          }`}
        >
          <label className="block min-w-0 sm:w-32">
            <span className="mb-1 block text-xs font-medium text-ink/55">
              Base ($)
            </span>
            <input
              className={fieldClass}
              inputMode="decimal"
              value={hasService ? item.quote_base_amount : ""}
              onChange={(event) =>
                updateQuoteItem(index, {
                  quote_base_amount: event.target.value,
                })
              }
              onFocus={() => setExpandedQuoteLineId(lineId)}
              disabled={!hasService}
              placeholder={hasService ? "" : "—"}
            />
          </label>
        </div>
      </div>
    );
  }

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
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${orderStatusBadgeClass(
                  draft.status
                )}`}
              >
                {orderStatusLabel(draft.status)}
              </span>
              <AccountStatusBadge hasAccount={draft.has_account} pill />
            </div>
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

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 px-1">
          <h3 className="text-base font-semibold text-ink">Cards</h3>
          <button
            type="button"
            onClick={addCard}
            className="text-sm font-semibold text-berry transition hover:underline"
          >
            Add card
          </button>
        </div>
        {draft.cards.length === 0 ? (
          <p className="px-1 text-sm text-ink/45">
            No cards yet. Add a card to quote services for this order.
          </p>
        ) : (
          draft.cards.map((card, cardIndex) => {
            const customerImages = (card.images ?? []).filter(
              (image) => image.image_type === "customer"
            );
            const adminImages = (card.images ?? []).filter(
              (image) => image.image_type !== "customer"
            );
            const pendingFiles = card.pending_files ?? [];
            const photoInputId = `admin-card-photos-${card.id}`;
            const incomplete = !adminCardIsComplete(card);
            const cardId = String(card.id);
            const indices =
              quoteLinesByCard.indicesByCardId.get(cardId) ?? [];
            const lineAmounts = indices
              .filter((index) => quoteItemIsReady(quoteItems[index]))
              .map((index) => {
                const item = quoteItems[index];
                return moneyFieldToPayload(item.quote_base_amount) ?? 0;
              });
            const servicesSubtotal = lineAmounts.reduce(
              (sum, amount) => sum + amount,
              0
            );
            const cardHv = quoteCardHvAmount({
              hv_amount: draft.quote_card_hv?.[cardId]?.amount_dollars,
            });
            const subtotal = servicesSubtotal + cardHv;

            return (
              <EditorSection
                key={card.id}
                id={`admin-order-card-${card.id}`}
                title={`Card ${cardIndex + 1}`}
                titleExtra={
                  <CardStatusPills
                    value={card.status}
                    ariaLabel={`Card ${cardIndex + 1} status`}
                    onChange={(status) => updateCard(cardIndex, { status })}
                  />
                }
                className={
                  String(card.id) === String(highlightedCardId)
                    ? "border-blush ring-2 ring-blush/45"
                    : incomplete
                      ? "border-berry/55 ring-1 ring-berry/25"
                      : undefined
                }
                action={
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => addQuoteItem(card)}
                      disabled={saving}
                      className="text-sm font-semibold text-berry transition hover:underline disabled:opacity-50"
                    >
                      Add service
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCard(cardIndex)}
                      disabled={saving}
                      className="text-sm font-semibold text-ink/40 transition hover:text-berry disabled:opacity-50"
                    >
                      Remove card
                    </button>
                  </div>
                }
              >
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
                <div className="mt-4 border-t border-ink/10 pt-4">
                  <AdminOrderCardPhotoGroups
                    customerItems={savedPhotoItems(customerImages)}
                    updateItems={savedPhotoItems(adminImages)}
                    pendingFiles={pendingFiles}
                    onRemoveUpdate={
                      removingPhotoId != null || saving
                        ? undefined
                        : (imageId) => removeAdminPhoto(cardIndex, imageId)
                    }
                    onRemovePending={
                      saving
                        ? undefined
                        : (fileId) => removeCardPendingFile(cardIndex, fileId)
                    }
                  />
                  <div className="mt-3">
                    <input
                      id={photoInputId}
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={saving}
                      onChange={(event) => {
                        addCardPendingFiles(cardIndex, event.target.files);
                        event.target.value = "";
                      }}
                      className="sr-only"
                    />
                    <label
                      htmlFor={photoInputId}
                      className={`inline-flex cursor-pointer items-center rounded-xl px-3 py-2 text-sm font-semibold transition ${
                        saving
                          ? "cursor-not-allowed bg-ink/10 text-ink/40"
                          : "bg-berry/15 text-berry hover:bg-berry/25"
                      }`}
                    >
                      Add photos
                    </label>
                    <p className="mt-1.5 text-xs text-ink/50">
                      New photos upload when you save. Customer photos can’t be
                      removed.
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 border-t border-ink/10 pt-4">
                  {indices.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-sky/90">
                        Services
                      </p>
                      {indices.map((index) =>
                        renderQuoteServiceLine(quoteItems[index], index)
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-ink/45">
                      No services yet — add one above.
                    </p>
                  )}
                  <div className="space-y-2 border-t border-ink/10 pt-2">
                    {renderQuoteHvLine(card)}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-ink/15 pt-2.5 text-xs">
                    <span className="font-medium text-ink/55">
                      Card subtotal
                    </span>
                    <p className="text-right tabular-nums text-ink">
                      {lineAmounts.length > 0 || cardHv > 0 ? (
                        <>
                          {lineAmounts.map((amount, i) => (
                            <span key={`${cardId}-amt-${i}`}>
                              {i > 0 ? (
                                <span className="text-ink/40"> + </span>
                              ) : null}
                              <span>{formatMoney(amount)}</span>
                            </span>
                          ))}
                          {cardHv > 0 ? (
                            <span>
                              {lineAmounts.length > 0 ? (
                                <span className="text-ink/40"> + </span>
                              ) : null}
                              <span title="High-value fee">
                                {formatMoney(cardHv)}
                              </span>
                              <span className="text-ink/40"> HV fee</span>
                            </span>
                          ) : null}
                          <span className="text-ink/40"> = </span>
                          <span className="font-semibold">
                            {formatMoney(subtotal)}
                          </span>
                        </>
                      ) : (
                        <span className="font-semibold text-ink/45">
                          {formatMoney(0)}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </EditorSection>
            );
          })
        )}

        {quoteLinesByCard.orphans.length > 0 ? (
          <div className="rounded-xl border border-dashed border-ink/20 px-3 py-3">
            <p className="mb-2 text-sm font-semibold text-ink/70">
              Unmatched quote lines
            </p>
            <div className="space-y-2">
              {quoteLinesByCard.orphans.map((index) =>
                renderQuoteServiceLine(quoteItems[index], index)
              )}
            </div>
          </div>
        ) : null}

        {quoteCoverage.uncoveredCards.length > 0 ||
        quoteCoverage.duplicateServiceCards.length > 0 ? (
          <div className="space-y-2 px-1">
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
          </div>
        ) : null}
      </div>

      <EditorSection title="Quote">
        <div className="space-y-4">
          <EditorSubsection
            title="Adjustments"
            description="Add discounts, delivery, or shipping as straight dollar amounts."
            action={
              <button
                type="button"
                onClick={addQuoteAdjustment}
                className="text-sm font-semibold text-berry transition hover:underline"
              >
                Add row
              </button>
            }
          >
            {(draft.quote_adjustments ?? []).length === 0 ? (
              <p className="text-sm text-ink/45">
                No adjustments yet. Add a row for a discount, delivery, or
                shipping.
              </p>
            ) : (
              <div className="space-y-2">
                {(draft.quote_adjustments ?? []).map((row, index) => (
                  <div
                    key={row.id ?? `adj-${index}`}
                    className="rounded-xl border border-ink/10 bg-cream px-3 py-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]">
                      <label className="block min-w-0">
                        <EditorLabel>Type</EditorLabel>
                        <select
                          className={editorFieldClass()}
                          value={row.kind || "discount"}
                          onChange={(event) =>
                            updateQuoteAdjustment(index, {
                              kind: event.target.value,
                            })
                          }
                        >
                          {ADJUSTMENT_KIND_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                          {row.kind === "surcharge" ? (
                            <option value="surcharge">Surcharge</option>
                          ) : null}
                        </select>
                      </label>
                      <label className="block min-w-0 sm:col-span-1">
                        <EditorLabel>Amount ($)</EditorLabel>
                        <input
                          className={editorFieldClass()}
                          inputMode="decimal"
                          value={row.amount_dollars ?? ""}
                          onChange={(event) =>
                            setAdjustmentDollars(index, event.target.value)
                          }
                          placeholder="0.00"
                        />
                      </label>
                      <div className="flex items-end justify-end">
                        <button
                          type="button"
                          onClick={() => removeQuoteAdjustment(index)}
                          className="pb-2 text-sm font-semibold text-ink/45 transition hover:text-berry"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="block">
                        <EditorLabel>Description</EditorLabel>
                        <input
                          className={editorFieldClass()}
                          value={row.description ?? ""}
                          onChange={(event) =>
                            updateQuoteAdjustment(index, {
                              description: event.target.value,
                            })
                          }
                          placeholder="Optional note…"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </EditorSubsection>

          <EditorSubsection
            title="Receipt"
            description="Preview of what the customer will see on their order."
          >
            <QuoteReceipt
              items={receiptItems}
              cards={receiptCards}
              adjustments={receiptAdjustments}
            />
          </EditorSubsection>
        </div>
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
    </div>
  );
}

export default function AdminApp() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, signOut } = useAuth();
  const pathTab = tabFromPathname(pathname);
  const searchEditId = searchParams.get("edit");
  const searchFocusCardId = searchParams.get("card");
  // Static export can no-op same-path query clears via router.push. Dismiss the
  // editor in React state first so "Back to board" never lands on a blank page.
  const [editorDismissed, setEditorDismissed] = useState(false);
  const routeOrderId = editorDismissed ? null : searchEditId;
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
  const [savePromptOpen, setSavePromptOpen] = useState(false);

  const dirty = useMemo(() => {
    if (!draft) return false;
    return (
      JSON.stringify(draftPayload(draft)) !== savedSnapshot ||
      draftHasPendingPhotos(draft)
    );
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
    setSavePromptOpen(false);
  }, []);

  const refreshOrders = useCallback(async () => {
    setLoadingOrders(true);
    setListError("");
    try {
      const rows = await adminListOrders();
      setOrders(
        rows.map((order) =>
          orderToKanbanSummary({
            ...order,
            quote_total: orderQuoteTotalFromStored(order),
          })
        )
      );
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
    if (!searchEditId) setEditorDismissed(false);
  }, [searchEditId]);

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
    setOrders([]);
    clearEditor();
    try {
      await signOut();
    } catch {
      // Admin token is already cleared; still leave the page.
    }
    router.replace("/");
  }

  async function handlePlaceOrder(orderId, status, queueIndex) {
    const previous = orders;
    const nextStatus = normalizeOrderStatus(status);
    const moving = previous.find((order) => order.id === orderId);
    if (!moving) return;

    const fromStatus = normalizeOrderStatus(moving.status);
    const sameColumn = fromStatus === nextStatus;

    // Adjust insert index when dragging downward in the same column
    let insertAt = Number(queueIndex);
    if (!Number.isFinite(insertAt)) insertAt = Number.MAX_SAFE_INTEGER;
    if (sameColumn) {
      const col = previous
        .filter((o) => normalizeOrderStatus(o.status) === fromStatus)
        .sort((a, b) => {
          const ap = a.queue_priority;
          const bp = b.queue_priority;
          if (ap == null && bp != null) return 1;
          if (ap != null && bp == null) return -1;
          if (ap != null && bp != null && ap !== bp) return Number(ap) - Number(bp);
          return String(a.id).localeCompare(String(b.id));
        });
      const fromIndex = col.findIndex((o) => o.id === orderId);
      if (fromIndex >= 0 && fromIndex < insertAt) insertAt -= 1;
      if (fromIndex === insertAt) return;
    }

    setOrders((current) => {
      const without = current.filter((order) => order.id !== orderId);
      const byStatus = groupOrdersByStatus(without);
      const target = [...(byStatus[nextStatus] ?? [])];
      const wasClosed = isClosedOrderStatus(moving.status);
      const nextClosed = isClosedOrderStatus(nextStatus);
      const placed = {
        ...moving,
        status: nextStatus,
        status_changed_at: new Date().toISOString(),
        completed_at: nextClosed
          ? wasClosed
            ? moving.completed_at
            : new Date().toISOString()
          : null,
      };
      const at = Math.max(0, Math.min(insertAt, target.length));
      target.splice(at, 0, placed);
      const nextPriorities = new Map(
        target.map((order, index) => [order.id, index])
      );
      return current.map((order) => {
        if (order.id === orderId) {
          return { ...placed, queue_priority: nextPriorities.get(orderId) };
        }
        if (normalizeOrderStatus(order.status) === nextStatus) {
          const rank = nextPriorities.get(order.id);
          return rank == null ? order : { ...order, queue_priority: rank };
        }
        return order;
      });
    });

    try {
      if (sameColumn) {
        const without = previous.filter((o) => o.id !== orderId);
        const target = groupOrdersByStatus(without)[nextStatus] ?? [];
        const at = Math.max(0, Math.min(insertAt, target.length));
        const orderedIds = [
          ...target.slice(0, at).map((o) => o.id),
          orderId,
          ...target.slice(at).map((o) => o.id),
        ];
        await adminReorderStatusOrders(nextStatus, orderedIds);
      } else {
        await adminSetStatus(orderId, nextStatus, insertAt);
      }

      const refreshed = await adminListOrders();
      setOrders(refreshed.map(orderToKanbanSummary));

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
      setListError(err.message || "Could not update order place.");
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
        leaveEditor();
      }
      setDeleteTargets(null);
    } catch (err) {
      setListError(err.message || "Could not delete order.");
    } finally {
      setDeletingOrder(false);
    }
  }

  function openOrder(orderId, { from, cardId } = {}) {
    setEditorDismissed(false);
    const params = new URLSearchParams({ edit: String(orderId) });
    if (from === "all") params.set("from", "all");
    if (cardId) params.set("card", String(cardId));
    router.push(`/admin/orders/?${params.toString()}`);
  }

  function leaveEditor() {
    setSavePromptOpen(false);
    setEditorDismissed(true);
    // Same-path ?edit= clears can no-op in the static-export App Router; keep the
    // address bar in sync while React state already shows the board.
    if (typeof window !== "undefined" && editReturnPath === "/admin/orders/") {
      window.history.replaceState(window.history.state, "", editReturnPath);
    }
    router.replace(editReturnPath);
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

  function requestSave() {
    if (!selectedOrderId || !draft) return;
    const validationError = validateDraftForSave(draft);
    if (validationError) {
      setEditorError(validationError);
      return;
    }
    setEditorError("");
    setSavePromptOpen(true);
  }

  async function handleSave({ notify = false, subject = "", body = "" } = {}) {
    if (!selectedOrderId || !draft) return;
    const validationError = validateDraftForSave(draft);
    if (validationError) {
      setEditorError(validationError);
      setSavePromptOpen(false);
      return;
    }

    const pendingUploads = (draft.cards ?? [])
      .map((card) => ({
        cardId: card.id,
        files: card.pending_files ?? [],
      }))
      .filter((entry) => entry.files.length > 0);

    setSaving(true);
    setEditorError("");
    setSavePromptOpen(false);
    try {
      const payload = draftPayload(draft);
      let refreshed = await adminSaveOrder(selectedOrderId, payload);

      for (const { cardId, files } of pendingUploads) {
        for (const entry of files) {
          const { file: uploadFile, error: compressError } =
            await compressImageForUpload(entry.file);
          if (compressError || !uploadFile) {
            throw new Error(compressError || "Couldn't process this image.");
          }
          const { file: thumb } = await makeThumbForUpload(uploadFile);
          await adminUploadPhoto(
            selectedOrderId,
            cardId,
            "admin",
            uploadFile,
            { thumb }
          );
        }
      }

      if (pendingUploads.length > 0) {
        refreshed = await adminGetOrder(selectedOrderId);
      }

      const nextDraft = orderToDraft(refreshed);
      setDraft(nextDraft);
      setSavedSnapshot(JSON.stringify(draftPayload(nextDraft)));
      setOrders((current) =>
        current.map((order) => {
          if (order.id !== selectedOrderId) return order;
          const summary = orderToKanbanSummary(refreshed);
          // Detail responses historically omitted queue_priority; don't let a
          // null overwrite the column rank and jump the card in the board.
          if (
            summary.queue_priority == null &&
            order.queue_priority != null
          ) {
            summary.queue_priority = order.queue_priority;
          }
          return { ...order, ...summary };
        })
      );

      if (notify && subject.trim() && body.trim()) {
        try {
          const result = await adminSendMessages({
            order_ids: [selectedOrderId],
            subject: subject.trim(),
            body,
          });
          if ((result.failed ?? 0) > 0) {
            const firstError = Array.isArray(result.results)
              ? result.results.find((row) => row.email_status === "failed")
                  ?.email_error
              : null;
            setEditorError(
              firstError ||
                "Order saved, but the customer notification failed to send."
            );
          }
        } catch (notifyErr) {
          setEditorError(
            notifyErr.message ||
              "Order saved, but the customer notification failed to send."
          );
        }
      }
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

              {routeOrderId && !draft && !editorError && (
                <LoadingIndicator label="Loading order…" />
              )}

              {routeOrderId && editorError && !draft && (
                <div className="space-y-3">
                  <p className="rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
                    {editorError}
                  </p>
                  <button
                    type="button"
                    onClick={leaveEditor}
                    className="text-sm font-medium text-ink/55 transition hover:text-ink"
                  >
                    ← Back to board
                  </button>
                </div>
              )}

              {routeOrderId && draft && (
                <>
                  <OrderEditor
                    displayId={selectedDisplayId}
                    orderId={selectedOrderId}
                    draft={draft}
                    dirty={dirty}
                    saving={saving}
                    error={editorError}
                    focusCardId={searchFocusCardId}
                    onBack={leaveEditor}
                    backLabel={
                      searchParams.get("from") === "all"
                        ? "Back to all orders"
                        : "Back to board"
                    }
                    onChange={(next) =>
                      setDraft((current) =>
                        typeof next === "function" ? next(current) : next
                      )
                    }
                    onCancel={handleCancel}
                    onSave={requestSave}
                    onError={setEditorError}
                  />
                  <OrderSaveChangesDialog
                    open={savePromptOpen}
                    displayId={selectedDisplayId}
                    customerEmail={draft.customer_email}
                    beforePayload={
                      savedSnapshot ? JSON.parse(savedSnapshot) : null
                    }
                    afterPayload={draftPayload(draft)}
                    saving={saving}
                    onCancel={() => {
                      if (!saving) setSavePromptOpen(false);
                    }}
                    onConfirm={handleSave}
                  />
                </>
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
              <OrderCardSearch
                onOpenOrder={(orderId, options) =>
                  openOrder(orderId, { from: "all", ...options })
                }
              />
              <OrdersAllList
                orders={orders}
                onOpenOrder={(orderId) => openOrder(orderId, { from: "all" })}
              />
            </div>
          ) : (
            <>
              <div className="mb-4">
                <OrderCardSearch onOpenOrder={openOrder} />
              </div>
              <KanbanBoard
                orders={orders}
                onOpenOrder={openOrder}
                onPlaceOrder={handlePlaceOrder}
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

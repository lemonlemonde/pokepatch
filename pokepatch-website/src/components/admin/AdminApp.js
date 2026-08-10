"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import SectionHeading from "@/components/SectionHeading";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminAllowedEmail } from "@/lib/adminAccess";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import {
  adminDeleteOrders,
  adminGetOrder,
  adminListOrders,
  adminLoginWithSession,
  adminLogout,
  adminSearchOrders,
  adminSendMessages,
  adminSetPendingKind,
  adminSetStatus,
  adminValidate,
  isAdminApiConfigured,
} from "@/lib/adminApi";
import { thumbPath } from "@/lib/imageCompression";
import { forgetSignedUrl } from "@/lib/signedUrlCache";
import { supabase } from "@/lib/supabaseClient";
import GalleryManager from "@/components/admin/GalleryManager";
import OrderSaveChangesDialog from "@/components/admin/OrderSaveChangesDialog";
import OrderEditorShell from "@/components/admin/orderEditor/OrderEditorShell";
import { buildCardThumbById } from "@/lib/orderChangelog";
import StudioTool from "@/components/StudioTool";
import RestorationGuide from "@/components/admin/RestorationGuide";
import {
  useUnsavedChangesGuard,
} from "@/lib/useUnsavedChangesGuard";
import {
  ExpandPanel,
  overlayFadeClassName,
  useOverlayPresence,
} from "@/components/ExpandReveal";
import {
  ORDER_STATUSES,
  ACTIVE_ORDER_STATUSES,
  COMPLETED_ORDER_STATUS,
  CANCELED_ORDER_STATUS,
  CARD_STATUSES,
  PENDING_KINDS,
  groupOrdersByStatus,
  normalizeOrderStatus,
  normalizeCardStatus,
  normalizePendingKind,
  DEFAULT_PENDING_KIND,
  orderStatusHeadingClass,
  orderStatusLabel,
  orderDisplayLabel,
  orderStatusBadgeClass,
  cardStatusBadgeClass,
  isClosedOrderStatus,
  isPendingOrderStatus,
  filterClosedColumnOrders,
  sortOrdersForStatusColumn,
  pendingKindShortLabel,
  pendingKindBadgeClass,
} from "@/lib/orderStatus";
import { formatMoney, orderQuoteTotalFromStored } from "@/lib/servicePricing";

const ADMIN_TABS = [
  {
    id: "orders",
    label: "Orders",
    path: "/admin/orders/",
    title: "Orders admin",
    subtitle:
     "Search cards by name or set (scope with status chips). Drag between columns to change status. Hover to inspect, click to edit. Closed columns show the last 7 days — use Show all for older orders. Right-click or drag to the bin to delete.",
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
     "Format 1×2 before & after Instagram posts.",
  },
  {
    id: "guide",
    label: "Restoration Guide",
    path: "/admin/guide/",
    title: "Restoration guide",
    subtitle:
     "Restoration tree: dirt and scratches first, then any damage branches that apply, cool press when needed, and wrap up.",
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
  if (path.startsWith("/admin/queue")) return "orders";
  const match = ADMIN_TABS.find((entry) =>
    path.startsWith(entry.path.replace(/\/$/, ""))
  );
  return match?.id ?? "orders";
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

function deliveryShortLabel(value) {
  if (value === "local_dropoff") return "Local";
  if (value === "shipping") return "Ship";
  return deliveryLabel(value);
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
    pending_kind:
      status === "pending"
        ? normalizePendingKind(order.pending_kind)
        : null,
    completed_at: isClosed ? (order.completed_at ?? null) : null,
    status_changed_at: order.status_changed_at ?? null,
    card_count: order.card_count ?? order.cards?.length ?? 0,
    cards_completed: order.cards_completed ?? null,
    is_priority: Boolean(order.is_priority),
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
        <span className="font-semibold text-ink/55">Earned</span>{" "}
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

function PendingKindChip({
  order,
  onSetPendingKind,
  onInteract,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const kind = normalizePendingKind(order.pending_kind);

  const placeMenu = useCallback(() => {
    const button = rootRef.current?.querySelector("button");
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const menuWidth = 160; // min-w-[10rem]
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - menuWidth - 8
    );
    setMenuPos({ top: rect.bottom + 4, left });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    placeMenu();
    function onPointerDown(event) {
      const target = event.target;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    function onReposition() {
      placeMenu();
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, placeMenu]);

  const menu =
    open &&
    menuPos &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        ref={menuRef}
        role="listbox"
        className="fixed z-[220] min-w-[10rem] overflow-hidden rounded-xl border border-ink/15 bg-cream py-1 "
        style={{ top: menuPos.top, left: menuPos.left }}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {PENDING_KINDS.map((option) => {
          const selected = kind === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={selected}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-ink/5 ${
                selected ? "text-ink" : "text-ink/80"
              }`}
              onClick={() => {
                setOpen(false);
                onInteract?.();
                if (!selected) onSetPendingKind?.(order.id, option.id);
              }}
            >
              <span
                className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold ${pendingKindBadgeClass(
                  option.id
                )}`}
              >
                {option.shortLabel ?? option.label}
              </span>
            </button>
          );
        })}
      </div>,
      document.body
    );

  return (
    <span ref={rootRef} className="relative -translate-y-0.5 shrink-0">
      <button
        type="button"
        disabled={disabled || !onSetPendingKind}
        draggable={false}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => {
            const next = !current;
            if (next) onInteract?.();
            return next;
          });
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          event.stopPropagation();
          onInteract?.();
        }}
        className={`inline-flex min-h-8 items-center gap-0.5 rounded-full py-1 pl-2 pr-1.5 text-xs font-bold transition sm:min-h-0 sm:py-0.5 sm:pl-1.5 sm:pr-1 sm:text-[10px] ${pendingKindBadgeClass(
          kind
        )} ${disabled ? "opacity-60" : "hover:brightness-95"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={orderDisplayLabel("pending", kind)}
      >
        {pendingKindShortLabel(kind)}
        <ChevronDownIcon
          className={`h-2.5 w-2.5 shrink-0 opacity-70 transition ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {menu}
    </span>
  );
}

/** Paid priority service — distinct from manual queue reorder (removed). */
function PriorityServiceBadge({ compact = false }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-berry/35 bg-berry/15 font-bold uppercase tracking-[0.08em] text-blush ${
        compact
          ? "h-[18px] min-w-[18px] px-1 text-[9px] leading-none"
          : "px-2.5 py-1 text-[11px] leading-none"
      }`}
      title="Priority service"
      aria-label="Priority service"
    >
      {compact ? "P" : "Priority"}
    </span>
  );
}

function KanbanCard({
  order,
  onOpen,
  onContextMenu,
  dragging,
  showPendingChip = false,
  onSetPendingKind,
  suppressInspect = false,
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
    if (dragging || suppressInspect) return;
    clearTimers();
    openTimerRef.current = setTimeout(showInspect, INSPECT_OPEN_DELAY_MS);
  }, [clearTimers, dragging, showInspect, suppressInspect]);

  const scheduleClose = useCallback(() => {
    clearTimers();
    closeTimerRef.current = setTimeout(hideInspect, INSPECT_CLOSE_DELAY_MS);
  }, [clearTimers, hideInspect]);

  function handleMouseEnter(event) {
    if (suppressInspect) return;
    placeAtCursor(event.clientX, event.clientY, { syncState: true });
    scheduleOpen();
  }

  function handleMouseMove(event) {
    if (suppressInspect) return;
    placeAtCursor(event.clientX, event.clientY, {
      syncState: !inspectOpen,
    });
  }

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (dragging || suppressInspect) hideInspect();
  }, [dragging, suppressInspect, hideInspect]);

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
      className={`relative flex w-full cursor-grab items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left transition hover:border-ink/40 active:cursor-grabbing ${
        order.is_priority
          ? "border-berry/30 bg-berry/[0.08]"
          : "border-ink/10 bg-ink/[0.03]"
      } ${dragging ? "opacity-50" : ""}`}
    >
      {order.is_priority ? (
        <span
          className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-berry/70"
          aria-hidden="true"
        />
      ) : null}
      <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
        #{order.display_id}
      </span>
      {order.is_priority ? <PriorityServiceBadge compact /> : null}
      {showPendingChip ? (
        <PendingKindChip
          order={order}
          onSetPendingKind={onSetPendingKind}
          onInteract={hideInspect}
          disabled={dragging}
        />
      ) : null}
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
        className="pointer-events-none fixed z-[200] rounded-xl border border-ink/15 bg-cream p-3 "
        style={{
          top: panelPos.top,
          left: panelPos.left,
          width: INSPECT_PANEL_WIDTH,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm font-bold tabular-nums text-ink">
            #{order.display_id}
            {order.is_priority ? (
              <span className="ml-2 inline-flex align-middle">
                <PriorityServiceBadge compact />
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
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
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
          </div>
          {order.checklist_progress ? (
            <div className="mt-1 shrink-0 space-y-0.5 text-right text-[11px] font-medium tabular-nums">
              {Object.entries(order.checklist_progress).map(
                ([groupId, progress]) => (
                  <p
                    key={groupId}
                    className={
                      progress.total > 0 && progress.done === progress.total
                        ? "text-mint"
                        : "text-ink/50"
                    }
                  >
                    {progress.done}/{progress.total} {groupId}
                  </p>
                )
              )}
            </div>
          ) : null}
        </div>
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
  const open = Boolean(orders?.length);
  const { mounted, visible } = useOverlayPresence(open);
  const [snapshot, setSnapshot] = useState(orders);

  if (orders?.length && orders !== snapshot) {
    setSnapshot(orders);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, deleting, onCancel]);

  if (!mounted || !snapshot?.length) return null;

  const count = snapshot.length;
  const isBulk = count > 1;
  const title = isBulk
    ? `Delete ${count} orders?`
    : `Delete order #${snapshot[0].display_id}?`;
  const confirmLabel = isBulk
    ? `Yes, delete ${count} orders`
    : "Yes, delete this order";

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-night/70 px-4 ${overlayFadeClassName(visible)}`}
      role="presentation"
      onClick={() => {
        if (!deleting) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-order-title"
        className="w-full max-w-md rounded-2xl border border-ink/15 bg-cream p-6 "
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
              {formatOrderIdList(snapshot)}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-xl border border-ink/20 px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink/30 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-xl bg-berry px-4 py-2 text-sm font-semibold text-night transition hover:brightness-110 disabled:opacity-40"
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
const ALL_SEARCH_STATUSES = ORDER_STATUSES.map((status) => status.id);

function orderMatchesLocalQuery(order, query) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (String(order.display_id ?? "").includes(q)) return true;
  if (order.customer_name?.toLowerCase().includes(q)) return true;
  if (order.customer_email?.toLowerCase().includes(q)) return true;
  return false;
}

function filterOrdersForAllList(orders, { query, statuses, searchOrderIds }) {
  if (!statuses?.length) return [];

  let list = orders ?? [];

  if (statuses.length < ORDER_STATUSES.length) {
    list = list.filter((order) =>
      statuses.includes(normalizeOrderStatus(order.status))
    );
  }

  const q = query.trim();
  if (q.length >= 2) {
    const idSet = new Set(searchOrderIds ?? []);
    list = list.filter(
      (order) => orderMatchesLocalQuery(order, q) || idSet.has(order.id)
    );
  }

  return list;
}

function OrderCardSearch({
  onOpenOrder,
  defaultStatuses = DEFAULT_SEARCH_STATUSES,
  onFilterChange,
}) {
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState(defaultStatuses);
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
    if (!onFilterChange) return;
    const q = query.trim();
    onFilterChange({
      query,
      statuses,
      searchOrderIds:
        q.length >= 2
          ? [...new Set(results.map((hit) => hit.order_id))]
          : null,
      searching: q.length >= 2 && searching,
    });
  }, [query, statuses, results, searching, onFilterChange]);

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
      <div className="rounded-2xl border border-ink/10 bg-night/30 p-3 sm:p-4">
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
              className="w-full rounded-xl border border-ink/15 bg-cream px-3.5 py-2.5 pr-10 text-sm text-ink outline-none transition focus:border-ink/40"
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
              className="relative shrink-0 rounded-xl border border-ink/20 px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-ink/30"
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
                      : "border border-ink/15 bg-ink/[0.03] text-ink/45 hover:border-ink/30 hover:text-ink/70"
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
        <div className="absolute left-0 right-0 top-[calc(100%-0.5rem)] z-30 mt-2 max-h-[min(28rem,60vh)] overflow-y-auto rounded-2xl border border-ink/15 bg-cream ">
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
                              orderStatus,
                              hit.pending_kind
                            )}`}
                          >
                            {orderDisplayLabel(orderStatus, hit.pending_kind)}
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

function OrdersAllList({ orders, onOpenOrder, emptyMessage = "No orders yet." }) {
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
        {emptyMessage}
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
                      status,
                      order.pending_kind
                    )}`}
                  >
                    {orderDisplayLabel(status, order.pending_kind)}
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

function OrdersAllSection({ orders, onOpenOrder, onBackToBoard }) {
  const [listFilter, setListFilter] = useState({
    query: "",
    statuses: ALL_SEARCH_STATUSES,
    searchOrderIds: null,
    searching: false,
  });

  const filteredOrders = useMemo(
    () => filterOrdersForAllList(orders, listFilter),
    [orders, listFilter]
  );

  const isFiltering =
    listFilter.statuses.length < ORDER_STATUSES.length ||
    listFilter.query.trim().length >= 2;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink/50">
          {isFiltering
            ? `${filteredOrders.length} of ${orders.length} orders`
            : `${orders.length} order${orders.length === 1 ? "" : "s"}`}
        </p>
        <button
          type="button"
          onClick={onBackToBoard}
          className="rounded-xl border border-ink/20 px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-ink/30"
        >
          Back to board
        </button>
      </div>
      <OrderCardSearch
        defaultStatuses={ALL_SEARCH_STATUSES}
        onFilterChange={setListFilter}
        onOpenOrder={(orderId, options) =>
          onOpenOrder(orderId, { from: "all", ...options })
        }
      />
      {listFilter.searching ? (
        <LoadingIndicator compact label="Searching…" className="px-1" />
      ) : null}
      <OrdersAllList
        orders={filteredOrders}
        emptyMessage={
          isFiltering
            ? "No orders match the current filters."
            : "No orders yet."
        }
        onOpenOrder={(orderId) => onOpenOrder(orderId, { from: "all" })}
      />
    </div>
  );
}

function KanbanBoard({
  orders,
  onOpenOrder,
  onPlaceOrder,
  onSetPendingKind,
  onRequestDelete,
  onViewAllOrders,
  suppressInspect = false,
}) {
  const [dragOrderId, setDragOrderId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { statusId, index }
  const dropTargetRef = useRef(null);
  const [trashArmed, setTrashArmed] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [canceledExpanded, setCanceledExpanded] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);

  const columns = useMemo(() => groupOrdersByStatus(orders), [orders]);
  const revenue = useMemo(
    () => ({
      completed: sumOrderAmounts(columns.completed),
      pipeline: sumOrderAmounts([
        ...(columns.new ?? []),
        ...(columns.in_progress ?? []),
        ...(columns.ready ?? []),
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

  async function commitDrop(statusId) {
    const orderId = dragOrderId;
    setDragOrderId(null);
    dropTargetRef.current = null;
    setDropTarget(null);
    setTrashArmed(false);
    if (!orderId) return;
    const fromStatus = normalizeOrderStatus(dragOrder?.status);
    const toStatus = normalizeOrderStatus(statusId);
    if (fromStatus === toStatus) return;
    await onPlaceOrder(orderId, statusId);
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

  function renderColumn(
    status,
    {
      closed,
      dock = false,
      expanded = true,
      onToggleExpand,
      dockDropHint = "Drop orders here or see more",
    }
  ) {
    const rawOrders = columns[status.id] ?? [];
    const columnOrders = closed
      ? filterClosedColumnOrders(rawOrders)
      : rawOrders;
    const hiddenCount = closed
      ? Math.max(0, rawOrders.length - columnOrders.length)
      : 0;
    const showList = !dock || expanded;
    const columnDropHighlight =
      dragOrderId && dropTarget?.statusId === status.id;

    function updateColumnDropTarget(event) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (!dragOrderId) return;
      setDropTargetStable({ statusId: status.id, index: 0 });
    }

    function dropOnColumn(event) {
      event.preventDefault();
      void commitDrop(status.id);
    }

    function handleColumnDragLeave(event) {
      const related = event.relatedTarget;
      // Browsers often leave relatedTarget null during drag — ignore those.
      if (related && event.currentTarget.contains(related)) return;
      if (dropTargetRef.current?.statusId === status.id) {
        dropTargetRef.current = null;
        setDropTarget(null);
      }
    }

    // No `overscroll-contain` on the list: the column is height-capped
    // (72vh) while the page keeps scrolling below it, so the wheel has to
    // chain out to the page once this list hits its top/bottom — with
    // containment, hovering any column traps the scroll.
    const orderList = (
      <div
        data-kanban-scroll
        className={`min-h-0 space-y-2 overflow-y-auto pr-0.5 ${
          dock
            ? "max-h-48 flex-none"
            : "flex-1 max-sm:max-h-[calc(4*4.25rem+3*0.5rem)] max-sm:flex-none"
        }`}
        onDragOver={(event) => updateColumnDropTarget(event)}
        onDragLeave={handleColumnDragLeave}
        onDrop={(event) => dropOnColumn(event)}
      >
        {columnOrders.map((order) => (
          <div
            key={order.id}
            data-kanban-row
            className="relative"
            draggable
            onDragStart={(event) => handleDragStart(event, order.id)}
            onDragEnd={handleDragEnd}
          >
            <KanbanCard
              order={order}
              onOpen={onOpenOrder}
              onContextMenu={handleCardContextMenu}
              dragging={dragOrderId === order.id}
              showPendingChip={status.id === "pending"}
              onSetPendingKind={onSetPendingKind}
              suppressInspect={suppressInspect}
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
            className="w-full rounded-lg border border-dashed border-ink/20 px-2 py-2 text-center text-xs font-semibold text-ink/50 transition hover:border-ink/50 hover:text-ink/70"
          >
            +{hiddenCount} older than 7 days — show all
          </button>
        )}
      </div>
    );

    return (
      <section
        key={status.id}
        className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-ink/[0.02] p-3 transition ${
          columnDropHighlight
            ? "border-berry/50 bg-berry/10"
            : "border-ink/10"
        } ${dock ? "" : "h-full"}`}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (!dragOrderId) return;
          setDropTargetStable({ statusId: status.id, index: 0 });
        }}
        onDragLeave={handleColumnDragLeave}
        onDrop={(event) => {
          if (showList && columnOrders.length > 0) return;
          event.preventDefault();
          void commitDrop(status.id);
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
        {dock ? (
          <>
            <ExpandPanel open={Boolean(expanded)}>
              {orderList}
            </ExpandPanel>
            <ExpandPanel open={!expanded}>
              <p className="mt-1 text-xs text-ink/45">
                {columnDropHighlight
                  ? dockDropHint
                  : `Collapsed — ${dockDropHint.toLowerCase()}`}
              </p>
            </ExpandPanel>
          </>
        ) : (
          orderList
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
          className="rounded-xl border border-ink/20 px-3 py-1.5 text-sm font-semibold text-ink transition hover:border-ink/30"
        >
          View all orders
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:h-[min(72vh,calc(100dvh-14rem))] sm:grid-cols-2 xl:grid-cols-4">
        {ACTIVE_ORDER_STATUSES.map((status) =>
          renderColumn(status, { closed: false })
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {COMPLETED_ORDER_STATUS
          ? renderColumn(COMPLETED_ORDER_STATUS, {
              closed: true,
              dock: true,
              expanded: completedExpanded,
              onToggleExpand: setCompletedExpanded,
              dockDropHint: "Drop here when picked up",
            })
          : null}
        {CANCELED_ORDER_STATUS
          ? renderColumn(CANCELED_ORDER_STATUS, {
              closed: true,
              dock: true,
              expanded: canceledExpanded,
              onToggleExpand: setCanceledExpanded,
              dockDropHint: "Drop here to cancel",
            })
          : null}
        <div
          role="region"
          aria-label="Delete order drop zone"
          onDragOver={handleTrashDragOver}
          onDragLeave={handleTrashDragLeave}
          onDrop={handleTrashDrop}
          className={`flex items-center justify-center gap-3 rounded-2xl border border-dashed px-4 py-4 transition ${
            trashArmed
              ? "border-berry bg-berry/20 text-berry "
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
                : "Recycling bin"}
            </p>
            <p className="mt-0.5 text-xs opacity-80">
              {trashArmed
                ? "You’ll confirm before anything is deleted"
                : "Right-click or drag here — always confirms first"}
            </p>
          </div>
        </div>
      </div>

      {contextMenu && (
        <div
          role="menu"
          className="fixed z-40 min-w-[12rem] overflow-hidden rounded-xl border border-ink/15 bg-cream py-1 "
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

export default function AdminApp() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, signOut } = useAuth();
  const pathTab = tabFromPathname(pathname);
  const searchEditId = searchParams.get("edit");
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
  const [orderDetail, setOrderDetail] = useState(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [listError, setListError] = useState("");
  const [deleteTargets, setDeleteTargets] = useState(null);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const [movePrompt, setMovePrompt] = useState(null);
  const [moveSaving, setMoveSaving] = useState(false);
  const [noteOnlySending, setNoteOnlySending] = useState(false);

  const unsavedOrderEdit = editorDirty && tab === "orders-edit";
  const { requestLeave, dialog: unsavedChangesDialog } =
    useUnsavedChangesGuard(unsavedOrderEdit);

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
    setOrderDetail(null);
    setEditorDirty(false);
    setEditorError("");
    setLoadingOrderId(null);
    setMovePrompt(null);
  }, []);

  const syncOrderAfterSave = useCallback((refreshed) => {
    setOrderDetail(refreshed);
    setOrders((current) =>
      current.map((order) => {
        if (order.id !== refreshed.id) return order;
        const summary = orderToKanbanSummary(refreshed);
        return {
          ...order,
          ...summary,
          is_priority: Boolean(refreshed.is_priority ?? summary.is_priority),
        };
      })
    );
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

      if (!isCustomerAuthEnabled()) {
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
        setReady(true);
        router.replace("/login?redirect=/admin/orders/");
        return;
      }

      if (!isAdminAllowedEmail(user.email)) {
        setAuthError(`${user.email} is not allowlisted for admin.`);
        setAuthed(false);
        setReady(true);
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
      setOrderDetail(null);
      try {
        const order = await adminGetOrder(routeOrderId);
        if (cancelled) return;
        setSelectedDisplayId(order.display_id);
        setOrderDetail(order);
      } catch (err) {
        if (cancelled) return;
        setSelectedOrderId(null);
        setSelectedDisplayId(null);
        setOrderDetail(null);
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
    if (unsavedOrderEdit && !(await requestLeave())) return;
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

  function handleSetPendingKind(orderId, nextKind) {
    const previous = orders;
    const moving = previous.find((order) => order.id === orderId);
    if (!moving || !isPendingOrderStatus(moving.status)) return;
    const fromKind = normalizePendingKind(moving.pending_kind);
    const toKind = normalizePendingKind(nextKind);
    if (fromKind === toKind) return;

    const previewUrls = Array.isArray(moving.preview_urls)
      ? moving.preview_urls.filter(Boolean)
      : [];
    setMovePrompt({
      kind: "pending_kind",
      orderId,
      nextPendingKind: toKind,
      previous,
      moving,
      displayId: moving.display_id,
      customerEmail: moving.customer_email,
      orderSummary: {
        displayId: moving.display_id,
        customerName: moving.customer_name,
        thumbUrl: previewUrls[0] ?? null,
        fromStatus: "pending",
        toStatus: "pending",
        fromPendingKind: fromKind,
        toPendingKind: toKind,
        cardCount: moving.card_count ?? null,
      },
      beforePayload: {
        order: { status: "pending", pending_kind: fromKind },
        cards: [],
        quote_items: [],
      },
      afterPayload: {
        order: { status: "pending", pending_kind: toKind },
        cards: [],
        quote_items: [],
      },
    });
  }

  async function commitPendingKindChange({
    orderId,
    nextPendingKind,
    previous,
  }) {
    const pendingKind = normalizePendingKind(nextPendingKind);
    const previousOrderDetail = orderDetail;

    setOrders((current) =>
      current.map((order) =>
        order.id === orderId ? { ...order, pending_kind: pendingKind } : order
      )
    );
    if (selectedOrderId === orderId) {
      setOrderDetail((current) =>
        current ? { ...current, pending_kind: pendingKind } : current
      );
    }

    try {
      await adminSetPendingKind(orderId, pendingKind);
    } catch (err) {
      setOrders(previous);
      if (selectedOrderId === orderId) {
        setOrderDetail(previousOrderDetail);
      }
      throw err;
    }
  }

  async function handlePlaceOrder(orderId, status) {
    const previous = orders;
    const nextStatus = normalizeOrderStatus(status);
    const moving = previous.find((order) => order.id === orderId);
    if (!moving) return;

    const fromStatus = normalizeOrderStatus(moving.status);
    if (fromStatus === nextStatus) return;

    const previewUrls = Array.isArray(moving.preview_urls)
      ? moving.preview_urls.filter(Boolean)
      : [];
    setMovePrompt({
      orderId,
      nextStatus,
      previous,
      moving,
      displayId: moving.display_id,
      customerEmail: moving.customer_email,
      orderSummary: {
        displayId: moving.display_id,
        customerName: moving.customer_name,
        thumbUrl: previewUrls[0] ?? null,
        fromStatus,
        toStatus: nextStatus,
        fromPendingKind: isPendingOrderStatus(fromStatus)
          ? normalizePendingKind(moving.pending_kind)
          : null,
        toPendingKind:
          nextStatus === "pending"
            ? isPendingOrderStatus(fromStatus)
              ? normalizePendingKind(moving.pending_kind)
              : DEFAULT_PENDING_KIND
            : null,
        cardCount: moving.card_count ?? null,
      },
      beforePayload: {
        order: {
          status: fromStatus,
          pending_kind: isPendingOrderStatus(fromStatus)
            ? normalizePendingKind(moving.pending_kind)
            : null,
        },
        cards: [],
        quote_items: [],
      },
      afterPayload: {
        order: {
          status: nextStatus,
          pending_kind:
            nextStatus === "pending"
              ? isPendingOrderStatus(fromStatus)
                ? normalizePendingKind(moving.pending_kind)
                : DEFAULT_PENDING_KIND
              : null,
        },
        cards: [],
        quote_items: [],
      },
    });
  }

  async function commitPlaceOrder({ orderId, nextStatus, previous, moving }) {
    const pendingKind =
      nextStatus === "pending"
        ? isPendingOrderStatus(moving.status)
          ? normalizePendingKind(moving.pending_kind)
          : DEFAULT_PENDING_KIND
        : null;

    setOrders((current) => {
      const wasClosed = isClosedOrderStatus(moving.status);
      const nextClosed = isClosedOrderStatus(nextStatus);
      return current.map((order) =>
        order.id === orderId
          ? {
              ...moving,
              status: nextStatus,
              pending_kind: pendingKind,
              status_changed_at: new Date().toISOString(),
              completed_at: nextClosed
                ? wasClosed
                  ? moving.completed_at
                  : new Date().toISOString()
                : null,
            }
          : order
      );
    });

    try {
      await adminSetStatus(orderId, nextStatus, null, {
        pendingKind: nextStatus === "pending" ? pendingKind : undefined,
      });

      if (selectedOrderId === orderId) {
        setOrderDetail((current) => {
          if (!current) return current;
          return {
            ...current,
            status: nextStatus,
            pending_kind: pendingKind,
          };
        });
      }
    } catch (err) {
      setOrders(previous);
      setListError(err.message || "Could not update order status.");
      throw err;
    }
  }

  async function sendMoveNotification(orderId, { subject, body, changelog }) {
    if (!subject.trim() || (!body.trim() && !changelog)) return;
    await adminSendMessages({
      order_ids: [orderId],
      subject: subject.trim(),
      body,
      changelog,
      thumb_by_card_id: buildCardThumbById(
        selectedOrderId === orderId ? orderDetail?.cards ?? [] : []
      ),
    });
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
        leaveEditor({ skipConfirm: true });
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

  async function leaveEditor({ skipConfirm = false } = {}) {
    if (!skipConfirm && editorDirty && !(await requestLeave())) return;
    setEditorDismissed(true);
    // Same-path ?edit= clears can no-op in the static-export App Router; keep the
    // address bar in sync while React state already shows the board.
    if (typeof window !== "undefined" && editReturnPath === "/admin/orders/") {
      window.history.replaceState(window.history.state, "", editReturnPath);
    }
    router.replace(editReturnPath);
  }

  async function navigateAdmin(path) {
    if (unsavedOrderEdit && !(await requestLeave())) return;
    if (tab === "orders-edit") {
      clearEditor();
      setEditorDismissed(true);
    }
    router.push(path);
  }

  async function handleMoveConfirm({
    notify = false,
    subject = "",
    body = "",
    changelog = null,
  } = {}) {
    if (!movePrompt) return;
    const prompt = movePrompt;
    setMoveSaving(true);
    setListError("");
    try {
      if (prompt.kind === "pending_kind") {
        await commitPendingKindChange(prompt);
      } else {
        await commitPlaceOrder(prompt);
      }
      setMovePrompt(null);

      if (notify) {
        try {
          await sendMoveNotification(prompt.orderId, {
            subject,
            body,
            changelog,
          });
        } catch (notifyErr) {
          setListError(
            notifyErr.message ||
             "Order moved, but the customer notification failed to send."
          );
        }
      }
    } catch (err) {
      setListError(
        err.message ||
          (prompt.kind === "pending_kind"
            ? "Could not update pending type."
            : "Could not update order status.")
      );
    } finally {
      setMoveSaving(false);
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

  if (!isCustomerAuthEnabled()) {
    return (
      <div className="mx-auto max-w-lg space-y-3 px-4 py-16 text-center text-ink/70">
        <p>Admin requires customer login.</p>
        <p className="text-sm">
          Add{" "}
          <code className="rounded bg-night/50 px-1">
            NEXT_PUBLIC_CUSTOMER_AUTH_ENABLED=true
          </code>{" "}
          and{" "}
          <code className="rounded bg-night/50 px-1">
            NEXT_PUBLIC_ADMIN_ALLOWED_EMAILS
          </code>{" "}
          to <code className="rounded bg-night/50 px-1">.env.local</code>, then restart{" "}
          <code className="rounded bg-night/50 px-1">npm run dev</code>.
        </p>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-16 text-center">
        <LoadingIndicator
          label={authError ? "Couldn't open admin" : "Loading admin…"}
        />
        {authError ? (
          <p className="rounded-lg border border-berry/40 bg-berry/10 px-4 py-3 text-sm text-berry">
            {authError}
          </p>
        ) : null}
        {!user ? (
          <p className="text-sm text-ink/60">
            <a href="/login/?redirect=/admin/orders/" className="font-semibold text-blush hover:underline">
              Log in
            </a>{" "}
            with an allowlisted admin account to continue.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-3 py-8 sm:px-4 sm:py-10 md:px-6">
      <div className="relative mb-8">
        {tab !== "orders-edit" ? (
          <SectionHeading
            note="Admin"
            subtitle={activeTab.subtitle}
          >
            {activeTab.title}
          </SectionHeading>
        ) : (
          <div className="h-0 sm:h-10" aria-hidden="true" />
        )}
        <div className="mt-3 flex flex-wrap items-center justify-start gap-3 sm:absolute sm:right-0 sm:top-0 sm:mt-0 sm:justify-end">
          {ordersSectionActive && loadingOrders && orders.length > 0 && (
            <LoadingIndicator compact label="Refreshing…" />
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-ink/20 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink/70 transition hover:border-ink/40 hover:text-ink"
          >
            Log out
          </button>
        </div>
      </div>

      <div className="mb-8 flex flex-wrap gap-2">
        {ADMIN_TABS.map((entry) => {
          const active =
            entry.id === "orders" ? ordersSectionActive : tab === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => navigateAdmin(entry.path)}
              className={`rounded-lg px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition ${
                active
                  ? "bg-ink text-night"
                  : "border border-ink/15 text-ink/55 hover:border-ink/30 hover:text-ink"
              }`}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      {tab === "gallery" && <GalleryManager />}
      {tab === "studio" && <StudioTool />}
      {tab === "guide" && <RestorationGuide />}
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

              {routeOrderId && !orderDetail && !editorError && (
                <LoadingIndicator label="Loading order…" />
              )}

              {routeOrderId && editorError && !orderDetail && (
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

              {routeOrderId && orderDetail && (
                  <OrderEditorShell
                    order={orderDetail}
                    orderId={selectedOrderId}
                    displayId={selectedDisplayId}
                    onBack={leaveEditor}
                    backLabel={
                      searchParams.get("from") === "all"
                        ? "Back to all orders"
                        : "Back to board"
                    }
                    onOrderUpdated={syncOrderAfterSave}
                    onDirtyChange={setEditorDirty}
                    onError={setEditorError}
                    externalError={editorError}
                    noteOnlySending={noteOnlySending}
                    onSendMessage={async ({ subject, body }) => {
                      setNoteOnlySending(true);
                      setEditorError("");
                      try {
                        const result = await adminSendMessages({
                          order_ids: [selectedOrderId],
                          subject,
                          body,
                        });
                        if ((result.failed ?? 0) > 0) {
                          const firstError = Array.isArray(result.results)
                            ? result.results.find(
                                (row) => row.email_status === "failed"
                              )?.email_error
                            : null;
                          throw new Error(firstError || "Message failed to send.");
                        }
                      } catch (err) {
                        setEditorError(err.message || "Message failed to send.");
                        throw err;
                      } finally {
                        setNoteOnlySending(false);
                      }
                    }}
                  />
              )}
            </div>
          ) : loadingOrders && orders.length === 0 ? (
            <LoadingIndicator label="Loading orders…" />
          ) : tab === "orders-all" ? (
            <OrdersAllSection
              orders={orders}
              onOpenOrder={openOrder}
              onBackToBoard={() => router.push("/admin/orders/")}
            />
          ) : (
            <>
              <div className="mb-4">
                <OrderCardSearch onOpenOrder={openOrder} />
              </div>
              <KanbanBoard
                orders={orders}
                onOpenOrder={openOrder}
                onPlaceOrder={handlePlaceOrder}
                onSetPendingKind={handleSetPendingKind}
                onRequestDelete={handleRequestDelete}
                onViewAllOrders={() => router.push("/admin/orders/all/")}
                suppressInspect={Boolean(movePrompt || deleteTargets?.length)}
              />
              <DeleteOrderDialog
                orders={deleteTargets}
                deleting={deletingOrder}
                onCancel={handleCancelDelete}
                onConfirm={handleConfirmDelete}
              />
              {movePrompt ? (
                <OrderSaveChangesDialog
                  open
                  variant="move"
                  displayId={movePrompt.displayId}
                  customerEmail={movePrompt.customerEmail}
                  orderSummary={movePrompt.orderSummary}
                  beforePayload={movePrompt.beforePayload}
                  afterPayload={movePrompt.afterPayload}
                  saving={moveSaving}
                  onCancel={() => {
                    if (!moveSaving) setMovePrompt(null);
                  }}
                  onConfirm={handleMoveConfirm}
                />
              ) : null}
            </>
          )}
        </>
      )}
      {unsavedChangesDialog}
    </div>
  );
}

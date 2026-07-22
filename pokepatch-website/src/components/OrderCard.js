"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { thumbPath } from "@/lib/imageCompression";
import {
  customerOrderStatusLabel,
  customerCardStatusLabel,
  orderStatusBadgeClass,
  cardStatusBadgeClass,
} from "@/lib/orderStatus";
import {
  cardsWithQuoteHv,
  hasQuoteData,
  unpackQuoteAdjustments,
  unpackQuoteCardHv,
} from "@/lib/servicePricing";
import QuoteReceipt from "@/components/QuoteReceipt";
import MediaLightbox from "@/components/MediaLightbox";
import {
  forgetSignedUrl,
  getCachedSignedUrls,
} from "@/lib/signedUrlCache";

const SIGNED_URL_EXPIRES_IN = 60 * 60 * 24; // 24h — reuse same token for CDN/browser cache
const CARD_PHOTOS_BUCKET = "card-photos";

const LABEL_CLS =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/60";

// card-photos is a private bucket, so we mint short-lived signed URLs. RLS
// ensures a customer can only sign photos that belong to their own orders.
// Prefer .thumb.webp siblings for list UI; fall back to the full object.
// Reuse cached signed URLs (same token) so Smart CDN + browser cache can hit.
async function signPaths(paths, { preferThumb = false } = {}) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  if (!supabase || unique.length === 0) return {};

  const requestPaths = preferThumb ? unique.map((p) => thumbPath(p)) : unique;
  const signedByRequestPath = await getCachedSignedUrls(
    supabase,
    CARD_PHOTOS_BUCKET,
    requestPaths,
    SIGNED_URL_EXPIRES_IN
  );

  const map = {};
  const missingOriginals = [];
  for (let i = 0; i < unique.length; i += 1) {
    const original = unique[i];
    const requestPath = requestPaths[i];
    const url = signedByRequestPath[requestPath];
    if (url) {
      map[original] = url;
    } else if (preferThumb) {
      missingOriginals.push(original);
    }
  }

  if (missingOriginals.length > 0) {
    const fallback = await getCachedSignedUrls(
      supabase,
      CARD_PHOTOS_BUCKET,
      missingOriginals,
      SIGNED_URL_EXPIRES_IN
    );
    Object.assign(map, fallback);
  }

  return map;
}

function contactLabel(type) {
  if (type === "phone") return "Phone";
  if (type === "discord") return "Discord";
  if (type === "instagram") return "Instagram";
  if (type === "email") return "Email";
  return "Contact";
}

function deliveryLabel(method) {
  return method === "local_dropoff"
    ? { text: "Local Drop-Off", sub: "North San Jose" }
    : { text: "Shipping", sub: "Mailed to you" };
}

// Non-customer photos are the ones our team adds, so we badge them.
// "Update" is temporary (unseen team changes); Progress/Final are permanent labels.
function imageBadge(type, { showUpdateBadge = false } = {}) {
  switch (type) {
    case "admin":
      return showUpdateBadge
        ? { label: "Update", cls: "bg-mint text-night" }
        : null;
    case "progress_front":
    case "progress_back":
      return { label: "Progress", cls: "bg-lavender text-night" };
    case "final_front":
    case "final_back":
      return { label: "Final", cls: "bg-blush text-night" };
    default:
      return null;
  }
}

function UpdateChip({ className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-mint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-night ${className}`.trim()}
    >
      Update
    </span>
  );
}

function SectionLabel({ children, showUpdate = false, className = "" }) {
  return (
    <p
      className={`${LABEL_CLS} flex flex-wrap items-center gap-2 ${className}`.trim()}
    >
      <span>{children}</span>
      {showUpdate ? <UpdateChip /> : null}
    </p>
  );
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatUpdateTime(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Latest activity: team updates, status changes, or order creation. */
function latestActivityAt(order) {
  let bestMs = null;
  for (const value of [
    order?.updates_available_at,
    order?.status_changed_at,
    order?.created_at,
  ]) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (Number.isNaN(ms)) continue;
    if (bestMs === null || ms > bestMs) bestMs = ms;
  }
  return bestMs === null ? null : new Date(bestMs).toISOString();
}

function Chevron({ open }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
        open ? "rotate-180" : ""
      }`}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Photo({ url, alt, badge, onOpen, onThumbError }) {
  const [src, setSrc] = useState(url);
  const [failedThumb, setFailedThumb] = useState(false);

  useEffect(() => {
    setSrc(url);
    setFailedThumb(false);
  }, [url]);

  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-lg border border-ink/10 bg-night/40">
      {src ? (
        <button
          type="button"
          onClick={onOpen}
          disabled={!onOpen}
          className="block h-full w-full cursor-zoom-in disabled:cursor-default"
          aria-label={`Enlarge ${alt}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => {
              if (failedThumb || !onThumbError) return;
              setFailedThumb(true);
              onThumbError().then((fullUrl) => {
                if (fullUrl) setSrc(fullUrl);
              });
            }}
          />
        </button>
      ) : (
        <div className="h-full w-full animate-pulse bg-ink/5" />
      )}
      {badge && (
        <span
          className={`pointer-events-none absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-bold shadow-sm ${badge.cls}`}
        >
          {badge.label}
        </span>
      )}
    </div>
  );
}

function formatMessageTime(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(value);
  }
}

function previewMessageBody(body, maxLen = 120) {
  const text = String(body ?? "")
    .replace(/^Regarding Order #\d+\s*/i, "")
    .trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trim()}…`;
}

export default function OrderCard({ order, onClick, isExpanded = false }) {
  const [orderDetails, setOrderDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedCardId, setExpandedCardId] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { cardId, index }
  const [previewUrls, setPreviewUrls] = useState({});
  // Grid / card chips: thumbs only. Full URLs load on lightbox open and are cached.
  const [thumbUrls, setThumbUrls] = useState({});
  const [fullUrls, setFullUrls] = useState({});
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [expandedMessageId, setExpandedMessageId] = useState(null);
  const [highlightedMessageIds, setHighlightedMessageIds] = useState(
    () => new Set()
  );

  const previewPaths = Array.isArray(order.preview_paths)
    ? order.preview_paths
    : [];
  const previewPathsKey = previewPaths.join(",");

  useEffect(() => {
    if (isExpanded && !orderDetails && supabase) {
      setLoading(true);
      supabase
        .rpc("get_my_order", { p_order_id: order.id })
        .then(({ data, error }) => {
          if (error) throw error;
          setOrderDetails(data);
        })
        .catch((err) => {
          setError(err.message || "Failed to load order details");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isExpanded, order.id, orderDetails]);

  useEffect(() => {
    if (!isExpanded || !supabase) return undefined;

    let cancelled = false;
    setMessagesLoading(true);

    supabase
      .from("customer_messages")
      .select("id, subject, body, sent_at, read_at")
      .eq("order_id", order.id)
      .order("sent_at", { ascending: false })
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) {
          console.error("Failed to load order messages", loadError);
          setMessages([]);
          return;
        }
        setMessages(data ?? []);
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isExpanded, order.id]);

  useEffect(() => {
    if (!isExpanded) {
      setUpdatesOpen(false);
      setExpandedMessageId(null);
      setHighlightedMessageIds(new Set());
      setLightbox(null);
    }
  }, [isExpanded]);

  useEffect(() => {
    setLightbox(null);
  }, [expandedCardId]);

  useEffect(() => {
    let active = true;
    // List strip: one thumb only.
    const paths = previewPaths.slice(0, 1);
    signPaths(paths, { preferThumb: true }).then((map) => {
      if (active) setPreviewUrls(map);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewPathsKey]);

  useEffect(() => {
    if (!orderDetails) return undefined;
    let active = true;
    const paths = (orderDetails.cards || []).flatMap((card) =>
      (card.images || []).map((image) => image.storage_path)
    );
    // Expanded grids / card chips: thumbs only (fallback to full if sibling missing).
    signPaths(paths, { preferThumb: true }).then((map) => {
      if (active) setThumbUrls(map);
    });
    return () => {
      active = false;
    };
  }, [orderDetails]);

  // Full-size URLs only when lightbox opens; cache across navigations.
  useEffect(() => {
    if (!lightbox || !orderDetails) return undefined;
    const card = (orderDetails.cards || []).find(
      (row) => row.id === lightbox.cardId
    );
    const path = card?.images?.[lightbox.index]?.storage_path;
    if (!path) return undefined;
    let active = true;
    signPaths([path], { preferThumb: false }).then((map) => {
      if (!active || !map[path]) return;
      setFullUrls((prev) => (prev[path] ? prev : { ...prev, ...map }));
    });
    return () => {
      active = false;
    };
  }, [lightbox, orderDetails]);

  async function resolveFullAfterBadThumb(storagePath) {
    if (!storagePath) return null;
    if (fullUrls[storagePath]) return fullUrls[storagePath];
    // Drop phantom thumb URL so we don't keep serving a 404 token.
    forgetSignedUrl(CARD_PHOTOS_BUCKET, thumbPath(storagePath));
    const map = await signPaths([storagePath], { preferThumb: false });
    const full = map[storagePath] ?? null;
    if (full) {
      setFullUrls((prev) =>
        prev[storagePath] ? prev : { ...prev, [storagePath]: full }
      );
      setThumbUrls((prev) => ({ ...prev, [storagePath]: full }));
    }
    return full;
  }

  const cardCountText =
    order.card_count === 1 ? "1 card" : `${order.card_count} cards`;
  const hasUpdates = order.has_new_updates ?? order.has_admin_photos;
  const hasUnreadMessages = messages.some((row) => !row.read_at);
  const lastUpdatedAt = latestActivityAt(order);
  const lastUpdatedLabel = formatUpdateTime(lastUpdatedAt);
  const isFirstActivityOnly =
    Boolean(order.created_at) &&
    lastUpdatedAt &&
    new Date(lastUpdatedAt).getTime() === new Date(order.created_at).getTime();
  const activityChipLabel = isFirstActivityOnly ? "Placed" : "Updated";
  const delivery = orderDetails
    ? deliveryLabel(orderDetails.delivery_method)
    : null;
  const quoteAdjustments = orderDetails
    ? unpackQuoteAdjustments(orderDetails.quote_bulk_counts, {
        overrideLabel: orderDetails.quote_override_label ?? "",
        overrideAmount: orderDetails.quote_override_amount,
      })
    : [];
  const quoteCards = orderDetails
    ? cardsWithQuoteHv(
        orderDetails.cards,
        unpackQuoteCardHv(orderDetails.quote_bulk_counts)
      )
    : [];

  const lightboxCard =
    lightbox && orderDetails
      ? (orderDetails.cards || []).find((card) => card.id === lightbox.cardId)
      : null;
  const lightboxImages = lightboxCard?.images || [];
  const lightboxImage = lightboxImages[lightbox?.index] ?? null;
  const lightboxPath = lightboxImage?.storage_path ?? null;
  const lightboxUrl = lightboxPath
    ? fullUrls[lightboxPath] || thumbUrls[lightboxPath] || null
    : null;
  const lightboxBadge = lightboxImage
    ? imageBadge(lightboxImage.image_type, { showUpdateBadge: hasUpdates })
    : null;
  const lightboxMedia =
    lightboxUrl && lightboxImage
      ? {
          type: "image",
          src: lightboxUrl,
          alt: `${lightboxCard.card_name} - ${lightboxImage.image_type}`,
          label:
            lightboxBadge?.label ||
            lightboxImage.image_type?.replaceAll("_", " ") ||
            "Photo",
          sectionTitle: lightboxCard.card_name,
        }
      : null;

  async function handleOpenUpdates() {
    const nextOpen = !updatesOpen;
    setUpdatesOpen(nextOpen);
    if (!nextOpen) {
      setHighlightedMessageIds(new Set());
      setExpandedMessageId(null);
      return;
    }
    if (!supabase) return;

    const unreadIds = messages
      .filter((row) => !row.read_at)
      .map((row) => row.id);
    setHighlightedMessageIds(new Set(unreadIds));
    if (unreadIds.length === 0) return;

    try {
      const { error: markError } = await supabase.rpc("mark_my_messages_read", {
        p_ids: unreadIds,
      });
      if (markError) throw markError;
      const now = new Date().toISOString();
      setMessages((prev) =>
        prev.map((row) =>
          unreadIds.includes(row.id) ? { ...row, read_at: now } : row
        )
      );
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("pokepatch:messages-read"));
      }
    } catch (err) {
      console.error("mark_my_messages_read failed", err);
    }
  }

  return (
    <div
      className={`overflow-hidden rounded-2xl border-2 bg-cream/70 shadow-cozy-sm transition-colors duration-200 ${
        isExpanded ? "border-blush/40" : "border-ink/10"
      }`}
    >
      {/* Header */}
      <button
        onClick={onClick}
        className="flex w-full items-center gap-4 p-4 text-left transition-colors duration-150 hover:bg-ink/[0.04]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold tabular-nums leading-none text-ink">
              Order #{order.display_id}
            </h3>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${orderStatusBadgeClass(
                order.status
              )}`}
            >
              {order.queue_position != null
                ? `#${order.queue_position} in queue`
                : customerOrderStatusLabel(order.status)}
            </span>
            {lastUpdatedLabel ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  hasUpdates
                    ? "bg-mint text-night"
                    : "bg-night/30 text-ink/70"
                }`}
              >
                {hasUpdates ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-night/70" />
                ) : null}
                {hasUpdates ? "New update" : activityChipLabel}
                <span
                  className={
                    hasUpdates ? "font-semibold text-night/70" : "font-semibold"
                  }
                >
                  · {lastUpdatedLabel}
                </span>
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink/55">
            <span className="rounded-full bg-night/30 px-2 py-0.5">
              {formatDate(order.created_at)}
            </span>
            <span className="rounded-full bg-night/30 px-2 py-0.5">
              {cardCountText}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-ink/10 bg-night/40 p-1">
          {previewPaths.length === 0 ? (
            <div className="aspect-[3/4] w-9 rounded-md bg-night/50" />
          ) : (
            (() => {
              const path = previewPaths[0];
              const url = previewUrls[path];
              return (
                <div className="relative aspect-[3/4] w-9 shrink-0 overflow-hidden rounded-md bg-night/50">
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={`Order #${order.display_id} preview`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                      onError={() => {
                        resolveFullAfterBadThumb(path).then((full) => {
                          if (full) {
                            setPreviewUrls((prev) => ({
                              ...prev,
                              [path]: full,
                            }));
                          }
                        });
                      }}
                    />
                  ) : (
                    <div className="h-full w-full animate-pulse bg-ink/5" />
                  )}
                </div>
              );
            })()
          )}
        </div>

        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-night/30 text-ink/60">
          <Chevron open={isExpanded} />
        </span>
      </button>

      {/* Expanded */}
      {isExpanded && (
        <div className="border-t border-ink/10 p-4">
          {(!messagesLoading && messages.length > 0) ||
          orderDetails?.general_notes ? (
            <div className="mb-5 space-y-3">
              {!messagesLoading && messages.length > 0 ? (
                <div className="rounded-xl border border-mint/30 bg-mint/10">
                  <button
                    type="button"
                    onClick={handleOpenUpdates}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                  >
                    <span>
                      <span className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-mint">
                        <span>Updates from PokePatch</span>
                        {hasUnreadMessages ? <UpdateChip /> : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink/55">
                        {messages.length}{" "}
                        {messages.length === 1 ? "message" : "messages"}
                      </span>
                    </span>
                    <Chevron open={updatesOpen} />
                  </button>
                  {updatesOpen ? (
                    <ul className="space-y-2 border-t border-mint/20 px-3 py-3">
                      {messages.map((message) => {
                        const expanded = expandedMessageId === message.id;
                        const isNew = highlightedMessageIds.has(message.id);
                        return (
                          <li key={message.id}>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedMessageId((current) =>
                                  current === message.id ? null : message.id
                                )
                              }
                              className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                                isNew
                                  ? "border-mint/50 bg-mint/20 ring-1 ring-mint/30"
                                  : "border-mint/20 bg-cream/50 hover:border-mint/40"
                              }`}
                            >
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                                  <span>{message.subject}</span>
                                  {isNew ? <UpdateChip /> : null}
                                </p>
                                <time
                                  dateTime={message.sent_at}
                                  className="text-[11px] text-ink/55"
                                >
                                  {formatMessageTime(message.sent_at)}
                                </time>
                              </div>
                              <p
                                className={`mt-1 text-sm text-ink/80 ${
                                  expanded
                                    ? "whitespace-pre-wrap"
                                    : "line-clamp-2"
                                }`}
                              >
                                {expanded
                                  ? message.body
                                  : previewMessageBody(message.body)}
                              </p>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {orderDetails?.general_notes ? (
                <div className="rounded-xl border border-mint/30 bg-mint/10 p-3">
                  <p className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-mint">
                    <span>Notes from PokePatch</span>
                    {hasUpdates ? <UpdateChip /> : null}
                  </p>
                  <p className="mt-1 text-sm text-ink/85">
                    {orderDetails.general_notes}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-ink/60">
              <span className="h-2 w-2 animate-pulse rounded-full bg-blush" />
              Loading order details…
            </div>
          )}

          {error && (
            <p className="rounded-xl border-2 border-error bg-error/15 px-4 py-3 text-sm font-semibold text-ink">
              {error}
            </p>
          )}

          {orderDetails && (
            <div className="space-y-5">
              {/* Summary tiles */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-ink/10 bg-night/25 p-3">
                  <p className={LABEL_CLS}>Delivery</p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {delivery.text}
                  </p>
                  <p className="text-xs text-ink/55">
                    {delivery.sub}
                  </p>
                </div>

                <div className="rounded-xl border border-ink/10 bg-night/25 p-3">
                  <p className={LABEL_CLS}>Preferred contact</p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {orderDetails.preferred_contact_type
                      ? `${contactLabel(orderDetails.preferred_contact_type)} · ${
                          orderDetails.preferred_contact_value
                        }`
                      : "—"}
                  </p>
                  {orderDetails.contacts?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {orderDetails.contacts.map((contact) => (
                        <span
                          key={contact.id}
                          className="inline-flex items-center gap-1 rounded-full bg-night/40 px-2 py-0.5 text-xs text-ink/70"
                        >
                          {contactLabel(contact.contact_type)} · {contact.value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Google Drive folder from the team */}
              {orderDetails.photos_drive_url && (
                <div className="rounded-xl border border-ink/10 bg-night/25 p-3">
                  <SectionLabel showUpdate={hasUpdates}>
                    Photo folder
                  </SectionLabel>
                  <a
                    href={orderDetails.photos_drive_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-ink transition hover:underline"
                  >
                    Open Google Drive
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                      aria-hidden="true"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </div>
              )}

              {/* Quote from the team */}
              {hasQuoteData({
                items: orderDetails.quote_items,
                cards: quoteCards,
                adjustments: quoteAdjustments,
              }) ? (
                <QuoteReceipt
                  title={
                    <span className="inline-flex flex-wrap items-center gap-2">
                      Your quote
                      {hasUpdates ? <UpdateChip /> : null}
                    </span>
                  }
                  items={orderDetails.quote_items}
                  cards={quoteCards}
                  adjustments={quoteAdjustments}
                  className="border-peach/30 bg-peach/10"
                  collapsible
                  defaultOpen={false}
                />
              ) : null}

              {/* Cards */}
              <div>
                <SectionLabel
                  showUpdate={hasUpdates}
                  className="mb-2"
                >
                  {`Cards · ${orderDetails.cards.length}`}
                </SectionLabel>
                <div className="space-y-2">
                  {orderDetails.cards.map((card) => {
                    const isCardOpen = expandedCardId === card.id;
                    const cardThumbUrl =
                      thumbUrls[card.images?.[0]?.storage_path];
                    const photoCount = card.images?.length || 0;
                    return (
                      <div
                        key={card.id}
                        className={`overflow-hidden rounded-xl border transition-colors duration-200 ${
                          isCardOpen
                            ? "border-blush/30 bg-night/35"
                            : "border-ink/10 bg-night/20"
                        }`}
                      >
                        <button
                          onClick={() =>
                            setExpandedCardId((prev) =>
                              prev === card.id ? null : card.id
                            )
                          }
                          className="flex w-full items-center gap-3 p-2.5 text-left transition-colors duration-150 hover:bg-ink/[0.04]"
                        >
                          <div className="relative aspect-[3/4] w-12 shrink-0 overflow-hidden rounded-lg border border-ink/10 bg-night/50">
                            {cardThumbUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={cardThumbUrl}
                                alt={`${card.card_name} preview`}
                                className="h-full w-full object-cover"
                                onError={() => {
                                  const path = card.images?.[0]?.storage_path;
                                  if (path) resolveFullAfterBadThumb(path);
                                }}
                              />
                            ) : (
                              <div className="h-full w-full animate-pulse bg-ink/5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <h5 className="truncate text-sm font-bold text-ink">
                                {card.card_name}
                              </h5>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cardStatusBadgeClass(
                                  card.status
                                )}`}
                              >
                                {customerCardStatusLabel(card.status)}
                              </span>
                            </div>
                            {card.set_name && (
                              <p className="truncate text-xs text-ink/60">
                                {card.set_name}
                              </p>
                            )}
                            <p className="mt-0.5 text-[11px] text-ink/60">
                              {photoCount} {photoCount === 1 ? "photo" : "photos"}
                            </p>
                          </div>
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-night/40 text-ink/60">
                            <Chevron open={isCardOpen} />
                          </span>
                        </button>

                        {isCardOpen && (
                          <div className="flex flex-col gap-4 border-t border-ink/10 p-3 sm:flex-row">
                            <div className="min-w-0 flex-1 space-y-2">
                              <div>
                                <p className={LABEL_CLS}>Description</p>
                                {card.description ? (
                                  <p className="mt-1 text-sm text-ink/80">
                                    {card.description}
                                  </p>
                                ) : (
                                  <p className="mt-1 text-sm italic text-ink/60">
                                    No description provided.
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="sm:w-1/2 sm:shrink-0">
                              <p className={`${LABEL_CLS} mb-2`}>
                                Photos · {photoCount}
                              </p>
                              <div className="grid grid-cols-3 gap-2">
                                {card.images.map((image, imageIndex) => (
                                  <Photo
                                    key={image.id}
                                    url={thumbUrls[image.storage_path]}
                                    alt={`${card.card_name} - ${image.image_type}`}
                                    badge={imageBadge(image.image_type, {
                                      showUpdateBadge: hasUpdates,
                                    })}
                                    onOpen={
                                      thumbUrls[image.storage_path]
                                        ? () =>
                                            setLightbox({
                                              cardId: card.id,
                                              index: imageIndex,
                                            })
                                        : undefined
                                    }
                                    onThumbError={() =>
                                      resolveFullAfterBadThumb(
                                        image.storage_path
                                      )
                                    }
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {lightboxMedia ? (
        <MediaLightbox
          media={lightboxMedia}
          onClose={() => setLightbox(null)}
          onPrevious={() =>
            setLightbox((current) =>
              !current || current.index <= 0
                ? current
                : { ...current, index: current.index - 1 }
            )
          }
          onNext={() =>
            setLightbox((current) => {
              if (!current) return current;
              const card = (orderDetails?.cards || []).find(
                (row) => row.id === current.cardId
              );
              const count = card?.images?.length ?? 0;
              return current.index >= count - 1
                ? current
                : { ...current, index: current.index + 1 };
            })
          }
          hasPrevious={Boolean(lightbox && lightbox.index > 0)}
          hasNext={Boolean(
            lightbox && lightbox.index < lightboxImages.length - 1
          )}
          position={(lightbox?.index ?? 0) + 1}
          total={lightboxImages.length}
        />
      ) : null}
    </div>
  );
}

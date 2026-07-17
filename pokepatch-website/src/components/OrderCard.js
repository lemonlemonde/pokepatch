"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

const SIGNED_URL_EXPIRES_IN = 60 * 60; // 1 hour

const LABEL_CLS =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/45";

// card-photos is a private bucket, so we mint short-lived signed URLs. RLS
// ensures a customer can only sign photos that belong to their own orders.
async function signPaths(paths) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  if (!supabase || unique.length === 0) return {};
  const { data, error } = await supabase.storage
    .from("card-photos")
    .createSignedUrls(unique, SIGNED_URL_EXPIRES_IN);
  if (error || !data) return {};
  const map = {};
  for (const item of data) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
  }
  return map;
}

function contactIcon(type) {
  if (type === "phone") return "📞";
  if (type === "discord") return "💬";
  if (type === "instagram") return "📸";
  if (type === "email") return "✉️";
  return "📷";
}

function deliveryLabel(method) {
  return method === "local_dropoff"
    ? { icon: "📍", text: "Local Drop-Off", sub: "North San Jose" }
    : { icon: "📦", text: "Shipping", sub: "Mailed to you" };
}

// Non-customer photos are the ones our team adds, so we badge them.
function imageBadge(type) {
  switch (type) {
    case "admin":
      return { label: "Update", cls: "bg-mint text-night" };
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

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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

function Photo({ url, alt, badge }) {
  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-lg border border-ink/10 bg-night/40">
      {url ? (
        <img src={url} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full animate-pulse bg-ink/5" />
      )}
      {badge && (
        <span
          className={`absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-bold shadow-sm ${badge.cls}`}
        >
          {badge.label}
        </span>
      )}
    </div>
  );
}

export default function OrderCard({ order, onClick, isExpanded = false }) {
  const [orderDetails, setOrderDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedCardId, setExpandedCardId] = useState(null);
  const [previewUrls, setPreviewUrls] = useState({});
  const [imageUrls, setImageUrls] = useState({});

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
    let active = true;
    signPaths(previewPaths).then((map) => {
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
    signPaths(paths).then((map) => {
      if (active) setImageUrls(map);
    });
    return () => {
      active = false;
    };
  }, [orderDetails]);

  const cardCountText =
    order.card_count === 1 ? "1 card" : `${order.card_count} cards`;
  const hasUpdates = order.has_admin_photos;
  const imageCount = order.image_count ?? previewPaths.length;
  const hasMore = imageCount > 4;

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
            <h3 className="font-display text-lg font-bold leading-none text-ink">
              Order #{order.display_id}
            </h3>
            {hasUpdates && (
              <span className="inline-flex items-center gap-1 rounded-full bg-mint px-2 py-0.5 text-[11px] font-bold text-night">
                <span className="h-1.5 w-1.5 rounded-full bg-night/70" />
                New updates
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink/55">
            <span className="inline-flex items-center gap-1 rounded-full bg-night/30 px-2 py-0.5">
              🗓 {formatDate(order.created_at)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-night/30 px-2 py-0.5">
              🃏 {cardCountText}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-ink/10 bg-night/40 p-1">
          {previewPaths.length === 0 ? (
            <div className="flex aspect-[3/4] w-9 items-center justify-center text-base text-ink/30">
              🃏
            </div>
          ) : (
            previewPaths.slice(0, 4).map((path, index) => {
              const url = previewUrls[path];
              const showMore = hasMore && index === 3;
              return (
                <div
                  key={path || index}
                  className="relative aspect-[3/4] w-9 shrink-0 overflow-hidden rounded-md bg-night/50"
                >
                  {url ? (
                    <img
                      src={url}
                      alt={`Order #${order.display_id} card ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full animate-pulse bg-ink/5" />
                  )}
                  {showMore && (
                    <div className="absolute inset-0 flex items-center justify-center bg-night/70 text-sm font-bold text-cream backdrop-blur-[1px]">
                      …
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-night/30 text-ink/60">
          <Chevron open={isExpanded} />
        </span>
      </button>

      {/* Expanded */}
      {isExpanded && (
        <div className="border-t border-ink/10 p-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 font-secondary text-sm text-ink/60">
              <span className="h-2 w-2 animate-pulse rounded-full bg-blush" />
              Loading order details…
            </div>
          )}

          {error && (
            <p className="rounded-xl border-2 border-berry bg-berry/20 px-4 py-3 text-sm font-semibold text-ink">
              {error}
            </p>
          )}

          {orderDetails && (
            <div className="space-y-5">
              {/* Summary tiles */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-ink/10 bg-night/25 p-3">
                  <p className={LABEL_CLS}>Delivery</p>
                  <p className="mt-1 font-secondary text-sm font-semibold text-ink">
                    {deliveryLabel(orderDetails.delivery_method).icon}{" "}
                    {deliveryLabel(orderDetails.delivery_method).text}
                  </p>
                  <p className="font-secondary text-xs text-ink/55">
                    {deliveryLabel(orderDetails.delivery_method).sub}
                  </p>
                </div>

                <div className="rounded-xl border border-ink/10 bg-night/25 p-3">
                  <p className={LABEL_CLS}>Preferred contact</p>
                  <p className="mt-1 font-secondary text-sm font-semibold text-ink">
                    {orderDetails.preferred_contact_type
                      ? `${contactIcon(orderDetails.preferred_contact_type)} ${
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
                          {contactIcon(contact.contact_type)} {contact.value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Notes from the team */}
              {orderDetails.general_notes && (
                <div className="rounded-xl border border-mint/30 bg-mint/10 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mint">
                    Notes from our team
                  </p>
                  <p className="mt-1 font-secondary text-sm text-ink/85">
                    {orderDetails.general_notes}
                  </p>
                </div>
              )}

              {/* Cards */}
              <div>
                <p className={`${LABEL_CLS} mb-2`}>
                  Cards · {orderDetails.cards.length}
                </p>
                <div className="space-y-2">
                  {orderDetails.cards.map((card) => {
                    const isCardOpen = expandedCardId === card.id;
                    const cardThumbUrl =
                      imageUrls[card.images?.[0]?.storage_path];
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
                              <img
                                src={cardThumbUrl}
                                alt={`${card.card_name} preview`}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="h-full w-full animate-pulse bg-ink/5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h5 className="truncate font-secondary text-sm font-bold text-ink">
                              {card.card_name}
                            </h5>
                            {card.set_name && (
                              <p className="truncate font-secondary text-xs text-ink/60">
                                {card.set_name}
                              </p>
                            )}
                            <p className="mt-0.5 text-[11px] text-ink/45">
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
                              <p className={LABEL_CLS}>Description</p>
                              {card.description ? (
                                <p className="font-secondary text-sm text-ink/80">
                                  {card.description}
                                </p>
                              ) : (
                                <p className="font-secondary text-sm italic text-ink/45">
                                  No description provided.
                                </p>
                              )}
                            </div>

                            <div className="sm:w-1/2 sm:shrink-0">
                              <p className={`${LABEL_CLS} mb-2`}>
                                Photos · {photoCount}
                              </p>
                              <div className="grid grid-cols-3 gap-2">
                                {card.images.map((image) => (
                                  <Photo
                                    key={image.id}
                                    url={imageUrls[image.storage_path]}
                                    alt={`${card.card_name} - ${image.image_type}`}
                                    badge={imageBadge(image.image_type)}
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
    </div>
  );
}

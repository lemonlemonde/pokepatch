"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

function getPublicUrl(path) {
  if (!supabase || !path) return null;
  const { data } = supabase.storage.from("card-photos").getPublicUrl(path);
  return data?.publicUrl || null;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function OrderCard({ order, onClick, isExpanded = false }) {
  const [orderDetails, setOrderDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  const cardCountText = order.card_count === 1 ? "1 card" : `${order.card_count} cards`;
  const hasUpdates = order.has_admin_photos;

  return (
    <div className="space-y-4 rounded-2xl border-2 border-ink/10 bg-cream/80 p-4">
      <button
        onClick={onClick}
        className="w-full text-left transition-colors hover:text-blush"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-ink">
                Order #{order.display_id}
              </h3>
              {hasUpdates && (
                <span className="rounded-full bg-mint px-2 py-0.5 text-xs font-semibold text-ink">
                  Updates available
                </span>
              )}
            </div>
            <p className="font-secondary text-sm text-ink/70">
              {formatDate(order.created_at)} • {cardCountText}
            </p>
            <p className="mt-1 font-secondary text-sm font-semibold text-ink">
              {order.customer_name}
            </p>
          </div>
          <div className="flex-shrink-0 text-xl text-ink/50">
            {isExpanded ? "−" : "+"}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-4 border-t border-ink/10 pt-4">
          {loading && (
            <p className="text-center font-secondary text-sm text-ink/70">
              Loading order details...
            </p>
          )}

          {error && (
            <p className="rounded-xl border-2 border-berry bg-berry/20 px-4 py-3 text-sm font-semibold text-ink">
              {error}
            </p>
          )}

          {orderDetails && (
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 text-sm font-bold text-ink">Delivery Method</h4>
                <p className="font-secondary text-sm text-ink/80">
                  {orderDetails.delivery_method === "local_dropoff"
                    ? "📍 Local Drop-Off (North San Jose)"
                    : "📦 Shipping"}
                </p>
              </div>

              {orderDetails.general_notes && (
                <div>
                  <h4 className="mb-2 text-sm font-bold text-ink">Admin Notes</h4>
                  <p className="rounded-xl bg-cream/60 px-4 py-3 font-secondary text-sm text-ink/80">
                    {orderDetails.general_notes}
                  </p>
                </div>
              )}

              <div>
                <h4 className="mb-2 text-sm font-bold text-ink">Contact Methods</h4>
                <div className="space-y-1">
                  {orderDetails.contacts.map((contact) => (
                    <p key={contact.id} className="font-secondary text-sm text-ink/80">
                      {contact.contact_type === "phone"
                        ? "📞"
                        : contact.contact_type === "discord"
                          ? "💬"
                          : "📷"}{" "}
                      {contact.value}
                    </p>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="mb-3 text-sm font-bold text-ink">Cards</h4>
                <div className="space-y-4">
                  {orderDetails.cards.map((card) => (
                    <div
                      key={card.id}
                      className="space-y-3 rounded-xl bg-cream/60 p-4"
                    >
                      <div>
                        <h5 className="font-bold text-ink">{card.card_name}</h5>
                        {card.set_name && (
                          <p className="font-secondary text-sm text-ink/70">
                            {card.set_name}
                          </p>
                        )}
                      </div>

                      {card.description && (
                        <div>
                          <p className="mb-1 font-secondary text-xs font-semibold text-ink/70">
                            Description
                          </p>
                          <p className="font-secondary text-sm text-ink/80">
                            {card.description}
                          </p>
                        </div>
                      )}

                      <div>
                        <p className="mb-2 font-secondary text-xs font-semibold text-ink/70">
                          Photos
                        </p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {card.images.map((image) => {
                            const url = getPublicUrl(image.storage_path);
                            return (
                              <div
                                key={image.id}
                                className="relative aspect-[3/4] overflow-hidden rounded-lg bg-cream"
                              >
                                {url ? (
                                  <>
                                    <img
                                      src={url}
                                      alt={`${card.card_name} - ${image.image_type}`}
                                      className="h-full w-full object-cover"
                                    />
                                    {image.image_type === "admin" && (
                                      <span className="absolute right-1 top-1 rounded bg-mint px-2 py-0.5 text-xs font-semibold text-ink shadow-sm">
                                        Update
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-xs text-ink/50">
                                    No preview
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

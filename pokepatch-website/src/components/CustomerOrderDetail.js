"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CustomerOrderEditor from "@/components/CustomerOrderEditor";
import CustomerOrderContract from "@/components/CustomerOrderContract";
import CustomerOrderMessages from "@/components/CustomerOrderMessages";
import CustomerPriorityBadge from "@/components/CustomerPriorityBadge";
import MediaLightbox from "@/components/MediaLightbox";
import QuoteReceipt from "@/components/QuoteReceipt";
import RestorationDownloadButton from "@/components/RestorationDownloadButton";
import {
  resolveFullAfterBadThumb,
  signPaths,
} from "@/lib/customerOrderMedia";
import { groupCardImages } from "@/lib/cardPhotoGroups";
import { labeledDamageTags } from "@/lib/gallery";
import {
  billableQuoteCards,
  hasPriorityAdjustment,
  hasQuoteData,
  quoteCardsFromStoredOrder,
  unpackQuoteAdjustments,
} from "@/lib/servicePricing";
import {
  cardStatusBadgeClass,
  customerCardStatusLabel,
  customerOrderStatusChipLabel,
  DEFAULT_PENDING_KIND,
  isPendingOrderStatus,
  normalizeOrderStatus,
  normalizePendingKind,
  orderStatusBadgeClass,
} from "@/lib/orderStatus";

const LABEL_CLS =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/60";

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

/** Only quote photos render inline; before/after ship as a zip download. */
function customerImages(card) {
  return groupCardImages(card?.images).customer;
}

function lightboxTarget(order, lightbox) {
  if (!lightbox) return null;
  const card = (order.cards ?? []).find((row) => row.id === lightbox.cardId);
  if (!card) return null;
  const list = customerImages(card);
  return { card, list, image: list[lightbox.index] ?? null };
}

const RESTORATION_STATUSES = new Set(["in_progress", "ready", "completed"]);

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Photo({ url, alt, onOpen, onThumbError }) {
  const [failedThumb, setFailedThumb] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState(null);
  const src = failedThumb ? fallbackUrl : url;

  return (
    <div className="group relative aspect-[3/4] overflow-hidden rounded-lg bg-night/40 ring-1 ring-ink/10">
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
            key={url || "empty"}
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition duration-200 group-hover:scale-105"
            onError={() => {
              if (failedThumb || !onThumbError) return;
              setFailedThumb(true);
              onThumbError().then((fullUrl) => {
                if (fullUrl) setFallbackUrl(fullUrl);
              });
            }}
          />
          <span className="pointer-events-none absolute inset-0 bg-night/0 transition group-hover:bg-night/20" />
        </button>
      ) : (
        <div className="h-full w-full animate-pulse bg-ink/5" />
      )}
    </div>
  );
}

/** Counts + zip download; photos themselves are not rendered inline. */
function RestorationSection({
  orderDisplayId,
  cardIndex,
  cardName,
  groups,
  expectPhotos,
}) {
  const before = groups.before;
  const after = groups.after;
  const total = before.length + after.length;

  if (total === 0 && !expectPhotos) return null;

  return (
    <section className="rounded-xl border border-lavender/20 bg-lavender/[0.05] px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className={`${LABEL_CLS} text-lavender`}>Restoration photos</p>
          {total > 0 ? (
            <p className="mt-1 text-sm text-ink/80">
              <span className="font-semibold text-ink">{before.length}</span>{" "}
              before
              <span className="mx-1.5 text-ink/30">·</span>
              <span className="font-semibold text-ink">{after.length}</span>{" "}
              after
              <span className="ml-2 text-xs text-ink/45">
                Zip with a <code className="text-ink/60">before/</code> and{" "}
                <code className="text-ink/60">after/</code> folder.
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink/55">
              Before photos are added when we start on this card; after photos
              once restoration is done.
            </p>
          )}
        </div>
        {total > 0 ? (
          <RestorationDownloadButton
            orderDisplayId={orderDisplayId}
            cardIndex={cardIndex}
            cardName={cardName}
            before={before}
            after={after}
          />
        ) : null}
      </div>
    </section>
  );
}

function ReadOnlyCards({
  order,
  thumbUrls,
  fullUrls,
  setFullUrls,
  setThumbUrls,
  lightbox,
  setLightbox,
}) {
  const target = lightboxTarget(order, lightbox);
  const lightboxPath = target?.image?.storage_path;
  const lightboxMedia = lightboxPath
    ? {
        type: "image",
        src: fullUrls[lightboxPath] ?? thumbUrls[lightboxPath] ?? null,
        alt: `${target.card.card_name || "Card"} photo ${lightbox.index + 1}`,
        sectionTitle: target.card.card_name || "Card",
        label: "Your photos",
      }
    : null;
  const lightboxCount = target?.list.length ?? 0;
  const expectPhotos = RESTORATION_STATUSES.has(
    normalizeOrderStatus(order.status)
  );

  return (
    <div className="space-y-4">
      {(order.cards ?? []).map((card, index) => {
        const damage = labeledDamageTags(card.damage_tags);
        const groups = groupCardImages(card.images);
        const cardName = card.card_name || `Card ${index + 1}`;
        const openLightbox = (imageIndex) =>
          setLightbox({ cardId: card.id, index: imageIndex });
        return (
          <article
            key={card.id}
            className="overflow-hidden rounded-xl border border-ink/10 bg-night/25"
          >
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-ink/10 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-ink">
                  {card.card_name || `Card ${index + 1}`}
                </p>
                {card.set_name ? (
                  <p className="text-xs text-ink/55">{card.set_name}</p>
                ) : null}
              </div>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cardStatusBadgeClass(
                  card.status
                )}`}
              >
                {customerCardStatusLabel(card.status)}
              </span>
            </div>

            <div className="space-y-3 px-4 py-3">
              {damage.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {damage.map((tag) => (
                    <span
                      key={tag.id}
                      className="rounded-full bg-night/40 px-2 py-0.5 text-[11px] font-semibold text-ink/70"
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
              ) : null}

              {card.description ? (
                <p className="whitespace-pre-wrap text-sm text-ink/80">
                  {card.description}
                </p>
              ) : null}

              {card.admin_note ? (
                <div className="rounded-lg border border-mint/25 bg-mint/10 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mint">
                    Note from PokePatch
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink/85">
                    {card.admin_note}
                  </p>
                </div>
              ) : null}

              <RestorationSection
                orderDisplayId={order.display_id}
                cardIndex={index + 1}
                cardName={card.card_name}
                groups={groups}
                expectPhotos={expectPhotos && card.status !== "canceled"}
              />

              {groups.customer.length > 0 ? (
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <p className={LABEL_CLS}>Your photos</p>
                    <p className="text-[11px] text-ink/40">
                      Submitted with your quote
                    </p>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                    {groups.customer.map((image, imageIndex) => {
                      const path = image.storage_path;
                      return (
                        <Photo
                          key={image.id ?? path}
                          url={thumbUrls[path] ?? fullUrls[path] ?? null}
                          alt={`${cardName} photo ${imageIndex + 1}`}
                          onOpen={() => openLightbox(imageIndex)}
                          onThumbError={() =>
                            resolveFullAfterBadThumb(
                              path,
                              setFullUrls,
                              setThumbUrls
                            )
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </article>
        );
      })}

      {lightboxMedia?.src ? (
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
              const count = lightboxTarget(order, current)?.list.length ?? 0;
              return current.index >= count - 1
                ? current
                : { ...current, index: current.index + 1 };
            })
          }
          hasPrevious={Boolean(lightbox && lightbox.index > 0)}
          hasNext={Boolean(lightbox && lightbox.index < lightboxCount - 1)}
          position={(lightbox?.index ?? 0) + 1}
          total={lightboxCount}
        />
      ) : null}
    </div>
  );
}

export default function CustomerOrderDetail({ order, onOrderChange }) {
  const [editing, setEditing] = useState(false);
  const [thumbUrls, setThumbUrls] = useState({});
  const [fullUrls, setFullUrls] = useState({});
  const [lightbox, setLightbox] = useState(null);

  const pathsKey = useMemo(
    () =>
      (order.cards ?? [])
        .flatMap((card) =>
          customerImages(card).map((image) => image.storage_path)
        )
        .join("|"),
    [order]
  );

  useEffect(() => {
    let active = true;
    const paths = pathsKey ? pathsKey.split("|").filter(Boolean) : [];
    signPaths(paths, { preferThumb: true }).then((map) => {
      if (active) setThumbUrls(map);
    });
    return () => {
      active = false;
    };
  }, [pathsKey]);

  useEffect(() => {
    if (!lightbox) return undefined;
    const path = lightboxTarget(order, lightbox)?.image?.storage_path;
    if (!path || fullUrls[path]) return undefined;
    let active = true;
    signPaths([path], { preferThumb: false }).then((map) => {
      if (!active || !map[path]) return;
      setFullUrls((prev) => (prev[path] ? prev : { ...prev, ...map }));
    });
    return () => {
      active = false;
    };
  }, [lightbox, order, fullUrls]);

  const canEdit = isPendingOrderStatus(order.status);
  const quoteAdjustments = unpackQuoteAdjustments(order.quote_bulk_counts, {
    overrideLabel: order.quote_override_label ?? "",
    overrideAmount: order.quote_override_amount,
  });
  const quoteCards = quoteCardsFromStoredOrder(order);
  const isPriority =
    Boolean(order.is_priority) || hasPriorityAdjustment(quoteAdjustments);
  const delivery = deliveryLabel(order.delivery_method);
  const showQuote =
    !(
      isPendingOrderStatus(order.status) &&
      normalizePendingKind(order.pending_kind) === DEFAULT_PENDING_KIND
    ) &&
    hasQuoteData({
      items: order.quote_items,
      cards: quoteCards,
      adjustments: quoteAdjustments,
      isPriority,
    });

  function handleSaved(next) {
    setEditing(false);
    onOrderChange?.(next);
  }

  function handleCanceled(next) {
    setEditing(false);
    onOrderChange?.(next);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/my-orders/"
            className="text-sm font-semibold text-ink/60 transition hover:text-ink hover:underline"
          >
            ← All orders
          </Link>
          <h1 className="mt-2 text-2xl font-medium tracking-tight text-ink">
            Order #{order.display_id}
          </h1>
          <p className="mt-1 text-sm text-ink/60">
            Placed {formatDate(order.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] ${orderStatusBadgeClass(
              order.status,
              order.pending_kind
            )}`}
          >
            {customerOrderStatusChipLabel(order, { isPriority })}
          </span>
          {isPriority ? <CustomerPriorityBadge /> : null}
          {order.queue_position != null ? (
            <Link
              href={`/queue/?order=${encodeURIComponent(order.display_id)}`}
              className="inline-flex rounded-full border border-ink/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink/55 transition hover:border-ink/35 hover:text-ink"
            >
              View full queue
            </Link>
          ) : null}
          {canEdit ? (
            <span className="inline-flex rounded-full border border-mint/35 bg-mint/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-mint">
              Editable
            </span>
          ) : (
            <span className="inline-flex rounded-full border border-ink/15 bg-night/20 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink/50">
              View only
            </span>
          )}
        </div>
      </div>

      <CustomerOrderMessages orderId={order.id} />

      <CustomerOrderContract orderId={order.id} />

      {order.general_notes ? (
        <section className="rounded-xl border border-mint/30 bg-mint/10 p-4">
          <p className={`${LABEL_CLS} text-mint`}>Notes from PokePatch</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink/85">
            {order.general_notes}
          </p>
        </section>
      ) : null}

      {showQuote ? (
        <QuoteReceipt
          title="Your quote"
          items={order.quote_items}
          cards={quoteCards}
          adjustments={quoteAdjustments}
          isPriority={isPriority}
          cardCount={billableQuoteCards(quoteCards).length}
          className={
            isPriority ? "border-ink/25 bg-ink/[0.07]" : undefined
          }
        />
      ) : null}

      {canEdit && editing ? (
        <CustomerOrderEditor
          order={order}
          onSaved={handleSaved}
          onCanceled={handleCanceled}
        />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-ink/10 bg-night/25 p-3">
              <p className={LABEL_CLS}>Delivery</p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {delivery.text}
              </p>
              <p className="text-xs text-ink/55">{delivery.sub}</p>
            </div>
            <div className="rounded-xl border border-ink/10 bg-night/25 p-3">
              <p className={LABEL_CLS}>Preferred contact</p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {order.preferred_contact_type
                  ? `${contactLabel(order.preferred_contact_type)} · ${
                      order.preferred_contact_value
                    }`
                  : "—"}
              </p>
              {(order.contacts ?? []).length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {order.contacts.map((contact) => (
                    <span
                      key={contact.id}
                      className="inline-flex items-center gap-1 rounded-full bg-night/40 px-2 py-0.5 text-xs text-ink/70"
                    >
                      {contactLabel(contact.contact_type)} · {contact.value}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          {order.photos_drive_url ? (
            <section className="rounded-xl border border-ink/10 bg-night/25 p-3">
              <p className={LABEL_CLS}>Photo folder</p>
              <a
                href={order.photos_drive_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex text-sm font-semibold text-ink transition hover:underline"
              >
                Open Google Drive
              </a>
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-ink/60">
                Cards · {(order.cards ?? []).length}
              </h2>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-night transition hover:brightness-110"
                >
                  Edit order
                </button>
              ) : null}
            </div>
            <ReadOnlyCards
              order={order}
              thumbUrls={thumbUrls}
              fullUrls={fullUrls}
              setFullUrls={setFullUrls}
              setThumbUrls={setThumbUrls}
              lightbox={lightbox}
              setLightbox={setLightbox}
            />
          </section>
        </>
      )}
    </div>
  );
}

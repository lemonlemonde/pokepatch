"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import CustomerOrderEditor from "@/components/CustomerOrderEditor";
import CustomerOrderContract from "@/components/CustomerOrderContract";
import CustomerOrderMessages from "@/components/CustomerOrderMessages";
import CustomerPriorityBadge from "@/components/CustomerPriorityBadge";
import MediaLightbox from "@/components/MediaLightbox";
import QuoteReceipt from "@/components/QuoteReceipt";
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

const PHOTO_GROUP_LABELS = {
  customer: "Your photos",
  before: "Before",
  after: "After",
};

function lightboxTarget(order, lightbox) {
  if (!lightbox) return null;
  const card = (order.cards ?? []).find((row) => row.id === lightbox.cardId);
  if (!card) return null;
  const list = groupCardImages(card.images)[lightbox.group] ?? [];
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

function CompareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M8 9l-4 3 4 3" />
      <path d="M16 9l4 3-4 3" />
    </svg>
  );
}

/** Drag-to-compare: `before` is clipped on top of `after`. */
function CompareSlider({ beforeUrl, afterUrl, alt, onOpenBefore, onOpenAfter }) {
  const [position, setPosition] = useState(50);
  const frameRef = useRef(null);
  const draggingRef = useRef(false);

  const setFromClientX = useCallback((clientX) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.min(100, Math.max(0, next)));
  }, []);

  function handlePointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setFromClientX(event.clientX);
  }

  function handlePointerMove(event) {
    if (!draggingRef.current) return;
    setFromClientX(event.clientX);
  }

  function endDrag(event) {
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  const pillClass =
    "absolute top-2 z-10 rounded-full bg-night/75 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink backdrop-blur transition hover:bg-night";

  return (
    <figure className="space-y-1.5">
      <div
        ref={frameRef}
        className="relative aspect-[3/4] w-full cursor-ew-resize select-none overflow-hidden rounded-xl bg-night/40 ring-1 ring-ink/10 [touch-action:pan-y]"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {afterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={afterUrl}
            src={afterUrl}
            alt={`${alt} after restoration`}
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 animate-pulse bg-ink/5" />
        )}
        <div
          className="absolute inset-0"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        >
          {beforeUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={beforeUrl}
              src={beforeUrl}
              alt={`${alt} before restoration`}
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
        </div>

        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-ink shadow-[0_0_0_1px_rgba(11,16,32,0.5)]"
          style={{ left: `calc(${position}% - 1px)` }}
        />
        <div
          className="pointer-events-none absolute top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-night shadow-lg ring-2 ring-night/40"
          style={{ left: `${position}%` }}
        >
          <CompareIcon />
        </div>

        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onOpenBefore}
          className={`${pillClass} left-2`}
        >
          Before
        </button>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onOpenAfter}
          className={`${pillClass} right-2`}
        >
          After
        </button>

        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(position)}
          onChange={(event) => setPosition(Number(event.target.value))}
          aria-label={`Compare before and after for ${alt}`}
          className="sr-only"
        />
      </div>
      <figcaption className="text-center text-[11px] text-ink/45">
        Drag to compare
      </figcaption>
    </figure>
  );
}

function PhotoColumn({
  label,
  images,
  cardName,
  group,
  thumbUrls,
  fullUrls,
  setFullUrls,
  setThumbUrls,
  openLightbox,
  placeholder,
  accentClass,
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${accentClass}`} />
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink/70">
          {label}
        </p>
        {images.length > 0 ? (
          <span className="text-[11px] text-ink/40">{images.length}</span>
        ) : null}
      </div>
      {images.length > 0 ? (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {images.map((image, index) => {
            const path = image.storage_path;
            return (
              <Photo
                key={image.id ?? path}
                url={thumbUrls[path] ?? fullUrls[path] ?? null}
                alt={`${cardName} ${label.toLowerCase()} photo ${index + 1}`}
                onOpen={() => openLightbox(group, index)}
                onThumbError={() =>
                  resolveFullAfterBadThumb(path, setFullUrls, setThumbUrls)
                }
              />
            );
          })}
        </div>
      ) : (
        <div className="mt-2 flex min-h-[6.5rem] items-center justify-center rounded-lg border border-dashed border-ink/15 bg-night/20 px-3 text-center text-xs leading-snug text-ink/45">
          {placeholder}
        </div>
      )}
    </div>
  );
}

function RestorationSection({
  card,
  groups,
  expectPhotos,
  thumbUrls,
  fullUrls,
  setFullUrls,
  setThumbUrls,
  openLightbox,
}) {
  const [pairIndex, setPairIndex] = useState(0);
  const before = groups.before;
  const after = groups.after;
  const pairCount = Math.min(before.length, after.length);
  const hasPair = pairCount > 0;
  const activePair = Math.min(pairIndex, Math.max(0, pairCount - 1));

  if (before.length === 0 && after.length === 0 && !expectPhotos) {
    return null;
  }

  const cardName = card.card_name || "Card";
  const columnProps = {
    cardName,
    thumbUrls,
    fullUrls,
    setFullUrls,
    setThumbUrls,
    openLightbox,
  };

  const columns = (
    <div className="grid grid-cols-2 gap-3">
      <PhotoColumn
        {...columnProps}
        label="Before"
        group="before"
        images={before}
        accentClass="bg-lavender"
        placeholder="Before photos are added when we start on this card."
      />
      <PhotoColumn
        {...columnProps}
        label="After"
        group="after"
        images={after}
        accentClass="bg-mint"
        placeholder="After photos are added once restoration is done."
      />
    </div>
  );

  const beforePath = before[activePair]?.storage_path;
  const afterPath = after[activePair]?.storage_path;

  return (
    <section className="rounded-xl border border-lavender/20 bg-lavender/[0.05] p-3 sm:p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className={`${LABEL_CLS} text-lavender`}>Restoration</p>
        {hasPair ? (
          <p className="text-[11px] text-ink/45">
            {pairCount} before &amp; after {pairCount === 1 ? "pair" : "pairs"}
          </p>
        ) : null}
      </div>

      {hasPair ? (
        <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <div className="mx-auto w-full max-w-[16rem] sm:mx-0 sm:max-w-none">
            <CompareSlider
              beforeUrl={thumbUrls[beforePath] ?? fullUrls[beforePath] ?? null}
              afterUrl={thumbUrls[afterPath] ?? fullUrls[afterPath] ?? null}
              alt={cardName}
              onOpenBefore={() => openLightbox("before", activePair)}
              onOpenAfter={() => openLightbox("after", activePair)}
            />
            {pairCount > 1 ? (
              <div className="mt-2 flex justify-center gap-1.5">
                {Array.from({ length: pairCount }).map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setPairIndex(index)}
                    aria-label={`Show pair ${index + 1}`}
                    aria-pressed={index === activePair}
                    className={`h-1.5 rounded-full transition ${
                      index === activePair
                        ? "w-5 bg-ink"
                        : "w-1.5 bg-ink/30 hover:bg-ink/55"
                    }`}
                  />
                ))}
              </div>
            ) : null}
          </div>
          {columns}
        </div>
      ) : (
        <div className="mt-3">{columns}</div>
      )}
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
        alt: `${target.card.card_name || "Card"} ${PHOTO_GROUP_LABELS[lightbox.group].toLowerCase()} ${lightbox.index + 1}`,
        sectionTitle: target.card.card_name || "Card",
        label: PHOTO_GROUP_LABELS[lightbox.group],
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
        const openLightbox = (group, imageIndex) =>
          setLightbox({ cardId: card.id, group, index: imageIndex });
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
                card={card}
                groups={groups}
                expectPhotos={expectPhotos && card.status !== "canceled"}
                thumbUrls={thumbUrls}
                fullUrls={fullUrls}
                setFullUrls={setFullUrls}
                setThumbUrls={setThumbUrls}
                openLightbox={openLightbox}
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
                          onOpen={() => openLightbox("customer", imageIndex)}
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
          (card.images ?? []).map((image) => image.storage_path)
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

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import MediaLightbox from "@/components/MediaLightbox";
import { thumbPath } from "@/lib/imageCompression";
import { forgetSignedUrl } from "@/lib/signedUrlCache";

function CardPhotoTile({ src, alt, label, href, onRemove, removeAriaLabel }) {
  const image = (
    <div className="flex aspect-[3/4] w-full items-center justify-center bg-cream/80 p-1">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <span className="text-xs text-ink/50">Loading...</span>
      )}
    </div>
  );

  return (
    <li className="group relative w-24 shrink-0 overflow-hidden rounded-xl border-2 border-ink/10 bg-cream/80">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          {image}
        </a>
      ) : (
        image
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeAriaLabel ?? `Remove ${label}`}
          className="absolute right-1.5 top-1.5 rounded-full bg-ink/70 px-2 py-0.5 text-xs font-bold text-cream transition-colors duration-150 sm:hover:bg-ink"
        >
          ✕
        </button>
      )}
      {label && (
        <span className="block truncate px-2 py-1 text-xs text-ink">
          {label}
        </span>
      )}
    </li>
  );
}

export function CardPhotoPreviewGrid({
  items,
  onRemove,
  caption,
  title,
  emptyText = "None",
  className = "",
}) {
  if (title && items.length === 0) {
    return (
      <div className={className}>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-1 text-xs text-ink/60">{emptyText}</p>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className={className}>
      {title && (
        <p className="text-sm font-semibold text-ink">{title}</p>
      )}
      {caption && (
        <p
          className={`text-sm text-ink/60 ${title ? "mt-1" : ""}`}
        >
          {caption}
        </p>
      )}
      <ul className="mt-3 flex flex-wrap gap-3">
        {items.map((item) => (
          <CardPhotoTile
            key={item.id}
            src={item.src}
            alt={item.alt}
            label={item.label}
            href={item.href}
            onRemove={onRemove ? () => onRemove(item.id) : undefined}
            removeAriaLabel={item.removeAriaLabel}
          />
        ))}
      </ul>
    </div>
  );
}

/** Matches AdminThumb: w-14 + gap-1.5 between thumbs. */
const ADMIN_THUMB_PX = 56;
const ADMIN_THUMB_GAP_PX = 6;
const ADMIN_MORE_BTN_PX = 56;
const ADMIN_MORE_GAP_PX = 8;
const ADMIN_SECTION_GAP_PX = 16;
const ADMIN_DIVIDER_PX = 1;
const ADMIN_EMPTY_LABEL_PX = 36;
const ADMIN_ROW_PAD_X_PX = 24; // px-3 each side

function thumbsRowWidth(count) {
  if (count <= 0) return 0;
  return count * ADMIN_THUMB_PX + (count - 1) * ADMIN_THUMB_GAP_PX;
}

/** Width of collapsed clusters row for given visible counts (no +more button). */
function collapsedClustersWidth(customerVisible, updateVisible, customerTotal) {
  let width = 0;
  if (customerVisible > 0) {
    width += thumbsRowWidth(customerVisible);
  } else if (customerTotal === 0) {
    width += ADMIN_EMPTY_LABEL_PX;
  }
  if (updateVisible > 0) {
    if (width > 0) {
      width += ADMIN_SECTION_GAP_PX + ADMIN_DIVIDER_PX + ADMIN_SECTION_GAP_PX;
    }
    width += thumbsRowWidth(updateVisible);
  }
  return width;
}

function fitCollapsedVisible(availablePx, customerTotal, updateTotal) {
  const full = collapsedClustersWidth(
    customerTotal,
    updateTotal,
    customerTotal
  );
  if (full <= availablePx) {
    return { customer: customerTotal, update: updateTotal, hidden: 0 };
  }

  const budget = Math.max(
    0,
    availablePx - ADMIN_MORE_BTN_PX - ADMIN_MORE_GAP_PX
  );
  let best = { customer: 0, update: 0, total: -1 };

  for (let c = 0; c <= customerTotal; c += 1) {
    for (let u = 0; u <= updateTotal; u += 1) {
      if (c === 0 && u === 0 && (customerTotal > 0 || updateTotal > 0)) {
        // Keep at least one thumb when possible.
        continue;
      }
      const width = collapsedClustersWidth(c, u, customerTotal);
      if (width > budget) continue;
      const total = c + u;
      const prefersBoth =
        (customerTotal === 0 || c > 0) && (updateTotal === 0 || u > 0);
      const bestPrefersBoth =
        (customerTotal === 0 || best.customer > 0) &&
        (updateTotal === 0 || best.update > 0);
      if (
        total > best.total ||
        (total === best.total && prefersBoth && !bestPrefersBoth)
      ) {
        best = { customer: c, update: u, total };
      }
    }
  }

  if (best.total < 0) {
    // Extremely narrow: show one thumb from the first non-empty group.
    if (customerTotal > 0) {
      return {
        customer: 1,
        update: 0,
        hidden: customerTotal + updateTotal - 1,
      };
    }
    if (updateTotal > 0) {
      return {
        customer: 0,
        update: 1,
        hidden: updateTotal - 1,
      };
    }
  }

  return {
    customer: best.customer,
    update: best.update,
    hidden: customerTotal + updateTotal - best.customer - best.update,
  };
}

function toLightboxMedia(item, sectionTitle) {
  return {
    type: "image",
    // Prefer full-resolution URL for enlarge; thumb is only for the strip.
    src: item.fullSrc || item.href || item.src,
    alt: item.alt || item.label || "",
    label: item.label || item.alt || "",
    sectionTitle,
  };
}

function AdminThumb({
  src,
  fallbackSrc,
  storagePath,
  alt,
  onOpen,
  onRemove,
  removeAriaLabel,
}) {
  const [displaySrc, setDisplaySrc] = useState(src);
  const [triedFallback, setTriedFallback] = useState(false);

  useEffect(() => {
    setDisplaySrc(src);
    setTriedFallback(false);
  }, [src]);

  const image = displaySrc ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={displaySrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
      onError={() => {
        if (triedFallback) return;
        setTriedFallback(true);
        if (storagePath) {
          forgetSignedUrl("card-photos", thumbPath(storagePath));
        }
        if (fallbackSrc && fallbackSrc !== displaySrc) {
          setDisplaySrc(fallbackSrc);
        }
      }}
    />
  ) : (
    <span className="text-[10px] text-ink/40">…</span>
  );

  return (
    <li className="group relative h-[4.5rem] w-14 shrink-0 overflow-hidden rounded-lg bg-night/50 ring-1 ring-ink/10">
      <button
        type="button"
        onClick={() => {
          if (displaySrc) onOpen?.();
        }}
        disabled={!displaySrc}
        className="block h-full w-full cursor-zoom-in disabled:cursor-default"
        aria-label={`Enlarge ${alt || "photo"}`}
      >
        <span className="flex h-full w-full items-center justify-center">
          {image}
        </span>
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          aria-label={removeAriaLabel ?? `Remove ${alt}`}
          className="absolute right-0.5 top-0.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-night/80 text-[10px] font-bold text-cream opacity-100 transition hover:bg-berry sm:opacity-0 sm:group-hover:opacity-100"
        >
          ✕
        </button>
      ) : null}
    </li>
  );
}

function AdminPhotoCluster({
  title,
  items,
  onRemove,
  onOpenItem,
  emptyText,
  nowrap = false,
}) {
  return (
    <div className="min-w-0 shrink-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink/45">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-ink/40">{emptyText}</p>
      ) : (
        <ul
          className={`mt-1.5 flex gap-1.5 ${
            nowrap ? "flex-nowrap" : "flex-wrap"
          }`}
        >
          {items.map((item) => (
            <AdminThumb
              key={item.id}
              src={item.src}
              fallbackSrc={item.fullSrc || item.href || null}
              storagePath={item.storagePath || null}
              alt={item.alt}
              onOpen={() => onOpenItem?.(item.id)}
              onRemove={onRemove ? () => onRemove(item.id) : undefined}
              removeAriaLabel={item.removeAriaLabel}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Customer + Update photo groups: one row when collapsed, stacked when expanded.
 *  Includes unsaved staged files in Update photos so truncation applies before save. */
export function AdminOrderCardPhotoGroups({
  customerItems = [],
  updateItems = [],
  pendingFiles = [],
  onRemoveUpdate,
  onRemovePending,
  className = "",
}) {
  const [expanded, setExpanded] = useState(false);
  const [pendingPreviews, setPendingPreviews] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const [visible, setVisible] = useState({
    customer: Number.POSITIVE_INFINITY,
    update: Number.POSITIVE_INFINITY,
    hidden: 0,
  });
  const collapsedRef = useRef(null);

  useEffect(() => {
    const urls = (pendingFiles ?? []).map((item) =>
      URL.createObjectURL(item.file)
    );
    setPendingPreviews(urls);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [pendingFiles]);

  const pendingItems = (pendingFiles ?? []).map((item, index) => ({
    id: item.id,
    src: pendingPreviews[index] ?? null,
    alt: item.file.name,
    label: item.file.name,
    removeAriaLabel: `Remove ${item.file.name}`,
    pending: true,
  }));

  const allUpdateItems = [...updateItems, ...pendingItems];
  const customerCount = customerItems.length;
  const updateCount = allUpdateItems.length;
  const pendingIdSet = new Set(pendingItems.map((item) => String(item.id)));

  useLayoutEffect(() => {
    if (expanded) return undefined;
    const node = collapsedRef.current;
    if (!node) return undefined;

    function measure() {
      const available = Math.max(0, node.clientWidth - ADMIN_ROW_PAD_X_PX);
      setVisible(fitCollapsedVisible(available, customerCount, updateCount));
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, customerCount, updateCount]);

  function handleRemoveUpdate(itemId) {
    if (pendingIdSet.has(String(itemId))) {
      onRemovePending?.(itemId);
      return;
    }
    onRemoveUpdate?.(itemId);
  }

  function openLightbox(group, itemId) {
    const list = group === "customer" ? customerItems : allUpdateItems;
    const index = list.findIndex((item) => String(item.id) === String(itemId));
    if (index < 0 || !list[index]?.src) return;
    setLightbox({ group, index });
  }

  const canRemove =
    typeof onRemoveUpdate === "function" ||
    typeof onRemovePending === "function";

  const lightboxList =
    lightbox?.group === "customer"
      ? customerItems
      : lightbox?.group === "update"
        ? allUpdateItems
        : [];
  const lightboxItem =
    lightbox != null ? lightboxList[lightbox.index] ?? null : null;
  const lightboxMedia = lightboxItem
    ? toLightboxMedia(
        lightboxItem,
        lightbox.group === "customer" ? "Customer photos" : "Update photos"
      )
    : null;

  if (customerCount === 0 && updateCount === 0) {
    return (
      <p className={`text-xs text-ink/50 ${className}`.trim()}>No photos yet.</p>
    );
  }

  const customerVisible = Math.min(
    customerCount,
    Number.isFinite(visible.customer) ? visible.customer : customerCount
  );
  const updateVisible = Math.min(
    updateCount,
    Number.isFinite(visible.update) ? visible.update : updateCount
  );
  const hiddenCount = Math.max(
    0,
    customerCount + updateCount - customerVisible - updateVisible
  );
  const needsMore = hiddenCount > 0;

  const photoPanel = expanded ? (
    <div
      className={`rounded-xl bg-night/25 ring-1 ring-ink/10 ${className}`.trim()}
    >
      <div className="space-y-4 px-3 py-3">
        <AdminPhotoCluster
          title="Customer photos"
          items={customerItems}
          emptyText="No customer photos."
          onOpenItem={(itemId) => openLightbox("customer", itemId)}
        />
        {updateCount > 0 ? (
          <div className="border-t border-ink/10 pt-3">
            <AdminPhotoCluster
              title="Update photos"
              items={allUpdateItems}
              onRemove={canRemove ? handleRemoveUpdate : undefined}
              onOpenItem={(itemId) => openLightbox("update", itemId)}
            />
            {pendingItems.length > 0 ? (
              <p className="mt-2 text-[11px] text-ink/45">
                Unsaved photos upload when you save.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="flex w-full items-center justify-center border-t border-ink/10 px-3 py-2 text-xs font-semibold text-ink/55 transition hover:bg-night/30 hover:text-ink"
      >
        Show less
      </button>
    </div>
  ) : (
    <div
      ref={collapsedRef}
      className={`flex items-end gap-2 rounded-xl bg-night/25 px-3 py-3 ring-1 ring-ink/10 ${className}`.trim()}
    >
      <div className="flex min-w-0 flex-1 items-end gap-4 overflow-hidden">
        {customerVisible > 0 || customerCount === 0 ? (
          <AdminPhotoCluster
            title="Customer photos"
            items={customerItems.slice(0, customerVisible)}
            emptyText={customerCount === 0 ? "None" : undefined}
            onOpenItem={(itemId) => openLightbox("customer", itemId)}
            nowrap
          />
        ) : null}
        {updateVisible > 0 ? (
          <>
            {customerVisible > 0 || customerCount === 0 ? (
              <div
                className="h-16 w-px shrink-0 bg-ink/10"
                aria-hidden="true"
              />
            ) : null}
            <AdminPhotoCluster
              title="Update photos"
              items={allUpdateItems.slice(0, updateVisible)}
              onRemove={canRemove ? handleRemoveUpdate : undefined}
              onOpenItem={(itemId) => openLightbox("update", itemId)}
              nowrap
            />
          </>
        ) : null}
      </div>
      {needsMore ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex h-[4.5rem] w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-ink/25 bg-night/20 text-ink/60 transition hover:border-berry/50 hover:bg-berry/10 hover:text-berry"
        >
          <span className="text-sm font-bold leading-none">+{hiddenCount}</span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide">
            more
          </span>
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      {photoPanel}
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
              const list =
                current.group === "customer" ? customerItems : allUpdateItems;
              return current.index >= list.length - 1
                ? current
                : { ...current, index: current.index + 1 };
            })
          }
          hasPrevious={lightbox.index > 0}
          hasNext={lightbox.index < lightboxList.length - 1}
          position={lightbox.index + 1}
          total={lightboxList.length}
        />
      ) : null}
    </>
  );
}

export function StagedCardPhotoPreviews({ files, onRemove, caption }) {
  const [previews, setPreviews] = useState([]);

  useEffect(() => {
    const urls = files.map((item) => URL.createObjectURL(item.file));
    setPreviews(urls);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [files]);

  const items = files.map((item, index) => ({
    id: item.id,
    src: previews[index] ?? null,
    alt: item.file.name,
    label: item.file.name,
    removeAriaLabel: `Remove ${item.file.name}`,
  }));

  return (
    <CardPhotoPreviewGrid items={items} onRemove={onRemove} caption={caption} />
  );
}

"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { DAMAGE_TAGS, formatPostedRelative } from "@/lib/gallery";
import GalleryImage from "@/components/GalleryImage";
import MediaLightbox from "@/components/MediaLightbox";

function pairMediaKind(pair) {
  return pair.type === "video" || pair.mediaKind === "video" ? "video" : "image";
}

function buildMediaList(items) {
  return items.flatMap((item) =>
    (item.pairs ?? []).flatMap((pair) => {
      const kind = pairMediaKind(pair);
      const entries = [];
      if (pair.before) {
        entries.push({
          type: kind,
          src: pair.before,
          alt: `${item.title} before`,
          label: "Before",
          sectionTitle: item.title,
        });
      }
      if (pair.after) {
        entries.push({
          type: kind,
          src: pair.after,
          alt: `${item.title} after`,
          label: "After",
          sectionTitle: item.title,
        });
      }
      return entries;
    }),
  );
}

function PlayBadge({ className = "" }) {
  return (
    <span
      className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center ${className}`}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ink/90 shadow-lg transition duration-200 group-hover:scale-110">
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="-ml-0.5 h-9 w-9 text-night"
          aria-hidden="true"
        >
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    </span>
  );
}

function PairSideCard({ src, type, label, onOpen, priority = false }) {
  if (!src) {
    return (
      <div className="space-y-2">
        <div className="aspect-[3/4] w-full rounded-xl bg-night/10 pixel-border" />
        <p className="text-center text-xs font-bold uppercase tracking-wide text-ink/60">
          {label}
        </p>
      </div>
    );
  }

  const isVideo = type === "video";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => onOpen({ type: isVideo ? "video" : "image", src, label })}
        className="group relative block aspect-[3/4] w-full cursor-zoom-in overflow-hidden rounded-xl bg-night/10 pixel-border"
        aria-label={`Enlarge ${label}`}
      >
        {isVideo ? (
          <>
            <video
              src={src}
              muted
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-cover transition duration-200 group-hover:scale-105"
            />
            <span className="pointer-events-none absolute inset-0 bg-night/20 transition group-hover:bg-night/30" />
            <PlayBadge />
          </>
        ) : (
          <>
            <GalleryImage
              src={src}
              width={640}
              alt={label}
              priority={priority}
              className="object-cover transition duration-200 group-hover:scale-105"
              sizes="(max-width: 768px) 50vw, 400px"
            />
            <span className="pointer-events-none absolute inset-0 bg-night/0 transition group-hover:bg-night/20" />
          </>
        )}
      </button>
      <p className="text-center text-xs font-bold uppercase tracking-wide text-ink/60">
        {label}
      </p>
    </div>
  );
}

function BeforeAfterPair({ pair, onOpen, priority = false }) {
  const kind = pairMediaKind(pair);
  const caption = typeof pair.caption === "string" ? pair.caption.trim() : "";

  const grid = (
    <div className="grid grid-cols-2 gap-3">
      <PairSideCard
        src={pair.before}
        type={kind}
        label="Before"
        priority={priority}
        onOpen={onOpen}
      />
      <PairSideCard
        src={pair.after}
        type={kind}
        label="After"
        priority={priority}
        onOpen={onOpen}
      />
    </div>
  );

  if (!caption) return grid;

  return (
    <figure className="overflow-hidden rounded-2xl border border-ink/10 bg-cream/50 shadow-sm">
      <div className="p-3 pb-2.5">{grid}</div>
      <figcaption className="flex items-center justify-center gap-2 border-t border-ink/10 bg-night/[0.04] px-4 py-2.5 text-center text-sm font-semibold text-ink/75">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5 shrink-0 text-berry"
          aria-hidden="true"
        >
          <path d="M4 7h16M4 12h10M4 17h7" />
        </svg>
        {caption}
      </figcaption>
    </figure>
  );
}

function previewSrc(pair) {
  return pair.before || pair.after || null;
}

function itemKeyOf(item) {
  return item.id ?? item.title;
}

function GalleryItemCard({ item, index, onOpen }) {
  const pairs = (item.pairs ?? []).filter((pair) => pair.before || pair.after);
  const featured = pairs[0] ?? null;
  const extra = pairs.slice(1);
  const hasExtra = extra.length > 0;
  // Scope lightbox navigation to this card's media only.
  const openMedia = (media) => onOpen(itemKeyOf(item), media);
  const postedLabel = item.createdAt
    ? formatPostedRelative(item.createdAt)
    : "";
  const damageTags = DAMAGE_TAGS.filter((tag) =>
    (item.damageTags ?? []).includes(tag.id),
  );

  return (
    <div
      className="pixel-border animate-fade-up overflow-hidden rounded-2xl border-blush/10 bg-cream/60"
      style={{ animationDelay: `${100 + index * 100}ms` }}
    >
      <div className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 text-left">
            <h3 className="font-display text-lg font-bold text-ink">{item.title}</h3>
            {item.setName ? (
              <p className="mt-1 text-xs font-bold uppercase tracking-wide text-ink/50">
                {item.setName}
              </p>
            ) : null}
            {postedLabel ? (
              <time
                dateTime={item.createdAt}
                className="mt-1.5 block text-xs font-medium tracking-wide text-ink/55"
              >
                {postedLabel}
              </time>
            ) : null}
          </div>

          {damageTags.length > 0 && (
            <ul
              className="flex flex-wrap gap-1.5 sm:shrink-0 sm:justify-end"
              aria-label="Damage repaired"
            >
              {damageTags.map((tag) => (
                <li
                  key={tag.id}
                  className="rounded-full border border-ink/15 bg-night/30 px-2.5 py-1 text-xs font-semibold text-ink/80"
                >
                  {tag.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        {featured && (
          <BeforeAfterPair
            pair={featured}
            onOpen={openMedia}
            priority={index <= 1}
          />
        )}

        {hasExtra && (
          <details className="group border-t border-ink/10 pt-4">
            <summary className="cursor-pointer list-none marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-sm font-semibold text-ink">
                  <span className="group-open:hidden">Show more</span>
                  <span className="hidden group-open:inline">Show less</span>
                </span>
                <span className="flex flex-1 flex-wrap items-center justify-center gap-1.5 group-open:hidden">
                  {extra.map((pair, previewIndex) => {
                    const src = previewSrc(pair);
                    if (!src) return null;
                    const isVideo = pairMediaKind(pair) === "video";
                    return (
                      <span
                        key={pair.id ?? `${item.title}-preview-${previewIndex}`}
                        className="relative block h-10 w-8 overflow-hidden rounded-md border border-ink/10 bg-night/10"
                      >
                        {isVideo ? (
                          <video
                            src={src}
                            muted
                            playsInline
                            preload="metadata"
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : (
                          <GalleryImage
                            src={src}
                            width={128}
                            alt=""
                            sizes="32px"
                            className="object-cover"
                          />
                        )}
                        {isVideo && (
                          <span className="absolute inset-0 flex items-center justify-center bg-night/25">
                            <svg
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              className="h-3 w-3 text-ink"
                              aria-hidden="true"
                            >
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        )}
                      </span>
                    );
                  })}
                </span>
                <span className="flex w-20 shrink-0 justify-end text-blush group-open:invisible">
                  +
                </span>
              </span>
            </summary>
            <div className="space-y-3 pt-4">
              {extra.map((pair, pairIndex) => (
                <BeforeAfterPair
                  key={pair.id ?? `${item.title}-extra-${pairIndex}`}
                  pair={pair}
                  onOpen={openMedia}
                />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

const PAGE_SIZE = 10;

// Build a compact list of page numbers with ellipsis gaps for larger sets so
// the control never grows unbounded. Small sets show every page.
function getPageList(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set([
    1,
    2,
    total - 1,
    total,
    current - 1,
    current,
    current + 1,
  ]);
  const visible = [...pages]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);
  const result = [];
  let previous = 0;
  for (const page of visible) {
    if (page - previous > 1) result.push(`gap-${page}`);
    result.push(page);
    previous = page;
  }
  return result;
}

function FilterButton({ active, disabled, count, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-bold transition ${
        active
          ? "border-berry bg-berry text-night shadow-cozy-sm"
          : "border-ink/15 bg-night/10 text-ink/80 hover:border-ink/30 hover:bg-night/20"
      } ${
        disabled
          ? "cursor-not-allowed opacity-30 hover:border-ink/15 hover:bg-night/10"
          : ""
      }`}
    >
      <span>{children}</span>
      {typeof count === "number" && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[0.65rem] font-bold leading-none ${
            active ? "bg-night/20 text-night" : "bg-ink/10 text-ink/60"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function GalleryFilters({ activeFilter, counts, totalCount, onSelect }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-cream/40 p-4 sm:p-5">
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink/50">
        Filter by damage
      </p>
      <div className="flex flex-wrap gap-2">
        <FilterButton
          active={activeFilter === "all"}
          count={totalCount}
          onClick={() => onSelect("all")}
        >
          All
        </FilterButton>
        {DAMAGE_TAGS.map((tag) => (
          <FilterButton
            key={tag.id}
            active={activeFilter === tag.id}
            count={counts[tag.id] ?? 0}
            disabled={(counts[tag.id] ?? 0) === 0}
            onClick={() => onSelect(tag.id)}
          >
            {tag.label}
          </FilterButton>
        ))}
      </div>
    </div>
  );
}

function Pagination({ currentPage, totalPages, onChange }) {
  if (totalPages <= 1) return null;

  const pageList = getPageList(currentPage, totalPages);
  const arrowClass =
    "flex h-9 items-center rounded-xl border border-ink/15 bg-night/10 px-3 text-sm font-bold text-ink/80 transition hover:border-ink/30 hover:bg-night/20 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-ink/15 disabled:hover:bg-night/10";

  return (
    <nav
      className="flex flex-wrap items-center justify-center gap-1.5"
      aria-label="Gallery pagination"
    >
      <button
        type="button"
        onClick={() => onChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className={arrowClass}
        aria-label="Previous page"
      >
        Prev
      </button>

      {pageList.map((entry) =>
        typeof entry === "number" ? (
          <button
            key={entry}
            type="button"
            onClick={() => onChange(entry)}
            aria-current={entry === currentPage ? "page" : undefined}
            className={`flex h-9 w-9 items-center justify-center rounded-xl border text-sm font-bold transition ${
              entry === currentPage
                ? "border-berry bg-berry text-night shadow-cozy-sm"
                : "border-ink/15 bg-night/10 text-ink/80 hover:border-ink/30 hover:bg-night/20"
            }`}
          >
            {entry}
          </button>
        ) : (
          <span
            key={entry}
            className="flex h-9 w-6 items-center justify-center text-sm font-bold text-ink/40"
            aria-hidden="true"
          >
            …
          </span>
        ),
      )}

      <button
        type="button"
        onClick={() => onChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className={arrowClass}
        aria-label="Next page"
      >
        Next
      </button>
    </nav>
  );
}

export default function GalleryContent({ items }) {
  const [activeFilter, setActiveFilter] = useState("all");
  const [page, setPage] = useState(1);
  // Lightbox target: { itemKey, index } into that card's own media list.
  const [active, setActive] = useState(null);
  const topRef = useRef(null);

  const damageCounts = useMemo(() => {
    const counts = {};
    for (const tag of DAMAGE_TAGS) counts[tag.id] = 0;
    for (const item of items) {
      for (const id of item.damageTags ?? []) {
        if (id in counts) counts[id] += 1;
      }
    }
    return counts;
  }, [items]);

  const filteredItems = useMemo(() => {
    if (activeFilter === "all") return items;
    return items.filter((item) =>
      (item.damageTags ?? []).includes(activeFilter),
    );
  }, [items, activeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, currentPage]);

  // Lightbox navigation is scoped to the clicked card: Prev/Next only move
  // through that card's own before/after media, never across cards.
  const mediaByItem = useMemo(() => {
    const map = new Map();
    for (const item of pageItems) {
      map.set(itemKeyOf(item), buildMediaList([item]));
    }
    return map;
  }, [pageItems]);

  const activeList = active ? mediaByItem.get(active.itemKey) ?? [] : [];
  const activeMedia = active ? activeList[active.index] ?? null : null;

  const closeLightbox = useCallback(() => setActive(null), []);

  const openMedia = useCallback(
    (itemKey, media) => {
      const list = mediaByItem.get(itemKey) ?? [];
      const index = list.findIndex(
        (entry) => entry.src === media.src && entry.label === media.label,
      );
      setActive(index === -1 ? null : { itemKey, index });
    },
    [mediaByItem],
  );

  const goPrevious = useCallback(() => {
    setActive((current) =>
      !current || current.index <= 0
        ? current
        : { ...current, index: current.index - 1 },
    );
  }, []);

  const goNext = useCallback(() => {
    setActive((current) => {
      if (!current) return current;
      const list = mediaByItem.get(current.itemKey) ?? [];
      return current.index >= list.length - 1
        ? current
        : { ...current, index: current.index + 1 };
    });
  }, [mediaByItem]);

  const selectFilter = useCallback((filterId) => {
    setActiveFilter(filterId);
    setPage(1);
    setActive(null);
  }, []);

  const changePage = useCallback((next) => {
    setPage(next);
    setActive(null);
    if (topRef.current) {
      topRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const rangeStart =
    filteredItems.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredItems.length);

  return (
    <>
      <div ref={topRef} className="scroll-mt-24 space-y-6">
        <GalleryFilters
          activeFilter={activeFilter}
          counts={damageCounts}
          totalCount={items.length}
          onSelect={selectFilter}
        />

        {filteredItems.length > 0 ? (
          <>
            <p className="text-sm font-semibold text-ink/60">
              Showing {rangeStart}–{rangeEnd} of {filteredItems.length}{" "}
              {filteredItems.length === 1 ? "restoration" : "restorations"}
            </p>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {pageItems.map((item, index) => (
                <GalleryItemCard
                  key={item.id ?? item.title}
                  item={item}
                  index={index}
                  onOpen={openMedia}
                />
              ))}
            </div>

            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onChange={changePage}
            />
          </>
        ) : (
          <div className="rounded-2xl border border-ink/10 bg-cream/40 py-16 text-center">
            <p className="text-sm font-semibold text-ink/70">
              No restorations match this filter yet.
            </p>
          </div>
        )}
      </div>

      {activeMedia && (
        <MediaLightbox
          media={activeMedia}
          onClose={closeLightbox}
          onPrevious={goPrevious}
          onNext={goNext}
          hasPrevious={active.index > 0}
          hasNext={active.index < activeList.length - 1}
        />
      )}
    </>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, forwardRef } from "react";
import Image from "next/image";
import { DAMAGE_TAGS, galleryImageUrl } from "@/lib/gallery";

const MutedVideo = forwardRef(function MutedVideo({ className, ...props }, ref) {
  const videoRef = useRef(null);

  const setRefs = useCallback(
    (node) => {
      videoRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return undefined;
    }

    const enforceMute = () => {
      video.muted = true;
      video.volume = 0;
    };

    enforceMute();
    video.addEventListener("volumechange", enforceMute);
    video.addEventListener("play", enforceMute);

    return () => {
      video.removeEventListener("volumechange", enforceMute);
      video.removeEventListener("play", enforceMute);
    };
  }, []);

  return (
    <video
      ref={setRefs}
      muted
      playsInline
      className={className}
      {...props}
    />
  );
});

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

function GalleryLightbox({ media, onClose, onPrevious, onNext, hasPrevious, hasNext }) {
  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowLeft" && hasPrevious) {
        onPrevious();
      } else if (event.key === "ArrowRight" && hasNext) {
        onNext();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose, onPrevious, onNext, hasPrevious, hasNext]);

  const mediaClassName =
    "max-h-[60vh] w-auto max-w-[85vw] rounded-xl object-contain pixel-border sm:max-h-[72vh] md:max-h-[80vh] md:max-w-[90vw]";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-night/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={media.label}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-full bg-ink/10 px-3 py-1 text-sm font-bold text-ink transition hover:bg-ink/20"
        aria-label="Close"
      >
        Close
      </button>

      {hasPrevious && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPrevious();
          }}
          className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-ink/10 p-3 text-ink transition hover:bg-ink/20 sm:left-4"
          aria-label="Previous"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}

      {hasNext && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onNext();
          }}
          className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-ink/10 p-3 text-ink transition hover:bg-ink/20 sm:right-4"
          aria-label="Next"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}

      <div className="flex-1" aria-hidden="true" />

      <div className="flex w-full flex-shrink-0 items-center">
        <div className="flex-1 self-stretch" aria-hidden="true" />
        <div
          className="flex flex-shrink-0 flex-col items-center"
          onClick={(event) => event.stopPropagation()}
        >
          {media.type === "image" ? (
            <img
              key={media.src}
              src={media.src}
              alt={media.alt}
              className={mediaClassName}
            />
          ) : (
            <MutedVideo
              key={media.src}
              src={media.src}
              loop
              controls
              className={mediaClassName}
            />
          )}
          <p className="mt-3 text-center text-sm font-bold uppercase tracking-wide text-ink/80">
            {media.sectionTitle} — {media.label}
          </p>
        </div>
        <div className="flex-1 self-stretch" aria-hidden="true" />
      </div>

      <div className="flex-1" aria-hidden="true" />
    </div>
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

// Renders a Supabase gallery image resized via the transform endpoint, falling
// back to the original URL if the transform fails (e.g. source too large to
// process). Fades in once loaded to smooth the lazy-load pop-in.
function GalleryImage({ src, width, alt, sizes, priority = false, className = "" }) {
  const [loaded, setLoaded] = useState(false);
  const [useOriginal, setUseOriginal] = useState(false);
  const displaySrc = useOriginal ? src : galleryImageUrl(src, { width });

  return (
    <Image
      src={displaySrc}
      alt={alt}
      fill
      priority={priority}
      sizes={sizes}
      onLoad={() => setLoaded(true)}
      onError={() => {
        if (!useOriginal) {
          setLoaded(false);
          setUseOriginal(true);
        }
      }}
      className={`${className} transition-opacity duration-300 ${
        loaded ? "opacity-100" : "opacity-0"
      }`}
    />
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
              className="object-contain transition duration-200 group-hover:scale-105"
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

  return (
    <div className="space-y-2">
      {caption && (
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-ink/60">
          {caption}
        </p>
      )}
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
    </div>
  );
}

function previewSrc(pair) {
  return pair.before || pair.after || null;
}

function GalleryItemCard({ item, index, onOpen }) {
  const pairs = (item.pairs ?? []).filter((pair) => pair.before || pair.after);
  const featured = pairs[0] ?? null;
  const extra = pairs.slice(1);
  const hasExtra = extra.length > 0;

  return (
    <div
      className="pixel-border animate-fade-up overflow-hidden rounded-2xl border-blush/10 bg-cream/60"
      style={{ animationDelay: `${100 + index * 100}ms` }}
    >
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 text-left">
            <h3 className="font-display text-lg font-bold text-ink">{item.title}</h3>
            {item.setName ? (
              <p className="mt-1 text-xs font-bold uppercase tracking-wide text-ink/50">
                {item.setName}
              </p>
            ) : null}
          </div>

          <div className="shrink-0 rounded-xl border border-ink/15 bg-night/10 px-3 py-2">
            <ul
              className="grid grid-flow-col grid-rows-2 gap-x-4 gap-y-1.5"
              aria-label="Damage checklist"
            >
              {DAMAGE_TAGS.map((tag) => {
                const applicable = (item.damageTags ?? []).includes(tag.id);
                return (
                  <li
                    key={tag.id}
                    className={`flex items-center gap-2 ${
                      applicable ? "text-ink/80" : "opacity-35"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={applicable}
                      readOnly
                      tabIndex={-1}
                      className="pointer-events-none h-3.5 w-3.5 accent-berry"
                      aria-hidden="true"
                    />
                    <span className="whitespace-nowrap text-xs font-semibold">
                      {tag.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {featured && (
          <BeforeAfterPair
            pair={featured}
            onOpen={onOpen}
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
                  onOpen={onOpen}
                />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export default function GalleryContent({ items }) {
  const mediaList = useMemo(() => buildMediaList(items), [items]);
  const [activeIndex, setActiveIndex] = useState(null);
  const closeLightbox = useCallback(() => setActiveIndex(null), []);

  const openMedia = useCallback(
    (media) => {
      const index = mediaList.findIndex(
        (entry) => entry.src === media.src && entry.label === media.label,
      );
      setActiveIndex(index === -1 ? null : index);
    },
    [mediaList],
  );

  const goPrevious = useCallback(() => {
    setActiveIndex((index) => (index === null || index <= 0 ? index : index - 1));
  }, []);

  const goNext = useCallback(() => {
    setActiveIndex((index) =>
      index === null || index >= mediaList.length - 1 ? index : index + 1,
    );
  }, [mediaList.length]);

  const activeMedia = activeIndex === null ? null : mediaList[activeIndex];

  return (
    <>
      <div className="space-y-8">
        {items.map((item, index) => (
          <GalleryItemCard
            key={item.id ?? item.title}
            item={item}
            index={index}
            onOpen={openMedia}
          />
        ))}
      </div>

      {activeMedia && (
        <GalleryLightbox
          media={activeMedia}
          onClose={closeLightbox}
          onPrevious={goPrevious}
          onNext={goNext}
          hasPrevious={activeIndex > 0}
          hasNext={activeIndex < mediaList.length - 1}
        />
      )}
    </>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, forwardRef } from "react";
import Image from "next/image";

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

function getItemMediaEntries(item) {
  const entries = [];

  if (item.beforeFront) {
    entries.push(
      {
        type: "image",
        src: item.beforeFront,
        alt: `${item.title} before — front`,
        label: "Before — Front",
        sectionTitle: item.title,
      },
      {
        type: "image",
        src: item.afterFront,
        alt: `${item.title} after — front`,
        label: "After — Front",
        sectionTitle: item.title,
      },
      {
        type: "image",
        src: item.beforeBack,
        alt: `${item.title} before — back`,
        label: "Before — Back",
        sectionTitle: item.title,
      },
      {
        type: "image",
        src: item.afterBack,
        alt: `${item.title} after — back`,
        label: "After — Back",
        sectionTitle: item.title,
      },
    );
  }

  if (item.beforeFrontVideo && item.afterFrontVideo) {
    if (item.pairedVideoLayout) {
      entries.push(
        {
          type: "video",
          src: item.beforeFrontVideo,
          poster: item.beforeFront,
          label: "Before — Front (Video)",
          sectionTitle: item.title,
        },
        {
          type: "video",
          src: item.beforeBackVideo,
          poster: item.beforeBack,
          label: "Before — Back (Video)",
          sectionTitle: item.title,
        },
        {
          type: "video",
          src: item.afterFrontVideo,
          poster: item.afterFront,
          label: "After — Front (Video)",
          sectionTitle: item.title,
        },
        {
          type: "video",
          src: item.afterBackVideo,
          poster: item.afterBack,
          label: "After — Back (Video)",
          sectionTitle: item.title,
        },
      );
    } else {
      entries.push(
        {
          type: "video",
          src: item.beforeFrontVideo,
          poster: item.beforeFront,
          label: "Before — Front (Video)",
          sectionTitle: item.title,
        },
        {
          type: "video",
          src: item.afterFrontVideo,
          poster: item.afterFront,
          label: "After — Front (Video)",
          sectionTitle: item.title,
        },
        {
          type: "video",
          src: item.beforeBackVideo,
          poster: item.beforeBack,
          label: "Before — Back (Video)",
          sectionTitle: item.title,
        },
        {
          type: "video",
          src: item.afterBackVideo,
          poster: item.afterBack,
          label: "After — Back (Video)",
          sectionTitle: item.title,
        },
      );
    }
  }

  return entries;
}

function buildMediaList(items) {
  return items.flatMap(getItemMediaEntries);
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
              poster={media.poster}
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

function GalleryImageCard({ src, alt, label, onOpen, priority = false }) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() =>
          onOpen({ type: "image", src, alt, label })
        }
        className="group relative block aspect-[3/4] w-full cursor-zoom-in overflow-hidden rounded-xl pixel-border"
        aria-label={`Enlarge ${label}`}
      >
        <Image
          src={src}
          alt={alt}
          fill
          priority={priority}
          className="object-cover transition duration-200 group-hover:scale-105"
          sizes="(max-width: 768px) 50vw, 400px"
        />
        <span className="pointer-events-none absolute inset-0 bg-night/0 transition group-hover:bg-night/20" />
      </button>
      <p className="text-center text-xs font-bold uppercase tracking-wide text-ink/60">
        {label}
      </p>
    </div>
  );
}

function GalleryVideoCard({ src, poster, label, onOpen }) {
  const handleOpen = () => {
    onOpen({ type: "video", src, poster, label });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleOpen}
        className="group relative block aspect-[3/4] w-full overflow-hidden rounded-xl bg-night/10 pixel-border"
        aria-label={`Play ${label}`}
      >
        <Image
          src={poster}
          alt={label}
          fill
          className="object-cover transition duration-200 group-hover:scale-105"
          sizes="(max-width: 768px) 50vw, 400px"
        />
        <span className="pointer-events-none absolute inset-0 bg-night/20 transition group-hover:bg-night/30" />
        <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
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
      </button>
      <p className="text-center text-xs font-bold uppercase tracking-wide text-ink/60">
        {label}
      </p>
    </div>
  );
}

function getSeeMorePreviews(item) {
  const previews = [];

  if (item.beforeBack) {
    previews.push({ src: item.beforeBack, alt: `${item.title} before — back` });
  }
  if (item.afterBack) {
    previews.push({ src: item.afterBack, alt: `${item.title} after — back` });
  }
  if (item.beforeFrontVideo) {
    previews.push({
      src: item.beforeFront,
      alt: `${item.title} before — front video`,
      isVideo: true,
    });
  }
  if (item.beforeBackVideo) {
    previews.push({
      src: item.beforeBack,
      alt: `${item.title} before — back video`,
      isVideo: true,
    });
  }
  if (item.afterFrontVideo) {
    previews.push({
      src: item.afterFront,
      alt: `${item.title} after — front video`,
      isVideo: true,
    });
  }
  if (item.afterBackVideo) {
    previews.push({
      src: item.afterBack,
      alt: `${item.title} after — back video`,
      isVideo: true,
    });
  }

  return previews;
}

function GalleryItemVideos({ item, onOpen }) {
  if (!item.beforeFrontVideo || !item.afterFrontVideo) {
    return null;
  }

  if (item.pairedVideoLayout) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="grid grid-cols-2 gap-3">
          <GalleryVideoCard
            src={item.beforeFrontVideo}
            poster={item.beforeFront}
            label="Before — Front (Video)"
            onOpen={onOpen}
          />
          <GalleryVideoCard
            src={item.beforeBackVideo}
            poster={item.beforeBack}
            label="Before — Back (Video)"
            onOpen={onOpen}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <GalleryVideoCard
            src={item.afterFrontVideo}
            poster={item.afterFront}
            label="After — Front (Video)"
            onOpen={onOpen}
          />
          <GalleryVideoCard
            src={item.afterBackVideo}
            poster={item.afterBack}
            label="After — Back (Video)"
            onOpen={onOpen}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <GalleryVideoCard
          src={item.beforeFrontVideo}
          poster={item.beforeFront}
          label="Before — Front (Video)"
          onOpen={onOpen}
        />
        <GalleryVideoCard
          src={item.afterFrontVideo}
          poster={item.afterFront}
          label="After — Front (Video)"
          onOpen={onOpen}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <GalleryVideoCard
          src={item.beforeBackVideo}
          poster={item.beforeBack}
          label="Before — Back (Video)"
          onOpen={onOpen}
        />
        <GalleryVideoCard
          src={item.afterBackVideo}
          poster={item.afterBack}
          label="After — Back (Video)"
          onOpen={onOpen}
        />
      </div>
    </>
  );
}

function GalleryItemCard({ item, index, onOpen }) {
  const hasExtra =
    item.beforeBack || (item.beforeFrontVideo && item.afterFrontVideo);
  const previews = hasExtra ? getSeeMorePreviews(item) : [];

  return (
    <div
      className="pixel-border animate-fade-up overflow-hidden rounded-2xl border-blush/10 bg-cream/60"
      style={{ animationDelay: `${100 + index * 100}ms` }}
    >
      <div className="space-y-4 p-5">
        <div className="text-center">
          <h3 className="font-display text-lg font-bold text-ink">{item.title}</h3>
          <p className="mt-1 text-sm text-ink/70">{item.description}</p>
        </div>

        {item.beforeFront && (
          <div className="grid grid-cols-2 gap-3">
            <GalleryImageCard
              src={item.beforeFront}
              alt={`${item.title} before — front`}
              label="Before — Front"
              priority={index <= 1}
              onOpen={onOpen}
            />
            <GalleryImageCard
              src={item.afterFront}
              alt={`${item.title} after — front`}
              label="After — Front"
              priority={index <= 1}
              onOpen={onOpen}
            />
          </div>
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
                  {previews.map((preview, previewIndex) => (
                    <span
                      key={`${item.title}-preview-${previewIndex}`}
                      className="relative block h-10 w-8 overflow-hidden rounded-md border border-ink/10 bg-night/10"
                    >
                      <Image
                        src={preview.src}
                        alt={preview.alt}
                        fill
                        className="object-cover"
                        sizes="32px"
                      />
                      {preview.isVideo && (
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
                  ))}
                </span>
                <span className="flex w-20 shrink-0 justify-end text-blush group-open:invisible">
                  +
                </span>
              </span>
            </summary>
            <div className="space-y-3 pt-4">
              {item.beforeBack && (
                <div className="grid grid-cols-2 gap-3">
                  <GalleryImageCard
                    src={item.beforeBack}
                    alt={`${item.title} before — back`}
                    label="Before — Back"
                    onOpen={onOpen}
                  />
                  <GalleryImageCard
                    src={item.afterBack}
                    alt={`${item.title} after — back`}
                    label="After — Back"
                    onOpen={onOpen}
                  />
                </div>
              )}
              <GalleryItemVideos item={item} onOpen={onOpen} />
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
            key={item.title}
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

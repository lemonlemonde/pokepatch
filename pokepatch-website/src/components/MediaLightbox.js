"use client";

import { useCallback, useEffect, useRef, forwardRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = "button, [href], video[controls], [tabindex]:not([tabindex='-1'])";

export const MutedVideo = forwardRef(function MutedVideo(
  { className, ...props },
  ref,
) {
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

/**
 * Fullscreen media viewer used by the public Gallery and Studio tools.
 * `media`: { type: "image"|"video", src, alt, label, sectionTitle? }
 */
export default function MediaLightbox({
  media,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;

    const handleKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowLeft" && hasPrevious) {
        onPrevious?.();
      } else if (event.key === "ArrowRight" && hasNext) {
        onNext?.();
      } else if (event.key === "Tab" && container) {
        // Keep Tab focus inside the dialog while it is open.
        const focusable = [...container.querySelectorAll(FOCUSABLE_SELECTOR)];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !container.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !container.contains(active))) {
          event.preventDefault();
          first.focus();
        }
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

  // Move focus into the dialog on open and hand it back on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    containerRef.current?.focus();
    return () => {
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, []);

  const mediaClassName =
    "max-h-[60vh] w-auto max-w-[85vw] rounded-xl object-contain pixel-border sm:max-h-[72vh] md:max-h-[80vh] md:max-w-[90vw]";
  const caption = [media.sectionTitle, media.label].filter(Boolean).join(" — ");

  const dialog = (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex flex-col bg-night/90 outline-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={media.label || media.alt || "Media"}
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
            onPrevious?.();
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
            onNext?.();
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
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={media.src}
              src={media.src}
              alt={media.alt || media.label || ""}
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
          {caption ? (
            <p className="mt-3 text-center text-sm font-bold uppercase tracking-wide text-ink/80">
              {caption}
            </p>
          ) : null}
        </div>
        <div className="flex-1 self-stretch" aria-hidden="true" />
      </div>

      <div className="flex-1" aria-hidden="true" />
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(dialog, document.body);
}

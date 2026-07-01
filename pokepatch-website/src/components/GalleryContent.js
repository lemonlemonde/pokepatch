"use client";

import { useCallback, useEffect, useRef, useState, forwardRef } from "react";
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

function GalleryLightbox({ media, onClose }) {
  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-night/90 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={media.label}
    >
      <div className="flex min-h-full items-center justify-center">
        <button
          type="button"
          onClick={onClose}
          className="fixed right-4 top-4 z-10 rounded-full bg-ink/10 px-3 py-1 text-sm font-bold text-ink transition hover:bg-ink/20"
          aria-label="Close"
        >
          Close
        </button>

        <div
          className="flex max-w-[90vw] flex-col items-center py-8"
          onClick={(event) => event.stopPropagation()}
        >
        {media.type === "image" ? (
          <img
            src={media.src}
            alt={media.alt}
            className="max-h-[80vh] w-auto max-w-[90vw] rounded-xl object-contain pixel-border"
          />
        ) : (
          <MutedVideo
            src={media.src}
            poster={media.poster}
            loop
            controls
            className="max-h-[80vh] w-auto max-w-[90vw] rounded-xl object-contain pixel-border"
          />
        )}
        <p className="mt-3 text-center text-sm font-bold uppercase tracking-wide text-ink/80">
          {media.label}
        </p>
        </div>
      </div>
    </div>
  );
}

function GalleryImageCard({ src, alt, label, onOpen }) {
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
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const togglePlay = (event) => {
    event.stopPropagation();
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  };

  const handleEnlarge = (event) => {
    event.stopPropagation();
    onOpen({ type: "video", src, poster, label });
  };

  return (
    <div className="space-y-2">
      <div className="group relative aspect-[3/4] overflow-hidden rounded-xl bg-night/10 pixel-border">
        <MutedVideo
          ref={videoRef}
          src={src}
          poster={poster}
          preload="metadata"
          loop
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          className="h-full w-full object-cover"
        />
        <span
          className={`pointer-events-none absolute inset-0 bg-night/20 transition ${
            isPlaying ? "opacity-0" : "group-hover:bg-night/30"
          }`}
        />
        <button
          type="button"
          onClick={togglePlay}
          className={`absolute inset-0 z-10 flex items-center justify-center transition ${
            isPlaying ? "opacity-0 hover:opacity-100" : "opacity-100"
          }`}
          aria-label={isPlaying ? `Pause ${label}` : `Play ${label}`}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ink/90 shadow-lg transition duration-200 group-hover:scale-110">
            {isPlaying ? (
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-8 w-8 text-night"
                aria-hidden="true"
              >
                <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="-ml-0.5 h-9 w-9 text-night"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={handleEnlarge}
          className="absolute right-2 top-2 z-20 rounded-full bg-night/70 p-1.5 text-ink transition hover:bg-night/90"
          aria-label={`Enlarge ${label}`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6" />
          </svg>
        </button>
      </div>
      <p className="text-center text-xs font-bold uppercase tracking-wide text-ink/60">
        {label}
      </p>
    </div>
  );
}

export default function GalleryContent({ items }) {
  const [activeMedia, setActiveMedia] = useState(null);
  const closeLightbox = useCallback(() => setActiveMedia(null), []);

  return (
    <>
      <div className="space-y-12">
        {items.map((item, index) => (
          <div
            key={item.title}
            className="animate-fade-up space-y-4"
            style={{ animationDelay: `${100 + index * 100}ms` }}
          >
            <h3 className="text-center font-display text-lg font-bold text-ink">
              {item.title}
            </h3>
            <p className="text-center text-sm text-ink/70">{item.description}</p>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <GalleryImageCard
                  src={item.beforeFront}
                  alt={`${item.title} before — front`}
                  label="Before — Front"
                  onOpen={setActiveMedia}
                />
                <GalleryImageCard
                  src={item.afterFront}
                  alt={`${item.title} after — front`}
                  label="After — Front"
                  onOpen={setActiveMedia}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <GalleryImageCard
                  src={item.beforeBack}
                  alt={`${item.title} before — back`}
                  label="Before — Back"
                  onOpen={setActiveMedia}
                />
                <GalleryImageCard
                  src={item.afterBack}
                  alt={`${item.title} after — back`}
                  label="After — Back"
                  onOpen={setActiveMedia}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <GalleryVideoCard
                  src={item.beforeFrontVideo}
                  poster={item.beforeFront}
                  label="Before — Front (Video)"
                  onOpen={setActiveMedia}
                />
                <GalleryVideoCard
                  src={item.afterFrontVideo}
                  poster={item.afterFront}
                  label="After — Front (Video)"
                  onOpen={setActiveMedia}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <GalleryVideoCard
                  src={item.beforeBackVideo}
                  poster={item.beforeBack}
                  label="Before — Back (Video)"
                  onOpen={setActiveMedia}
                />
                <GalleryVideoCard
                  src={item.afterBackVideo}
                  poster={item.afterBack}
                  label="After — Back (Video)"
                  onOpen={setActiveMedia}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {activeMedia && (
        <GalleryLightbox media={activeMedia} onClose={closeLightbox} />
      )}
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FALLBACK_GALLERY_ITEMS,
  fetchPublishedGalleryItems,
} from "@/lib/gallery";
import GalleryImage from "@/components/GalleryImage";

const FEATURED_COUNT = 3;

function featuredPair(item) {
  const pairs = item.pairs ?? [];
  return (
    pairs.find(
      (pair) =>
        (pair.type ?? pair.mediaKind) === "image" && pair.before && pair.after,
    ) ?? null
  );
}

function Side({ src, label, title, variant = "cozy" }) {
  const isMarketing = variant === "marketing";

  return (
    <div className="space-y-1.5">
      <div
        className={`relative aspect-[3/4] w-full overflow-hidden bg-night/20 ${
          isMarketing ? "rounded-sm ring-1 ring-ink/10" : "rounded-lg"
        }`}
      >
        <GalleryImage
          src={src}
          width={480}
          alt={`${title} ${label.toLowerCase()}`}
          sizes="(max-width: 640px) 45vw, 160px"
          className="object-cover"
        />
      </div>
      <p
        className={
          isMarketing
            ? "text-center font-mono text-[9px] uppercase tracking-[0.2em] text-ink/45"
            : "text-center text-[0.65rem] font-bold uppercase tracking-wide text-ink/60"
        }
      >
        {label}
      </p>
    </div>
  );
}

function GalleryCard({ item, pair, index, variant = "cozy" }) {
  const isMarketing = variant === "marketing";

  return (
    <Link
      href="/gallery"
      className={`block transition duration-200 ease-out sm:hover:-translate-y-0.5 ${
        isMarketing
          ? "w-[min(78vw,20rem)] shrink-0 snap-start sm:w-auto"
          : "pixel-border rounded-2xl border-blush/10 bg-cream/60 p-4 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)]"
      } ${!isMarketing && index === 2 ? "hidden sm:block" : ""}`}
    >
      <div className={`grid grid-cols-2 ${isMarketing ? "gap-2.5" : "gap-2"}`}>
        <Side
          src={pair.before}
          label="Before"
          title={item.title}
          variant={variant}
        />
        <Side
          src={pair.after}
          label="After"
          title={item.title}
          variant={variant}
        />
      </div>
      <h3
        className={`mt-3 truncate text-center text-ink ${
          isMarketing ? "text-sm font-medium" : "font-display text-base font-bold"
        }`}
      >
        {item.title}
      </h3>
      {item.setName ? (
        <p
          className={`mt-0.5 truncate text-center ${
            isMarketing
              ? "font-mono text-[10px] uppercase tracking-[0.12em] text-ink/40"
              : "text-xs text-ink/55"
          }`}
        >
          {item.setName}
        </p>
      ) : null}
    </Link>
  );
}

export default function FeaturedRestorations({ variant = "cozy" }) {
  const isMarketing = variant === "marketing";
  const [items, setItems] = useState(FALLBACK_GALLERY_ITEMS);

  useEffect(() => {
    let cancelled = false;
    fetchPublishedGalleryItems().then((remote) => {
      if (!cancelled && remote && remote.length > 0) setItems(remote);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const featured = items
    .map((item) => ({ item, pair: featuredPair(item) }))
    .filter((entry) => entry.pair !== null)
    .slice(0, FEATURED_COUNT);

  if (featured.length === 0) return null;

  return (
    <div className="space-y-6">
      <div
        className={
          isMarketing
            ? "-mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-8 sm:overflow-visible sm:px-0 sm:pb-0"
            : "grid gap-4 sm:grid-cols-3"
        }
      >
        {featured.map(({ item, pair }, index) => (
          <GalleryCard
            key={item.id ?? item.title}
            item={item}
            pair={pair}
            index={index}
            variant={variant}
          />
        ))}
      </div>
      <p className="text-center">
        <Link
          href="/gallery"
          className={
            isMarketing
              ? "font-mono text-[11px] uppercase tracking-[0.22em] text-ink/50 underline-offset-4 transition hover:text-ink hover:underline"
              : "text-sm font-semibold text-blush transition hover:text-ink hover:underline"
          }
        >
          View the full gallery →
        </Link>
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FALLBACK_GALLERY_ITEMS,
  fetchPublishedGalleryItems,
} from "@/lib/gallery";
import GalleryImage from "@/components/GalleryImage";

const FEATURED_COUNT = 3;

// Prefer a photo pair with both sides so the strip always shows a true
// before/after comparison.
function featuredPair(item) {
  const pairs = item.pairs ?? [];
  return (
    pairs.find(
      (pair) =>
        (pair.type ?? pair.mediaKind) === "image" && pair.before && pair.after,
    ) ?? null
  );
}

function Side({ src, label, title }) {
  return (
    <div className="space-y-1.5">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-night/20">
        <GalleryImage
          src={src}
          width={480}
          alt={`${title} ${label.toLowerCase()}`}
          sizes="(max-width: 640px) 45vw, 160px"
          className="object-cover"
        />
      </div>
      <p className="text-center text-[0.65rem] font-bold uppercase tracking-wide text-ink/60">
        {label}
      </p>
    </div>
  );
}

/**
 * Home page strip of the latest gallery restorations. Renders the static
 * fallback items immediately and swaps in published Supabase rows when they
 * load, mirroring the Gallery page's data source.
 */
export default function FeaturedRestorations() {
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
      <div className="grid gap-4 sm:grid-cols-3">
        {featured.map(({ item, pair }, index) => (
          <Link
            key={item.id ?? item.title}
            href="/gallery"
            className={`pixel-border rounded-2xl border-blush/10 bg-cream/60 p-4 transition-all duration-200 ease-out sm:hover:-translate-y-1 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)] ${
              index === 2 ? "hidden sm:block" : ""
            }`}
          >
            <div className="grid grid-cols-2 gap-2">
              <Side src={pair.before} label="Before" title={item.title} />
              <Side src={pair.after} label="After" title={item.title} />
            </div>
            <h3 className="mt-3 truncate text-center font-display text-base font-bold text-ink">
              {item.title}
            </h3>
            {item.setName ? (
              <p className="mt-0.5 truncate text-center text-xs text-ink/55">
                {item.setName}
              </p>
            ) : null}
          </Link>
        ))}
      </div>
      <p className="text-center">
        <Link
          href="/gallery"
          className="text-sm font-semibold text-blush transition hover:text-ink hover:underline"
        >
          View the full gallery →
        </Link>
      </p>
    </div>
  );
}

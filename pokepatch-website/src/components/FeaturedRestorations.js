"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FALLBACK_GALLERY_ITEMS,
  fetchPublishedGalleryItems,
  galleryItemHref,
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

function Side({ src, label, title }) {
  return (
    <div className="space-y-1.5">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-sm bg-night/20 ring-1 ring-ink/10">
        <GalleryImage
          src={src}
          width={480}
          alt={`${title} ${label.toLowerCase()}`}
          sizes="(max-width: 640px) 45vw, 160px"
          className="object-cover"
        />
      </div>
      <p className="text-center font-mono text-[9px] uppercase tracking-[0.2em] text-ink/45">
        {label}
      </p>
    </div>
  );
}

function GalleryCard({ item, pair }) {
  return (
    <Link
      href={galleryItemHref(item)}
      className="block w-[min(78vw,20rem)] shrink-0 snap-start transition duration-200 ease-out sm:w-auto sm:hover:-translate-y-0.5"
    >
      <div className="grid grid-cols-2 gap-2.5">
        <Side src={pair.before} label="Before" title={item.title} />
        <Side src={pair.after} label="After" title={item.title} />
      </div>
      <h3 className="mt-3 truncate text-center text-sm font-medium text-ink">
        {item.title}
      </h3>
      {item.setName ? (
        <p className="mt-0.5 truncate text-center font-mono text-[10px] uppercase tracking-[0.12em] text-ink/40">
          {item.setName}
        </p>
      ) : null}
    </Link>
  );
}

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
      <div className="-mx-4 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-8 sm:overflow-visible sm:px-0 sm:pb-0">
        {featured.map(({ item, pair }) => (
          <GalleryCard
            key={item.id ?? item.title}
            item={item}
            pair={pair}
          />
        ))}
      </div>
      <p className="text-center">
        <Link
          href="/gallery"
          className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink/50 underline-offset-4 transition hover:text-ink hover:underline"
        >
          View the full gallery →
        </Link>
      </p>
    </div>
  );
}

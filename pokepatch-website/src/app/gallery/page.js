"use client";

import { useEffect, useState } from "react";
import SectionHeading from "@/components/SectionHeading";
import GalleryContent from "@/components/GalleryContent";
import {
  FALLBACK_GALLERY_ITEMS,
  fetchPublishedGalleryItems,
} from "@/lib/gallery";

export default function GalleryPage() {
  const [items, setItems] = useState(FALLBACK_GALLERY_ITEMS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const remote = await fetchPublishedGalleryItems();
      if (cancelled) return;

      // Prefer DB rows when any published items exist.
      // Fall back to static assets so the page still works before migration.
      if (remote && remote.length > 0) {
        setItems(remote);
      } else {
        setItems(FALLBACK_GALLERY_ITEMS);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="animate-fade-up">
        <SectionHeading subtitle="Real restorations from our workshop.">
          Gallery
        </SectionHeading>
      </div>

      {loading ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center justify-center gap-3 py-16"
        >
          <div
            aria-hidden="true"
            className="h-10 w-10 animate-spin rounded-full border-4 border-ink/15 border-t-berry border-r-blush"
          />
          <p className="text-sm font-semibold text-ink/70">Loading gallery…</p>
        </div>
      ) : (
        <GalleryContent items={items} />
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import SectionHeading from "@/components/SectionHeading";
import GalleryContent from "@/components/GalleryContent";
import LoadingSpinner from "@/components/LoadingSpinner";
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
        <LoadingSpinner label="Loading gallery…" />
      ) : (
        <GalleryContent items={items} />
      )}
    </div>
  );
}

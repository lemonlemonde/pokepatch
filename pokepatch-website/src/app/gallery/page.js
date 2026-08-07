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
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12 md:py-16">
      <SectionHeading
        note="Gallery"
        subtitle="Real before-and-afters from the bench."
      >
        Restored work
      </SectionHeading>

      {loading ? (
        <LoadingSpinner label="Loading gallery…" />
      ) : (
        <GalleryContent items={items} />
      )}
    </div>
  );
}

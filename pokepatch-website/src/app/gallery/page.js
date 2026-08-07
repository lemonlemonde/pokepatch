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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const remote = await fetchPublishedGalleryItems();
      if (cancelled) return;

      if (remote && remote.length > 0) {
        setItems(remote);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12 md:py-16">
      <SectionHeading
        as="h1"
        note="Gallery"
        subtitle="Real before-and-afters from the bench."
      >
        Restored work
      </SectionHeading>

      <GalleryContent items={items} />
    </div>
  );
}

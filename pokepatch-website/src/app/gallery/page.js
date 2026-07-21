"use client";

import SectionHeading from "@/components/SectionHeading";
import InstagramEmbedGrid from "@/components/InstagramEmbedGrid";
import { INSTAGRAM_GALLERY_ITEMS } from "@/lib/instagramGallery";

export default function GalleryPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="animate-fade-up">
        <SectionHeading subtitle="Restorations and updates from @pokepatch.cards.">
          Gallery
        </SectionHeading>
      </div>

      <div className="animate-fade-up" style={{ animationDelay: "80ms" }}>
        <InstagramEmbedGrid items={INSTAGRAM_GALLERY_ITEMS} />
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Image from "next/image";
import { galleryThumbPublicUrl } from "@/lib/gallery";

/**
 * Gallery still for list/grid UI. Prefers the stored .thumb.webp sibling
 * (no Supabase Image Transformations). Falls back to the full URL if the
 * thumb is missing (legacy objects before backfill).
 */
export default function GalleryImage({
  src,
  width,
  alt,
  sizes,
  priority = false,
  className = "",
}) {
  const [loaded, setLoaded] = useState(false);
  const [useOriginal, setUseOriginal] = useState(false);
  // width kept for call-site compatibility; thumbs are pre-sized at upload.
  void width;
  const thumbSrc = galleryThumbPublicUrl(src) || src;
  const displaySrc = useOriginal ? src : thumbSrc;

  return (
    <Image
      src={displaySrc}
      alt={alt}
      fill
      priority={priority}
      sizes={sizes}
      onLoad={() => setLoaded(true)}
      onError={() => {
        if (!useOriginal && displaySrc !== src) {
          setLoaded(false);
          setUseOriginal(true);
        }
      }}
      className={`${className} transition-opacity duration-300 ${
        loaded ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

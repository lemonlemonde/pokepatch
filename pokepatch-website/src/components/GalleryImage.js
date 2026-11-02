"use client";

import { useState } from "react";
import Image from "next/image";
import { galleryThumbPublicUrl } from "@/lib/gallery";

/**
 * Gallery still for list/grid UI. Requires the stored `.thumb.webp` sibling
 * (no Supabase Image Transformations, no full-object fallback).
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
  // width kept for call-site compatibility; thumbs are pre-sized at upload.
  void width;
  const thumbSrc = galleryThumbPublicUrl(src);
  if (!thumbSrc) return null;

  return (
    <Image
      src={thumbSrc}
      alt={alt}
      fill
      priority={priority}
      sizes={sizes}
      onLoad={() => setLoaded(true)}
      className={`${className} transition-opacity duration-300 ${
        loaded ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

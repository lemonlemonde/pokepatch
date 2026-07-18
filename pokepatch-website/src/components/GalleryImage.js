"use client";

import { useState } from "react";
import Image from "next/image";
import { galleryImageUrl } from "@/lib/gallery";

// Renders a Supabase gallery image resized via the transform endpoint, falling
// back to the original URL if the transform fails (e.g. source too large to
// process). Fades in once loaded to smooth the lazy-load pop-in.
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
  const displaySrc = useOriginal ? src : galleryImageUrl(src, { width });

  return (
    <Image
      src={displaySrc}
      alt={alt}
      fill
      priority={priority}
      sizes={sizes}
      onLoad={() => setLoaded(true)}
      onError={() => {
        if (!useOriginal) {
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

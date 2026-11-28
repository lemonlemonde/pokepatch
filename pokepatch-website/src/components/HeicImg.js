"use client";

import { useEffect, useState } from "react";
import { isHeicLikeSrc, needsHeicDecode } from "@/lib/heicDetect";

/**
 * <img> that converts HEIC/HEIF sources to JPEG so Chrome/Firefox can show
 * customer iPhone photos. Non-HEIC src is passed through unchanged.
 */
export default function HeicImg({ src, alt = "", onError, ...props }) {
  const [converted, setConverted] = useState({ src: null, url: null });

  useEffect(() => {
    if (!src || !isHeicLikeSrc(src)) return undefined;
    let cancelled = false;
    let created = null;

    (async () => {
      try {
        const { heicSrcToObjectUrl } = await import("@/lib/heic");
        const url = await heicSrcToObjectUrl(src);
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        if (!url) return;
        created = url;
        setConverted({ src, url });
      } catch {
        // img onError handles display failure
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);

  const resolved = isHeicLikeSrc(src)
    ? converted.src === src
      ? converted.url
      : null
    : src;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} src={resolved || undefined} alt={alt} onError={onError} />
  );
}

/**
 * Object URLs for `{ file }` items. HEIC files are converted so list
 * previews work outside Safari.
 */
export function useFilePreviewUrls(items) {
  const [previews, setPreviews] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const created = [];
    const list = items ?? [];

    (async () => {
      const next = [];
      for (const item of list) {
        const file = item?.file ?? item;
        const url = (await needsHeicDecode(file))
          ? await (await import("@/lib/heic")).createPreviewObjectUrl(file)
          : file
            ? URL.createObjectURL(file)
            : null;
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        if (url) created.push(url);
        next.push(url);
      }
      if (!cancelled) setPreviews(next);
    })();

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [items]);

  return previews;
}

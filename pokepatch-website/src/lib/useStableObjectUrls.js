"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Object URLs for a list of `{ id, file }` items, kept stable per id.
 *
 * Rebuilding every URL whenever the array identity changes — which happens
 * on any edit, e.g. committing a crop — swaps every `<img src>` in the tree.
 * The browser then reloads each image, so thumbnails visibly flicker and any
 * state keyed on `src` (natural size, and therefore aspect ratio) resets.
 *
 * Here a URL is created only for ids that are new and revoked only for ids
 * that went away, so editing one item leaves every other item's src
 * untouched. Remaining URLs are revoked on unmount.
 */
export default function useStableObjectUrls(items) {
  const [urls, setUrls] = useState({});
  const urlsRef = useRef(urls);
  urlsRef.current = urls;

  useEffect(() => {
    const ids = new Set(items.map((item) => item.id));
    setUrls((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const [id, url] of Object.entries(prev)) {
        if (!ids.has(id)) {
          URL.revokeObjectURL(url);
          delete next[id];
          changed = true;
        }
      }

      for (const item of items) {
        if (!next[item.id] && item.file) {
          next[item.id] = URL.createObjectURL(item.file);
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [items]);

  useEffect(() => {
    return () => {
      Object.values(urlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  return urls;
}

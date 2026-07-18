"use client";

import { useRef, useState } from "react";
import MediaLightbox from "@/components/MediaLightbox";

/**
 * Click a studio thumbnail to open the same MediaLightbox as the Gallery.
 * Ignores click-after-drag so drag-and-drop still works.
 */
export default function StudioOpenableThumb({
  src,
  alt,
  label,
  mediaType = "image",
  className = "",
  children,
}) {
  const [open, setOpen] = useState(false);
  const movedRef = useRef(false);
  const originRef = useRef({ x: 0, y: 0 });

  function handlePointerDown(event) {
    movedRef.current = false;
    originRef.current = { x: event.clientX, y: event.clientY };
  }

  function handlePointerMove(event) {
    const dx = event.clientX - originRef.current.x;
    const dy = event.clientY - originRef.current.y;
    if (dx * dx + dy * dy > 36) movedRef.current = true;
  }

  function handleClick(event) {
    event.stopPropagation();
    if (movedRef.current || !src) return;
    setOpen(true);
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (src) setOpen(true);
          }
        }}
        className={`cursor-zoom-in ${className}`}
        aria-label={`Enlarge ${label || alt}`}
      >
        {children}
      </div>

      {open && src ? (
        <MediaLightbox
          media={{
            type: mediaType === "video" ? "video" : "image",
            src,
            alt: alt || label || "",
            label: label || alt || "",
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

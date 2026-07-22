"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MediaLightbox, {
  LIGHTBOX_MEDIA_CLASSNAME,
} from "@/components/MediaLightbox";
import { canvasToBlob } from "@/lib/instagramStitch";

const HANDLE_SIZE = 10;
const MIN_NORM = 0.05;
const DEFAULT_CROP = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

const ASPECT_OPTIONS = [
  { id: "free", label: "Free", ratio: null },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "1:1", label: "1:1", ratio: 1 },
];

const HANDLES = [
  { id: "nw", cursor: "nwse-resize" },
  { id: "n", cursor: "ns-resize" },
  { id: "ne", cursor: "nesw-resize" },
  { id: "e", cursor: "ew-resize" },
  { id: "se", cursor: "nwse-resize" },
  { id: "s", cursor: "ns-resize" },
  { id: "sw", cursor: "nesw-resize" },
  { id: "w", cursor: "ew-resize" },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampCrop(crop) {
  let { x, y, w, h } = crop;
  w = clamp(w, MIN_NORM, 1);
  h = clamp(h, MIN_NORM, 1);
  x = clamp(x, 0, 1 - w);
  y = clamp(y, 0, 1 - h);
  return { x, y, w, h };
}

function fitCropToAspect(crop, ratio, imageAspect) {
  if (!ratio || !imageAspect) return clampCrop(crop);
  // Crop box is in image-normalized space; visual aspect = (w*imgW)/(h*imgH) = (w/h)*imageAspect
  // Want visualAspect = ratio ⇒ w/h = ratio / imageAspect
  const targetWh = ratio / imageAspect;
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  let w = crop.w;
  let h = w / targetWh;
  if (h > 1) {
    h = 1;
    w = h * targetWh;
  }
  if (w > 1) {
    w = 1;
    h = w / targetWh;
  }
  return clampCrop({
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
  });
}

function handlePosition(crop, handleId) {
  const { x, y, w, h } = crop;
  switch (handleId) {
    case "nw":
      return { x, y };
    case "n":
      return { x: x + w / 2, y };
    case "ne":
      return { x: x + w, y };
    case "e":
      return { x: x + w, y: y + h / 2 };
    case "se":
      return { x: x + w, y: y + h };
    case "s":
      return { x: x + w / 2, y: y + h };
    case "sw":
      return { x, y: y + h };
    case "w":
      return { x, y: y + h / 2 };
    default:
      return { x, y };
  }
}

function resizeCrop(origin, handleId, nx, ny, aspectRatio, imageAspect) {
  let { x, y, w, h } = origin;
  const right = x + w;
  const bottom = y + h;

  if (handleId.includes("w")) {
    x = clamp(nx, 0, right - MIN_NORM);
    w = right - x;
  }
  if (handleId.includes("e")) {
    w = clamp(nx - x, MIN_NORM, 1 - x);
  }
  if (handleId.includes("n")) {
    y = clamp(ny, 0, bottom - MIN_NORM);
    h = bottom - y;
  }
  if (handleId.includes("s")) {
    h = clamp(ny - y, MIN_NORM, 1 - y);
  }

  if (aspectRatio && imageAspect) {
    const targetWh = aspectRatio / imageAspect;
    const cx = x + w / 2;
    const cy = y + h / 2;
    if (handleId === "n" || handleId === "s") {
      w = h * targetWh;
      x = cx - w / 2;
    } else if (handleId === "e" || handleId === "w") {
      h = w / targetWh;
      y = cy - h / 2;
    } else {
      // Corner: keep the dragged corner, adjust the other dimension
      h = w / targetWh;
      if (handleId.includes("n")) y = bottom - h;
      if (handleId.includes("w")) {
        /* x already set */
      }
    }
  }

  return clampCrop({ x, y, w, h });
}

function getImageContentMetrics(img) {
  if (!img) return null;
  const rect = img.getBoundingClientRect();
  const width = img.clientWidth;
  const height = img.clientHeight;
  if (width <= 0 || height <= 0) return null;
  return {
    left: rect.left + img.clientLeft,
    top: rect.top + img.clientTop,
    width,
    height,
    offsetLeft: img.offsetLeft + img.clientLeft,
    offsetTop: img.offsetTop + img.clientTop,
  };
}

export async function cropImageToBlob(imageUrl, crop, mimeType = "image/jpeg") {
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image for crop"));
    image.src = imageUrl;
  });

  const sx = Math.round(crop.x * img.naturalWidth);
  const sy = Math.round(crop.y * img.naturalHeight);
  const sw = Math.max(1, Math.round(crop.w * img.naturalWidth));
  const sh = Math.max(1, Math.round(crop.h * img.naturalHeight));

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  const type = mimeType.startsWith("image/") ? mimeType : "image/jpeg";
  if (type === "image/png") {
    return canvasToBlob(canvas);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to export cropped image"));
      },
      type,
      0.95,
    );
  });
}

function CropSurface({ src, alt, crop, onCropChange, aspectRatio }) {
  const surfaceRef = useRef(null);
  const imageRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [imageAspect, setImageAspect] = useState(null);
  const [contentBox, setContentBox] = useState({
    offsetLeft: 0,
    offsetTop: 0,
    width: 0,
    height: 0,
  });

  const updateContentBox = useCallback(() => {
    const img = imageRef.current;
    const metrics = getImageContentMetrics(img);
    if (!metrics) return;
    setContentBox({
      offsetLeft: metrics.offsetLeft,
      offsetTop: metrics.offsetTop,
      width: metrics.width,
      height: metrics.height,
    });
    if (img?.naturalWidth && img?.naturalHeight) {
      setImageAspect(img.naturalWidth / img.naturalHeight);
    }
  }, []);

  useEffect(() => {
    const img = imageRef.current;
    if (!img) return undefined;
    updateContentBox();
    const observer = new ResizeObserver(() => updateContentBox());
    observer.observe(img);
    img.addEventListener("load", updateContentBox);
    return () => {
      observer.disconnect();
      img.removeEventListener("load", updateContentBox);
    };
  }, [src, updateContentBox]);

  useEffect(() => {
    if (!aspectRatio || !imageAspect) return;
    onCropChange((prev) => fitCropToAspect(prev, aspectRatio, imageAspect));
    // Only re-fit when aspect preset or natural image ratio changes — not on every crop drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [aspectRatio, imageAspect]);

  const clientToNormalized = useCallback((clientX, clientY) => {
    const metrics = getImageContentMetrics(imageRef.current);
    if (!metrics) return null;
    return {
      x: clamp((clientX - metrics.left) / metrics.width, 0, 1),
      y: clamp((clientY - metrics.top) / metrics.height, 0, 1),
    };
  }, []);

  function onPointerDownMove(event) {
    if (event.button !== 0) return;
    const point = clientToNormalized(event.clientX, event.clientY);
    if (!point) return;
    setDrag({
      mode: "move",
      startX: point.x,
      startY: point.y,
      origin: { ...crop },
    });
    surfaceRef.current?.setPointerCapture(event.pointerId);
  }

  function onPointerDownHandle(event, handleId) {
    event.stopPropagation();
    if (event.button !== 0) return;
    const point = clientToNormalized(event.clientX, event.clientY);
    if (!point) return;
    setDrag({
      mode: "resize",
      handleId,
      origin: { ...crop },
    });
    surfaceRef.current?.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag) return;
    const point = clientToNormalized(event.clientX, event.clientY);
    if (!point) return;

    if (drag.mode === "move") {
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      onCropChange(
        clampCrop({
          ...drag.origin,
          x: drag.origin.x + dx,
          y: drag.origin.y + dy,
        }),
      );
      return;
    }

    onCropChange(
      resizeCrop(
        drag.origin,
        drag.handleId,
        point.x,
        point.y,
        // Shift locks to the original image aspect (overrides Free / presets).
        event.shiftKey ? imageAspect : aspectRatio,
        imageAspect,
      ),
    );
  }

  function onPointerUp(event) {
    if (!drag) return;
    setDrag(null);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
  }

  const overlayStyle = {
    left: contentBox.offsetLeft,
    top: contentBox.offsetTop,
    width: contentBox.width,
    height: contentBox.height,
  };

  return (
    <div
      ref={surfaceRef}
      className="relative inline-block max-w-full touch-none select-none"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        draggable={false}
        className={LIGHTBOX_MEDIA_CLASSNAME}
      />
      {contentBox.width > 0 ? (
        <div className="absolute" style={overlayStyle}>
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d={`M0 0H1V1H0Z M${crop.x} ${crop.y}H${crop.x + crop.w}V${crop.y + crop.h}H${crop.x}Z`}
              fill="rgba(0,0,0,0.55)"
              fillRule="evenodd"
            />
            <rect
              x={crop.x}
              y={crop.y}
              width={crop.w}
              height={crop.h}
              fill="none"
              stroke="#f3e9f2"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <button
            type="button"
            aria-label="Move crop"
            className="absolute cursor-move"
            style={{
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${crop.w * 100}%`,
              height: `${crop.h * 100}%`,
            }}
            onPointerDown={onPointerDownMove}
          />
          {HANDLES.map((handle) => {
            const pos = handlePosition(crop, handle.id);
            return (
              <button
                key={handle.id}
                type="button"
                aria-label={`Resize ${handle.id}`}
                className="absolute rounded-sm border-2 border-cream bg-berry shadow-sm"
                style={{
                  width: HANDLE_SIZE,
                  height: HANDLE_SIZE,
                  left: `${pos.x * 100}%`,
                  top: `${pos.y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  cursor: handle.cursor,
                }}
                onPointerDown={(event) => onPointerDownHandle(event, handle.id)}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Lightbox crop editor for a studio slot image.
 * Call onApply(blob) when the user confirms the crop.
 */
export default function StudioCropLightbox({
  src,
  alt,
  label,
  originalFile,
  onClose,
  onApply,
}) {
  const [crop, setCrop] = useState(DEFAULT_CROP);
  const [aspectId, setAspectId] = useState("free");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const aspectRatio =
    ASPECT_OPTIONS.find((option) => option.id === aspectId)?.ratio ?? null;

  async function handleApply() {
    setBusy(true);
    setError("");
    try {
      const mimeType = originalFile?.type || "image/jpeg";
      const blob = await cropImageToBlob(src, crop, mimeType);
      await onApply(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Crop failed.");
      setBusy(false);
    }
  }

  return (
    <MediaLightbox
      media={{
        type: "image",
        src,
        alt: alt || label || "",
        label: label || alt || "",
      }}
      onClose={onClose}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <p className="font-secondary text-sm text-ink/60">Aspect</p>
          <div className="inline-flex rounded-xl border border-ink/20 bg-night/40 p-1">
            {ASPECT_OPTIONS.map((option) => {
              const active = aspectId === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAspectId(option.id)}
                  className={`rounded-lg px-3 py-1.5 font-secondary text-sm font-semibold transition ${
                    active
                      ? "bg-berry text-night shadow-cozy-sm"
                      : "text-ink/70 hover:text-ink"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <CropSurface
          src={src}
          alt={alt || label || ""}
          crop={crop}
          onCropChange={setCrop}
          aspectRatio={aspectRatio}
        />

        <p className="text-center text-xs text-ink/50">
          Drag the box to move · drag handles to resize · hold Shift for original aspect
        </p>

        {error ? (
          <p className="text-center text-sm text-berry">{error}</p>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-ink/20 bg-night/50 px-5 py-2.5 font-semibold text-ink transition hover:border-berry/40 hover:bg-night/70"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleApply}
            className="rounded-xl bg-berry px-5 py-2.5 font-semibold text-night shadow-cozy transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? "Cropping…" : "Apply crop"}
          </button>
        </div>
      </div>
    </MediaLightbox>
  );
}

/**
 * Slot thumbnail that opens a crop lightbox on click (drag still works).
 */
export function StudioCroppableThumb({
  src,
  alt,
  label,
  originalFile,
  className = "",
  children,
  onCropped,
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

  async function handleApply(blob) {
    const baseName = (originalFile?.name || "image").replace(/\.[^.]+$/, "");
    const ext =
      blob.type === "image/png"
        ? "png"
        : blob.type === "image/webp"
          ? "webp"
          : "jpg";
    const file = new File([blob], `${baseName}-crop.${ext}`, {
      type: blob.type || "image/jpeg",
    });
    await onCropped(file);
    setOpen(false);
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
        aria-label={`Crop ${label || alt}`}
      >
        {children}
      </div>

      {open && src ? (
        <StudioCropLightbox
          src={src}
          alt={alt}
          label={label}
          originalFile={originalFile}
          onClose={() => setOpen(false)}
          onApply={handleApply}
        />
      ) : null}
    </>
  );
}

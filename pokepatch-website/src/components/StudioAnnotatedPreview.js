"use client";

import { useEffect, useId, useState } from "react";
import MediaLightbox from "@/components/MediaLightbox";
import {
  SHAPE_STROKE,
  HANDLE_SIZE,
  HANDLES,
  shapeRotation,
  shapeStrokeWidth,
  handlePosition,
  rotateHandlePosition,
} from "@/lib/shapeAnnotations";

export function ShapeToolbar({ selectedId, onAdd, onDelete, className = "" }) {
  return (
    <div
      className={`flex max-w-full flex-wrap items-center justify-center gap-2 ${className}`}
      role="toolbar"
      aria-label="Shape tools"
    >
      <button
        type="button"
        onClick={() => onAdd("circle")}
        className="rounded-lg border border-ink/20 bg-ink/10 px-3 py-1.5 font-secondary text-xs font-semibold text-ink transition hover:bg-ink/20"
      >
        Add circle
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={!selectedId}
        className="rounded-lg border border-ink/20 bg-ink/10 px-3 py-1.5 font-secondary text-xs font-semibold text-ink transition hover:bg-ink/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Delete selected
      </button>
    </div>
  );
}

/**
 * Renders annotation shapes into an SVG whose viewBox is the shared
 * authoring frame, so on-screen stroke weight matches the baked output.
 * Shape coords are normalized 0–1 against that frame.
 */
export function ShapesLayer({ shapes, selectedId, viewW, viewH }) {
  return (
    <>
      {shapes.map((shape) => {
        const x = shape.x * viewW;
        const y = shape.y * viewH;
        const w = shape.w * viewW;
        const h = shape.h * viewH;
        const cx = x + w / 2;
        const cy = y + h / 2;
        const rotation = shapeRotation(shape);
        const strokeW =
          shapeStrokeWidth(shape) + (shape.id === selectedId ? 0.5 : 0);
        const transform = rotation
          ? `rotate(${rotation} ${cx} ${cy})`
          : undefined;
        const geometry =
          shape.type === "circle"
            ? { cx, cy, rx: w / 2, ry: h / 2 }
            : { x, y, width: w, height: h };
        const ShapeTag = shape.type === "circle" ? "ellipse" : "rect";
        return (
          <ShapeTag
            key={shape.id}
            {...geometry}
            fill="none"
            stroke={SHAPE_STROKE}
            strokeWidth={strokeW}
            strokeLinejoin="round"
            strokeLinecap="round"
            transform={transform}
          />
        );
      })}
    </>
  );
}

/**
 * Selection handles for the active shape: 8 resize handles plus a rotate
 * handle on a short leader line. Positioned in percentages over the frame.
 */
export function ShapeHandles({
  selected,
  aspect,
  rotating,
  onPointerDownHandle,
}) {
  if (!selected) return null;
  const rotatePos = rotateHandlePosition(selected, aspect);
  return (
    <>
      {HANDLES.map((handle) => {
        const pos = handlePosition(selected, handle.id, aspect);
        return (
          <button
            key={handle.id}
            type="button"
            aria-label={`Resize ${handle.id}`}
            className="pointer-events-auto absolute rounded-sm border-2 border-cream shadow-sm"
            style={{
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              left: `${pos.x * 100}%`,
              top: `${pos.y * 100}%`,
              transform: "translate(-50%, -50%)",
              cursor: handle.cursor,
              backgroundColor: SHAPE_STROKE,
            }}
            onPointerDown={(event) => onPointerDownHandle(event, handle.id)}
          />
        );
      })}
      <button
        type="button"
        aria-label="Rotate"
        className="pointer-events-auto absolute rounded-full border-2 border-cream shadow-sm"
        style={{
          width: HANDLE_SIZE + 2,
          height: HANDLE_SIZE + 2,
          left: `${rotatePos.x * 100}%`,
          top: `${rotatePos.y * 100}%`,
          transform: "translate(-50%, -50%)",
          cursor: rotating ? "grabbing" : "grab",
          backgroundColor: SHAPE_STROKE,
        }}
        onPointerDown={(event) => onPointerDownHandle(event, "rotate")}
      />
    </>
  );
}

/**
 * Studio output preview: click to enlarge in MediaLightbox (view-only).
 * Slot crop/annotate editing lives in StudioSlotEditor — not here.
 *
 * `children` render below the image (e.g. per-post alt text). Downloads are
 * handled by the parent (Download all finalized / package zip).
 */
export default function StudioAnnotatedPreview({
  label,
  url,
  filename,
  onExporterChange,
  children = null,
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();

  useEffect(() => {
    if (!onExporterChange) return undefined;
    onExporterChange(async () => {
      const blob = await fetch(url).then((res) => res.blob());
      return { blob, filename };
    });
    return () => onExporterChange(null);
  }, [onExporterChange, url, filename]);

  return (
    <div className="space-y-3">
      <p id={labelId} className="sr-only">
        Preview for {label}. Click to enlarge.
      </p>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto block cursor-zoom-in rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ink/50"
        aria-labelledby={labelId}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`${label} preview`}
          className="block max-w-full rounded-xl border border-ink/15"
        />
      </button>

      {children}

      {open ? (
        <MediaLightbox
          media={{
            type: "image",
            src: url,
            alt: `${label} preview`,
            label,
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

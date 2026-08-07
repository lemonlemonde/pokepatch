"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import MediaLightbox, {
  LIGHTBOX_MEDIA_CLASSNAME,
} from "@/components/MediaLightbox";
import { canvasToBlob } from "@/lib/instagramStitch";
import { INSTAGRAM_HEIGHT, INSTAGRAM_WIDTH } from "@/lib/studioLayout";
import { downloadBlob } from "@/lib/downloadFile";
import useShapeDrag from "@/lib/useShapeDrag";
import {
  SHAPE_STROKE,
  SHAPE_STROKE_WIDTH,
  STROKE_REFERENCE_WIDTH,
  HANDLE_SIZE,
  HANDLES,
  clamp,
  shapeRotation,
  createShape,
  drawShapesOnCanvas,
  handlePosition,
  rotateHandlePosition,
  getImageContentMetrics,
} from "@/lib/shapeAnnotations";

export async function compositeImageWithShapes(imageUrl, shapes) {
  // Nothing to draw — hand back the generated image untouched rather than
  // paying a full decode + re-encode on every package download.
  if (shapes.length === 0) {
    return fetch(imageUrl).then((res) => res.blob());
  }

  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load preview image"));
    image.src = imageUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || INSTAGRAM_WIDTH;
  canvas.height = img.naturalHeight || INSTAGRAM_HEIGHT;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  drawShapesOnCanvas(ctx, shapes, canvas.width, canvas.height);
  return canvasToBlob(canvas);
}

export function ShapeToolbar({ selectedId, onAdd, onDelete }) {
  return (
    <div
      className="mb-3 flex max-w-full flex-wrap items-center justify-center gap-2"
      role="toolbar"
      aria-label="Shape tools"
    >
      <button
        type="button"
        onClick={() => onAdd("rect")}
        className="rounded-lg border border-ink/20 bg-ink/10 px-3 py-1.5 font-secondary text-xs font-semibold text-ink transition hover:bg-ink/20"
      >
        Add rectangle
      </button>
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
          SHAPE_STROKE_WIDTH + (shape.id === selectedId ? 0.5 : 0);
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

export function ShapeSurface({
  url,
  alt,
  shapes,
  selectedId,
  interactive,
  imageClassName,
  onSelect,
  onShapesChange,
}) {
  const surfaceRef = useRef(null);
  const imageRef = useRef(null);
  const [contentBox, setContentBox] = useState({
    offsetLeft: 0,
    offsetTop: 0,
    width: 0,
    height: 0,
  });
  const aspect =
    contentBox.width > 0 && contentBox.height > 0
      ? contentBox.width / contentBox.height
      : 1;

  const updateContentBox = useCallback(() => {
    const metrics = getImageContentMetrics(imageRef.current);
    if (!metrics) return;
    setContentBox({
      offsetLeft: metrics.offsetLeft,
      offsetTop: metrics.offsetTop,
      width: metrics.width,
      height: metrics.height,
    });
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
  }, [url, imageClassName, updateContentBox]);

  const clientToNormalized = useCallback((clientX, clientY) => {
    const metrics = getImageContentMetrics(imageRef.current);
    if (!metrics) return null;
    return {
      x: clamp((clientX - metrics.left) / metrics.width, 0, 1),
      y: clamp((clientY - metrics.top) / metrics.height, 0, 1),
    };
  }, []);

  const drag = useShapeDrag({
    shapes,
    selectedId: interactive ? selectedId : null,
    aspect,
    clientToNormalized,
    surfaceRef,
    onSelect,
    onShapesChange,
  });

  const overlayStyle = {
    left: contentBox.offsetLeft,
    top: contentBox.offsetTop,
    width: contentBox.width,
    height: contentBox.height,
  };
  const viewW = STROKE_REFERENCE_WIDTH;
  const viewH = STROKE_REFERENCE_WIDTH / aspect;

  return (
    <div
      ref={surfaceRef}
      className={`relative inline-block max-w-full touch-none select-none ${
        interactive ? "" : "pointer-events-none"
      }`}
      onPointerDown={interactive ? drag.onPointerDownSurface : undefined}
      onPointerMove={interactive ? drag.onPointerMove : undefined}
      onPointerUp={interactive ? drag.onPointerUp : undefined}
      onPointerCancel={interactive ? drag.onPointerUp : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        src={url}
        alt={alt}
        draggable={false}
        className={imageClassName}
      />
      <svg
        className="pointer-events-none absolute overflow-visible"
        style={overlayStyle}
        viewBox={`0 0 ${viewW} ${viewH}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <ShapesLayer
          shapes={drag.liveShapes}
          selectedId={interactive ? selectedId : null}
          viewW={viewW}
          viewH={viewH}
        />
      </svg>

      {interactive && drag.selected && contentBox.width > 0 ? (
        <div className="pointer-events-none absolute" style={overlayStyle}>
          <ShapeHandles
            selected={drag.selected}
            aspect={aspect}
            rotating={drag.isRotating}
            onPointerDownHandle={drag.onPointerDownHandle}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Studio output preview: click to enlarge in MediaLightbox and edit shapes there.
 *
 * `children` render between the image and the download row (the per-post alt
 * text field); `extraActions` render alongside the download button.
 */
export default function StudioAnnotatedPreview({
  label,
  url,
  filename,
  onExporterChange,
  extraActions = null,
  children = null,
}) {
  const [shapes, setShapes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [open, setOpen] = useState(false);
  const labelId = useId();

  useEffect(() => {
    setShapes([]);
    setSelectedId(null);
    setOpen(false);
  }, [url]);

  useEffect(() => {
    if (!onExporterChange) return undefined;
    onExporterChange(async () => {
      const blob = await compositeImageWithShapes(url, shapes);
      return { blob, filename };
    });
    return () => onExporterChange(null);
  }, [onExporterChange, url, shapes, filename]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        selectedId &&
        !event.target.matches("input, textarea, select")
      ) {
        event.preventDefault();
        setShapes((prev) => prev.filter((shape) => shape.id !== selectedId));
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, selectedId]);

  function addShape(type) {
    const next = createShape(type, shapes.length);
    setShapes((prev) => [...prev, next]);
    setSelectedId(next.id);
  }

  function deleteSelected() {
    if (!selectedId) return;
    setShapes((prev) => prev.filter((shape) => shape.id !== selectedId));
    setSelectedId(null);
  }

  function closeLightbox() {
    setSelectedId(null);
    setOpen(false);
  }

  async function handleDownload() {
    const blob = await compositeImageWithShapes(url, shapes);
    downloadBlob(blob, filename);
  }

  return (
    <div className="space-y-3">
      <p id={labelId} className="sr-only">
        Preview for {label}. Click to enlarge and edit rectangles or circles.
      </p>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto block cursor-zoom-in rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-berry/50"
        aria-labelledby={labelId}
      >
        <ShapeSurface
          url={url}
          alt={`${label} preview`}
          shapes={shapes}
          selectedId={null}
          interactive={false}
          imageClassName="block max-w-full rounded-xl border border-ink/15 "
        />
      </button>

      <p className="text-center text-xs text-ink/50">
        Click image to enlarge and edit shapes
      </p>

      {children}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={handleDownload}
          className="inline-block rounded-xl border border-ink/20 bg-night/50 px-6 py-3 font-semibold text-ink transition hover:border-berry/40 hover:bg-night/70"
        >
          Download {label.toLowerCase()}
        </button>
        {extraActions}
      </div>

      {open ? (
        <MediaLightbox
          media={{
            type: "image",
            src: url,
            alt: `${label} preview`,
            label,
          }}
          onClose={closeLightbox}
          onEscape={() => {
            if (selectedId) setSelectedId(null);
            else closeLightbox();
          }}
        >
          <div className="flex flex-col items-center">
            <ShapeToolbar
              selectedId={selectedId}
              onAdd={addShape}
              onDelete={deleteSelected}
            />
            <ShapeSurface
              url={url}
              alt={`${label} preview`}
              shapes={shapes}
              selectedId={selectedId}
              interactive
              imageClassName={LIGHTBOX_MEDIA_CLASSNAME}
              onSelect={setSelectedId}
              onShapesChange={setShapes}
            />
          </div>
        </MediaLightbox>
      ) : null}
    </div>
  );
}

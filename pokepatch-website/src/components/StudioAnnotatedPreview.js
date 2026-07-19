"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import MediaLightbox, {
  LIGHTBOX_MEDIA_CLASSNAME,
} from "@/components/MediaLightbox";
import { canvasToBlob } from "@/lib/instagramStitch";
import { INSTAGRAM_HEIGHT, INSTAGRAM_WIDTH } from "@/lib/studioLayout";

const SHAPE_STROKE = "#f87171";
const SHAPE_STROKE_WIDTH = 3;
const DEFAULT_SIZE = 0.22;
const MIN_SIZE = 0.04;
const HANDLE_SIZE = 8;

function createId() {
  return `shape-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createShape(type, index = 0) {
  const offset = (index % 5) * 0.04;
  return {
    id: createId(),
    type,
    x: clamp(0.39 + offset, 0, 1 - DEFAULT_SIZE),
    y: clamp(0.39 + offset, 0, 1 - DEFAULT_SIZE),
    w: DEFAULT_SIZE,
    h: DEFAULT_SIZE,
  };
}

function normalizeShape(shape) {
  let { x, y, w, h } = shape;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  w = Math.max(MIN_SIZE, w);
  h = Math.max(MIN_SIZE, h);
  x = clamp(x, 0, 1 - w);
  y = clamp(y, 0, 1 - h);
  return { ...shape, x, y, w, h };
}

function hitTest(shape, nx, ny) {
  const { x, y, w, h, type } = shape;
  if (type === "circle") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2;
    const ry = h / 2;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (nx - cx) / rx;
    const dy = (ny - cy) / ry;
    return dx * dx + dy * dy <= 1;
  }
  return nx >= x && nx <= x + w && ny >= y && ny <= y + h;
}

function drawShapesOnCanvas(ctx, shapes, width, height) {
  ctx.save();
  ctx.lineWidth = Math.max(2, (SHAPE_STROKE_WIDTH * width) / 480);
  ctx.strokeStyle = SHAPE_STROKE;

  for (const shape of shapes) {
    const x = shape.x * width;
    const y = shape.y * height;
    const w = shape.w * width;
    const h = shape.h * height;

    ctx.beginPath();
    if (shape.type === "circle") {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.stroke();
  }

  ctx.restore();
}

export async function compositeImageWithShapes(imageUrl, shapes) {
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
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (shapes.length > 0) {
    drawShapesOnCanvas(ctx, shapes, canvas.width, canvas.height);
  }
  return canvasToBlob(canvas);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

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

function handlePosition(shape, handleId) {
  const { x, y, w, h } = shape;
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

function resizeFromHandle(shape, handleId, nx, ny, constrainSquare = false) {
  let { x, y, w, h } = shape;
  const right = x + w;
  const bottom = y + h;

  switch (handleId) {
    case "nw":
      x = nx;
      y = ny;
      w = right - nx;
      h = bottom - ny;
      break;
    case "n":
      y = ny;
      h = bottom - ny;
      break;
    case "ne":
      y = ny;
      w = nx - x;
      h = bottom - ny;
      break;
    case "e":
      w = nx - x;
      break;
    case "se":
      w = nx - x;
      h = ny - y;
      break;
    case "s":
      h = ny - y;
      break;
    case "sw":
      x = nx;
      w = right - nx;
      h = ny - y;
      break;
    case "w":
      x = nx;
      w = right - nx;
      break;
    default:
      break;
  }

  if (constrainSquare) {
    const isEdgeNS = handleId === "n" || handleId === "s";
    const isEdgeEW = handleId === "e" || handleId === "w";
    const size = isEdgeNS
      ? Math.abs(h)
      : isEdgeEW
        ? Math.abs(w)
        : Math.max(Math.abs(w), Math.abs(h));
    const signedW = w < 0 ? -size : size;
    const signedH = h < 0 ? -size : size;

    switch (handleId) {
      case "nw":
        x = right - signedW;
        y = bottom - signedH;
        w = signedW;
        h = signedH;
        break;
      case "ne":
        y = bottom - signedH;
        w = signedW;
        h = signedH;
        break;
      case "se":
        w = signedW;
        h = signedH;
        break;
      case "sw":
        x = right - signedW;
        w = signedW;
        h = signedH;
        break;
      case "n":
      case "s": {
        const midX = x + w / 2;
        w = size;
        h = signedH < 0 ? -size : size;
        x = midX - w / 2;
        if (handleId === "n") y = bottom - h;
        break;
      }
      case "e":
      case "w": {
        const midY = y + h / 2;
        h = size;
        w = signedW < 0 ? -size : size;
        y = midY - h / 2;
        if (handleId === "w") x = right - w;
        break;
      }
      default:
        break;
    }
  }

  return normalizeShape({ ...shape, x, y, w, h });
}

function ShapeToolbar({ selectedId, onAdd, onDelete }) {
  return (
    <div
      className="mb-3 flex flex-wrap items-center justify-center gap-2"
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

function ShapeSurface({
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
  const [drag, setDrag] = useState(null);
  const selected = shapes.find((shape) => shape.id === selectedId) ?? null;

  const clientToNormalized = useCallback((clientX, clientY) => {
    const el = surfaceRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1),
    };
  }, []);

  function onPointerDownSurface(event) {
    if (!interactive || event.button !== 0) return;
    const point = clientToNormalized(event.clientX, event.clientY);
    if (!point) return;

    for (let i = shapes.length - 1; i >= 0; i -= 1) {
      const shape = shapes[i];
      if (hitTest(shape, point.x, point.y)) {
        onSelect(shape.id);
        setDrag({
          mode: "move",
          id: shape.id,
          startX: point.x,
          startY: point.y,
          origin: { ...shape },
        });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }

    onSelect(null);
  }

  function onPointerDownHandle(event, handleId) {
    event.stopPropagation();
    if (!interactive || !selected || event.button !== 0) return;
    const point = clientToNormalized(event.clientX, event.clientY);
    if (!point) return;
    setDrag({
      mode: "resize",
      id: selected.id,
      handleId,
      origin: { ...selected },
    });
    surfaceRef.current?.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!interactive || !drag) return;
    const point = clientToNormalized(event.clientX, event.clientY);
    if (!point) return;

    onShapesChange((prev) =>
      prev.map((shape) => {
        if (shape.id !== drag.id) return shape;
        if (drag.mode === "move") {
          const dx = point.x - drag.startX;
          const dy = point.y - drag.startY;
          return normalizeShape({
            ...shape,
            x: drag.origin.x + dx,
            y: drag.origin.y + dy,
            w: drag.origin.w,
            h: drag.origin.h,
          });
        }
        return resizeFromHandle(
          drag.origin,
          drag.handleId,
          point.x,
          point.y,
          event.shiftKey,
        );
      }),
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

  return (
    <div
      ref={surfaceRef}
      className={`relative inline-block max-w-full touch-none select-none ${
        interactive ? "" : "pointer-events-none"
      }`}
      onPointerDown={onPointerDownSurface}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        draggable={false}
        className={imageClassName}
      />
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible rounded-xl"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {shapes.map((shape) => {
          const isSelected = interactive && shape.id === selectedId;
          const common = {
            fill: "none",
            stroke: SHAPE_STROKE,
            strokeWidth: isSelected ? 3.5 : SHAPE_STROKE_WIDTH,
            vectorEffect: "non-scaling-stroke",
          };
          return shape.type === "circle" ? (
            <ellipse
              key={shape.id}
              cx={shape.x + shape.w / 2}
              cy={shape.y + shape.h / 2}
              rx={shape.w / 2}
              ry={shape.h / 2}
              {...common}
            />
          ) : (
            <rect
              key={shape.id}
              x={shape.x}
              y={shape.y}
              width={shape.w}
              height={shape.h}
              {...common}
            />
          );
        })}
      </svg>

      {interactive && selected ? (
        <div className="pointer-events-none absolute inset-0">
          {HANDLES.map((handle) => {
            const pos = handlePosition(selected, handle.id);
            return (
              <button
                key={handle.id}
                type="button"
                aria-label={`Resize ${handle.id}`}
                className="pointer-events-auto absolute rounded-sm border-2 border-cream bg-[#f87171] shadow-sm"
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
 * Studio output preview: click to enlarge in MediaLightbox and edit shapes there.
 */
export default function StudioAnnotatedPreview({
  label,
  url,
  filename,
  onExporterChange,
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
          imageClassName="block max-w-full rounded-xl border border-ink/15 shadow-cozy-sm"
        />
      </button>

      <p className="text-center text-xs text-ink/50">
        Click image to enlarge and edit shapes
      </p>

      <button
        type="button"
        onClick={handleDownload}
        className="inline-block rounded-xl border border-ink/20 bg-night/50 px-6 py-3 font-semibold text-ink transition hover:border-berry/40 hover:bg-night/70"
      >
        Download {label.toLowerCase()}
      </button>

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

export { downloadBlob };

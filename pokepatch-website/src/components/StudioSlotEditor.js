"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MediaLightbox, {
  EDITOR_MEDIA_CLASSNAME,
  EDITOR_MEDIA_FIT_HEIGHT,
} from "@/components/MediaLightbox";
import {
  CROP_HANDLES,
  DEFAULT_CROP,
  clampCrop,
  cropHandlePosition,
  fitCropToAspect,
  isDefaultCrop,
  resizeCrop,
} from "@/lib/studioSlotImage";
import {
  ShapeHandles,
  ShapesLayer,
  ShapeToolbar,
} from "@/components/StudioAnnotatedPreview";
import useShapeDrag from "@/lib/useShapeDrag";
import {
  STROKE_REFERENCE_WIDTH,
  applyStrokeWidth,
  clamp,
  clampStrokeWidth,
  createShape,
  getImageContentMetrics,
  getSharedStrokeWidth,
} from "@/lib/shapeAnnotations";

const CROP_HANDLE_SIZE = 10;

/** Survives Crop ↔ Annotate remounts so aspect never flashes to 1:1. */
const naturalSizeCache = new Map();

/** Natural pixel dimensions of an image URL, once it has loaded. */
export function useNaturalSize(src) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!src || naturalSizeCache.has(src)) return undefined;
    let cancelled = false;
    const img = new Image();
    const commit = () => {
      if (cancelled || !img.naturalWidth || naturalSizeCache.has(src)) return;
      naturalSizeCache.set(src, {
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      setVersion((v) => v + 1);
    };
    img.onload = commit;
    img.src = src;
    // Cached decodes can be complete before onload is scheduled.
    if (img.complete) queueMicrotask(commit);
    return () => {
      cancelled = true;
    };
  }, [src]);

  void version; // re-render when cache fills after async decode
  if (!src) return null;
  return naturalSizeCache.get(src) ?? null;
}

/** Visual aspect (w/h) of the cropped region of an image. */
export function cropAspectRatio(crop, naturalSize) {
  if (!naturalSize) return 1;
  const c = clampCrop(crop ?? DEFAULT_CROP);
  const ratio = (c.w * naturalSize.width) / (c.h * naturalSize.height);
  return ratio > 0 ? ratio : 1;
}

/**
 * Renders just the cropped region of an image, plus its annotations, with no
 * canvas round-trip: the <img> is blown up by 1/crop.w and offset so only the
 * crop shows through an overflow-hidden box. Stays crisp, updates instantly
 * as the crop changes, and is the single source of truth for "what this slot
 * actually looks like" — used by slot thumbnails and as the backdrop of the
 * Annotate step.
 *
 * Shape coords are normalized against the cropped frame, so they map
 * directly onto this box.
 */
export function CroppedShapePreview({
  src,
  alt,
  crop,
  annotations = [],
  selectedId = null,
  /** CSS length capping the rendered height (e.g. "9rem", "68vh"). */
  fitHeight = null,
  className = "",
  innerRef = null,
  children = null,
  ...surfaceProps
}) {
  const naturalSize = useNaturalSize(src);
  const effectiveCrop = clampCrop(crop ?? DEFAULT_CROP);
  const aspect = cropAspectRatio(effectiveCrop, naturalSize);
  const viewW = STROKE_REFERENCE_WIDTH;
  const viewH = STROKE_REFERENCE_WIDTH / aspect;

  // Height comes from width ÷ aspect-ratio. A height cap is turned into an
  // *intrinsic* width (calc(fitHeight * aspect)) so the box does not depend
  // on parent width — Annotate used to collapse to the toolbar width when
  // Crop was `hidden` and the panel shrink-wrapped around the controls.
  // Do not also set a definite height: that overrides aspect-ratio and
  // stretches the absolutely-positioned image.
  const style = {
    aspectRatio: String(aspect),
    ...(fitHeight
      ? {
          width: `calc(${fitHeight} * ${aspect})`,
          maxWidth: "100%",
        }
      : { width: "100%" }),
  };

  return (
    <div
      ref={innerRef}
      className={`relative mx-auto overflow-hidden ${className}`}
      style={style}
      {...surfaceProps}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="absolute max-w-none"
        style={{
          width: `${100 / effectiveCrop.w}%`,
          height: `${100 / effectiveCrop.h}%`,
          left: `${-(effectiveCrop.x / effectiveCrop.w) * 100}%`,
          top: `${-(effectiveCrop.y / effectiveCrop.h) * 100}%`,
        }}
      />
      {annotations.length > 0 ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${viewW} ${viewH}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <ShapesLayer
            shapes={annotations}
            selectedId={selectedId}
            viewW={viewW}
            viewH={viewH}
          />
        </svg>
      ) : null}
      {children}
    </div>
  );
}

/** Step 1: position the crop box over the full image.
 * Annotations stay visible inside the crop frame (same coords as Annotate).
 * Crop aspect is always locked to the source image so every crop is a
 * same-ratio zoom/pan of the original photo. */
function CropStepSurface({
  src,
  alt,
  crop,
  onCropChange,
  annotations = [],
}) {
  const surfaceRef = useRef(null);
  const imageRef = useRef(null);
  const naturalSize = useNaturalSize(src);
  const [drag, setDrag] = useState(null);
  const [contentBox, setContentBox] = useState({
    offsetLeft: 0,
    offsetTop: 0,
    width: 0,
    height: 0,
  });

  // Buffer the drag locally; the parent (and the slot grid it re-renders)
  // only hears about it on release.
  const liveCrop = drag?.value ?? crop;
  const imageAspect = naturalSize
    ? naturalSize.width / naturalSize.height
    : null;
  const cropAspect = cropAspectRatio(liveCrop, naturalSize);
  const shapeViewW = STROKE_REFERENCE_WIDTH;
  const shapeViewH = STROKE_REFERENCE_WIDTH / cropAspect;

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
  }, [src, updateContentBox]);

  useEffect(() => {
    if (!imageAspect) return;
    onCropChange(fitCropToAspect(crop, imageAspect, imageAspect));
    // Re-fit whenever the natural image ratio is known / changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [imageAspect]);

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
      origin: { ...liveCrop },
      value: null,
    });
    surfaceRef.current?.setPointerCapture(event.pointerId);
  }

  function onPointerDownHandle(event, handleId) {
    event.stopPropagation();
    if (event.button !== 0) return;
    setDrag({ mode: "resize", handleId, origin: { ...liveCrop }, value: null });
    surfaceRef.current?.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag) return;
    const point = clientToNormalized(event.clientX, event.clientY);
    if (!point) return;

    if (drag.mode === "move") {
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      setDrag((prev) => ({
        ...prev,
        value: clampCrop({
          ...prev.origin,
          x: prev.origin.x + dx,
          y: prev.origin.y + dy,
        }),
      }));
      return;
    }

    setDrag((prev) => ({
      ...prev,
      value: resizeCrop(
        prev.origin,
        prev.handleId,
        point.x,
        point.y,
        imageAspect,
        imageAspect,
      ),
    }));
  }

  function onPointerUp(event) {
    if (!drag) return;
    if (drag.value) onCropChange(drag.value);
    setDrag(null);
    try {
      surfaceRef.current?.releasePointerCapture(event.pointerId);
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
      className="relative inline-block max-h-full max-w-full touch-none select-none"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(event) => event.stopPropagation()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        draggable={false}
        // Invisible until the dim overlay is ready — otherwise Crop blinks
        // a full bright photo. Height budget matches Annotate.
        className={`${EDITOR_MEDIA_CLASSNAME}${contentBox.width > 0 ? "" : " opacity-0"}`}
        style={{ maxHeight: `min(100%, ${EDITOR_MEDIA_FIT_HEIGHT})` }}
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
              d={`M0 0H1V1H0Z M${liveCrop.x} ${liveCrop.y}H${liveCrop.x + liveCrop.w}V${liveCrop.y + liveCrop.h}H${liveCrop.x}Z`}
              fill="rgba(0,0,0,0.55)"
              fillRule="evenodd"
            />
            <rect
              x={liveCrop.x}
              y={liveCrop.y}
              width={liveCrop.w}
              height={liveCrop.h}
              fill="none"
              stroke="#f3e9f2"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {annotations.length > 0 ? (
            <svg
              className="pointer-events-none absolute overflow-visible"
              style={{
                left: `${liveCrop.x * 100}%`,
                top: `${liveCrop.y * 100}%`,
                width: `${liveCrop.w * 100}%`,
                height: `${liveCrop.h * 100}%`,
              }}
              viewBox={`0 0 ${shapeViewW} ${shapeViewH}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <ShapesLayer
                shapes={annotations}
                selectedId={null}
                viewW={shapeViewW}
                viewH={shapeViewH}
              />
            </svg>
          ) : null}
          <button
            type="button"
            aria-label="Move crop"
            className="absolute cursor-move"
            style={{
              left: `${liveCrop.x * 100}%`,
              top: `${liveCrop.y * 100}%`,
              width: `${liveCrop.w * 100}%`,
              height: `${liveCrop.h * 100}%`,
            }}
            onPointerDown={onPointerDownMove}
          />
          {CROP_HANDLES.map((handle) => {
            const pos = cropHandlePosition(liveCrop, handle.id);
            return (
              <button
                key={handle.id}
                type="button"
                aria-label={`Resize ${handle.id}`}
                className="absolute rounded-sm border-2 border-cream bg-ink shadow-sm"
                style={{
                  width: CROP_HANDLE_SIZE,
                  height: CROP_HANDLE_SIZE,
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

/** Step 2: draw on the cropped region — exactly what ships to the output. */
function AnnotateStepSurface({
  src,
  alt,
  crop,
  shapes,
  selectedId,
  onSelectShape,
  onShapesChange,
}) {
  const surfaceRef = useRef(null);
  const naturalSize = useNaturalSize(src);
  const aspect = cropAspectRatio(crop, naturalSize);

  const clientToNormalized = useCallback((clientX, clientY) => {
    const node = surfaceRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1),
    };
  }, []);

  const drag = useShapeDrag({
    shapes,
    selectedId,
    aspect,
    clientToNormalized,
    surfaceRef,
    onSelect: onSelectShape,
    onShapesChange,
  });

  // Same height budget as Crop; intrinsic width so size does not collapse
  // to the toolbar when Crop is `hidden`.
  return (
    <CroppedShapePreview
      src={src}
      alt={alt}
      crop={crop}
      annotations={drag.liveShapes}
      selectedId={selectedId}
      fitHeight={EDITOR_MEDIA_FIT_HEIGHT}
      className="max-w-[min(85vw,100%)] touch-none select-none rounded-xl pixel-border md:max-w-[min(90vw,100%)]"
      innerRef={surfaceRef}
      onPointerDown={drag.onPointerDownSurface}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerUp}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="pointer-events-none absolute inset-0">
        <ShapeHandles
          selected={drag.selected}
          aspect={aspect}
          rotating={drag.isRotating}
          onPointerDownHandle={drag.onPointerDownHandle}
        />
      </div>
    </CroppedShapePreview>
  );
}

const EDITOR_STEPS = [
  { id: "crop", label: "Crop" },
  { id: "annotate", label: "Annotate" },
];

function EditModeToggle({ step, onStepChange }) {
  return (
    <div
      className="inline-flex rounded-xl border border-ink/20 bg-night/40 p-1"
      role="group"
      aria-label="Edit mode"
      onClick={(event) => event.stopPropagation()}
    >
      {EDITOR_STEPS.map((option) => {
        const active = step === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onStepChange(option.id)}
            className={`rounded-lg px-3 py-1.5 font-secondary text-xs font-semibold transition ${
              active ? "bg-ink text-night" : "text-ink/70 hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One photo's crop/annotate surface. Mode (`step`) is owned by the parent so
 * paired before/after panels stay in lockstep behind a single toggle.
 */
function EditorPanel({
  previewUrl,
  alt,
  label,
  step,
  draftCrop,
  draftAnnotations,
  selectedId,
  onDraftCropChange,
  onDraftAnnotationsChange,
  onSelectedIdChange,
}) {
  // Shared across every circle on this photo; survives deleting down to zero
  // so the next Add circle keeps the last thickness the user picked.
  const [strokeWidth, setStrokeWidth] = useState(() =>
    getSharedStrokeWidth(draftAnnotations),
  );

  const hasCrop = !isDefaultCrop(draftCrop);

  useEffect(() => {
    if (step !== "annotate" || !selectedId) return undefined;
    function onKeyDown(event) {
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        !event.target.matches("input, textarea, select")
      ) {
        event.preventDefault();
        onDraftAnnotationsChange((prev) =>
          prev.filter((shape) => shape.id !== selectedId),
        );
        onSelectedIdChange(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step, selectedId, onDraftAnnotationsChange, onSelectedIdChange]);

  function addShape(type) {
    const next = createShape(type, draftAnnotations.length, { strokeWidth });
    onDraftAnnotationsChange([...draftAnnotations, next]);
    onSelectedIdChange(next.id);
  }

  function deleteSelected() {
    if (!selectedId) return;
    onDraftAnnotationsChange(
      draftAnnotations.filter((shape) => shape.id !== selectedId),
    );
    onSelectedIdChange(null);
  }

  function changeStrokeWidth(next) {
    const width = clampStrokeWidth(next);
    setStrokeWidth(width);
    onDraftAnnotationsChange((prev) => applyStrokeWidth(prev, width));
  }

  return (
    <div className="flex h-full min-h-0 max-h-full flex-col items-center gap-2">
      <p className="shrink-0 text-center font-secondary text-[11px] font-semibold uppercase tracking-wide text-ink/40">
        {label}
      </p>

      <div
        className="flex max-w-full shrink-0 flex-wrap items-center justify-center gap-2"
        onClick={(event) => event.stopPropagation()}
      >
        {step === "crop" ? (
          <button
            type="button"
            onClick={() => onDraftCropChange(DEFAULT_CROP)}
            disabled={!hasCrop}
            className="rounded-lg border border-ink/20 bg-ink/10 px-3 py-1.5 font-secondary text-xs font-semibold text-ink transition hover:bg-ink/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset crop
          </button>
        ) : (
          <ShapeToolbar
            selectedId={selectedId}
            onAdd={addShape}
            onDelete={deleteSelected}
            strokeWidth={strokeWidth}
            onStrokeWidthChange={changeStrokeWidth}
          />
        )}
      </div>

      {/*
        Keep both surfaces mounted and toggle with `hidden` instead of
        unmounting. Remounting reloaded the <img>, reset naturalSize to null
        (square aspect flash), and dropped the crop overlay until ResizeObserver
        re-measured — the blink when flipping Crop ↔ Annotate.
      */}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div
          className={step === "crop" ? "contents" : "hidden"}
          aria-hidden={step !== "crop"}
        >
          <CropStepSurface
            src={previewUrl}
            alt={alt}
            crop={draftCrop}
            onCropChange={onDraftCropChange}
            annotations={draftAnnotations}
          />
        </div>

        <div
          className={step === "annotate" ? "contents" : "hidden"}
          aria-hidden={step !== "annotate"}
        >
          <AnnotateStepSurface
            src={previewUrl}
            alt={alt}
            crop={draftCrop}
            shapes={draftAnnotations}
            selectedId={selectedId}
            onSelectShape={onSelectedIdChange}
            onShapesChange={onDraftAnnotationsChange}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Crop → Annotate editor for a studio slot image and — when the slot is
 * paired (before/after) — its sibling too, open and editable side by side.
 * Crop/Annotate mode is shared across both photos (one toggle).
 *
 * Edits apply to a local draft as you go; the slot(s) only see them once the
 * session ends. Done, backdrop click, the lightbox Close button, and Escape
 * (with nothing selected) all save. Cancel discards both photos' edits.
 *
 * Annotations are normalized against each photo's own *cropped* frame, so
 * re-cropping later keeps them fixed in the frame while the image content
 * shifts beneath them.
 */
export default function StudioSlotEditor({
  item,
  previewUrl,
  alt,
  label,
  sibling = null,
  onClose,
  onCropChange,
  onAnnotationsChange,
}) {
  // Initialized once per mount (StudioCroppableThumb mounts a fresh editor
  // each time it opens), so these don't need to resync if the underlying
  // items change underneath the editor.
  const [step, setStep] = useState("crop");
  const [draftCropA, setDraftCropA] = useState(() =>
    clampCrop(item?.crop ?? DEFAULT_CROP),
  );
  const [draftAnnotationsA, setDraftAnnotationsA] = useState(
    () => item?.annotations ?? [],
  );
  const [selectedIdA, setSelectedIdA] = useState(null);

  const hasSibling = Boolean(
    sibling?.item && sibling.onCropChange && sibling.onAnnotationsChange,
  );

  const [draftCropB, setDraftCropB] = useState(() =>
    clampCrop(sibling?.item?.crop ?? DEFAULT_CROP),
  );
  const [draftAnnotationsB, setDraftAnnotationsB] = useState(
    () => sibling?.item?.annotations ?? [],
  );
  const [selectedIdB, setSelectedIdB] = useState(null);

  function changeStep(next) {
    setStep(next);
    setSelectedIdA(null);
    setSelectedIdB(null);
  }

  /** Any dismissal except the explicit Cancel button keeps the edits. */
  function commitAndClose() {
    onCropChange(draftCropA);
    onAnnotationsChange(draftAnnotationsA);
    if (hasSibling) {
      sibling.onCropChange(draftCropB);
      sibling.onAnnotationsChange(draftAnnotationsB);
    }
    onClose();
  }

  function cancelAndClose() {
    onClose();
  }

  const panelA = (
    <EditorPanel
      key="primary"
      previewUrl={previewUrl}
      alt={alt || label || ""}
      label={label || alt || "Photo"}
      step={step}
      draftCrop={draftCropA}
      draftAnnotations={draftAnnotationsA}
      selectedId={selectedIdA}
      onDraftCropChange={setDraftCropA}
      onDraftAnnotationsChange={setDraftAnnotationsA}
      onSelectedIdChange={setSelectedIdA}
    />
  );

  const panelB = hasSibling ? (
    <EditorPanel
      key="sibling"
      previewUrl={sibling.src}
      alt={sibling.alt || sibling.label || "Photo"}
      label={sibling.label || "Paired photo"}
      step={step}
      draftCrop={draftCropB}
      draftAnnotations={draftAnnotationsB}
      selectedId={selectedIdB}
      onDraftCropChange={setDraftCropB}
      onDraftAnnotationsChange={setDraftAnnotationsB}
      onSelectedIdChange={setSelectedIdB}
    />
  ) : null;

  const orderedPanels =
    hasSibling && sibling.side === "left" ? [panelB, panelA] : [panelA, panelB];

  return (
    <MediaLightbox
      media={{
        type: "image",
        src: previewUrl,
        // Each panel self-labels; MediaLightbox's own caption can only show
        // one string, so it's suppressed here (no `label`) and this alt just
        // backs the dialog's aria-label fallback.
        alt: hasSibling
          ? `Edit ${alt || label || "photo"} and ${sibling.alt || sibling.label || "paired photo"}`
          : alt || label || "",
      }}
      onClose={commitAndClose}
      onEscape={() => {
        if (selectedIdA) setSelectedIdA(null);
        else if (selectedIdB) setSelectedIdB(null);
        else commitAndClose();
      }}
    >
      {/*
        Fill the lightbox so the photo uses remaining space and Done/Cancel
        stay on-screen. MediaLightbox stops propagation on its content
        wrapper (sized to the full viewport now); empty space here still
        commits+closes, while controls/surfaces stopPropagation themselves.
      */}
      <div
        className="flex h-full min-h-0 w-full max-h-full flex-col items-center gap-3"
        onClick={commitAndClose}
      >
        <div className="shrink-0">
          <EditModeToggle step={step} onStepChange={changeStep} />
        </div>

        <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-4 overflow-hidden sm:flex-row sm:items-stretch sm:justify-center">
          {orderedPanels}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              commitAndClose();
            }}
            className="rounded-xl bg-ink px-5 py-2.5 font-semibold text-night transition hover:brightness-110"
          >
            Done
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              cancelAndClose();
            }}
            className="rounded-xl border border-ink/20 bg-night/50 px-5 py-2.5 font-semibold text-ink transition hover:border-ink/40 hover:bg-night/70"
          >
            Cancel
          </button>
        </div>
      </div>
    </MediaLightbox>
  );
}

/**
 * Slot thumbnail that opens the crop+annotate editor on click (drag still
 * works, e.g. for moving the image into a different slot). Shows the cropped
 * + annotated result, i.e. what this slot contributes to the output.
 */
export function StudioCroppableThumb({
  item,
  src,
  alt,
  label,
  className = "",
  previewClassName = "",
  onCropChange,
  onAnnotationsChange,
  sibling = null,
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
        aria-label={`Edit ${label || alt}`}
      >
        <CroppedShapePreview
          src={src}
          alt={alt || label || ""}
          crop={item?.crop}
          annotations={item?.annotations ?? []}
          fitHeight="9rem"
          className={previewClassName}
        />
      </div>

      {open && src ? (
        <StudioSlotEditor
          item={item}
          previewUrl={src}
          alt={alt}
          label={label}
          sibling={sibling}
          onClose={() => setOpen(false)}
          onCropChange={onCropChange}
          onAnnotationsChange={onAnnotationsChange}
        />
      ) : null}
    </>
  );
}

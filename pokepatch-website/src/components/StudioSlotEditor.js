"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MediaLightbox, {
  LIGHTBOX_MEDIA_CLASSNAME,
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
  clamp,
  createShape,
  getImageContentMetrics,
} from "@/lib/shapeAnnotations";

const CROP_HANDLE_SIZE = 10;

/** Natural pixel dimensions of an image URL, once it has loaded. */
export function useNaturalSize(src) {
  const [size, setSize] = useState(null);
  useEffect(() => {
    setSize(null);
    if (!src) return undefined;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) {
        setSize({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return size;
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

  // Height is always *derived* from width + aspect-ratio; a height cap is
  // expressed as a max-width instead. Giving the box both a definite width
  // and a definite height would override aspect-ratio and stretch the
  // absolutely-positioned image.
  const style = {
    aspectRatio: String(aspect),
    width: "100%",
    ...(fitHeight ? { maxWidth: `calc(${fitHeight} * ${aspect})` } : null),
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
      className="relative inline-block max-w-full touch-none select-none"
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
                className="absolute rounded-sm border-2 border-cream bg-berry shadow-sm"
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

  // The preview box *is* the interaction surface, so pointer coords and the
  // handle overlay can never drift out of alignment with the rendered crop.
  return (
    // Same responsive height cap as LIGHTBOX_MEDIA_CLASSNAME (the Crop
    // step's plain <img>), expressed as a custom property since fitHeight
    // feeds an inline calc() rather than a Tailwind class — otherwise this
    // surface stayed capped at 60vh on larger screens while Crop mode grew
    // up to 80vh, making Annotate mode look smaller for no reason.
    <div className="w-full max-w-[85vw] [--fit-h:60vh] sm:[--fit-h:72vh] md:max-w-[90vw] md:[--fit-h:80vh]">
      <CroppedShapePreview
        src={src}
        alt={alt}
        crop={crop}
        annotations={drag.liveShapes}
        selectedId={selectedId}
        fitHeight="var(--fit-h)"
        className="touch-none select-none rounded-xl pixel-border"
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
    </div>
  );
}

/**
 * One independently-editable photo: its own Crop/Annotate mode and drag
 * surface. `draftCrop` / `draftAnnotations` / `selectedId` are controlled from
 * the parent (StudioSlotEditor needs both photos' current values at once to
 * commit them together), but `step` stays local here — that's what makes two
 * panels' modes independent of each other for free, no cross-panel plumbing.
 */
function EditorPanel({
  previewUrl,
  alt,
  label,
  draftCrop,
  draftAnnotations,
  selectedId,
  onDraftCropChange,
  onDraftAnnotationsChange,
  onSelectedIdChange,
}) {
  const [step, setStep] = useState("crop");

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
    const next = createShape(type, draftAnnotations.length);
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

  const steps = [
    { id: "crop", label: "Crop" },
    { id: "annotate", label: "Annotate" },
  ];

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-center font-secondary text-[11px] font-semibold uppercase tracking-wide text-ink/40">
        {label}
      </p>

      <div
        className="flex max-w-full flex-wrap items-center justify-center gap-2"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="inline-flex rounded-xl border border-ink/20 bg-night/40 p-1"
          role="group"
          aria-label="Edit mode"
        >
          {steps.map((option) => {
            const active = step === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setStep(option.id);
                  onSelectedIdChange(null);
                }}
                className={`rounded-lg px-3 py-1.5 font-secondary text-xs font-semibold transition ${
                  active
                    ? "bg-berry text-night "
                    : "text-ink/70 hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

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
          />
        )}
      </div>

      {step === "crop" ? (
        <>
          <CropStepSurface
            src={previewUrl}
            alt={alt}
            crop={draftCrop}
            onCropChange={onDraftCropChange}
            annotations={draftAnnotations}
          />

          <p className="text-center text-xs text-ink/50">
            Drag the box to move · drag handles to zoom · crop keeps the
            photo&apos;s original ratio · circles stay in the frame
          </p>
        </>
      ) : (
        <>
          <AnnotateStepSurface
            src={previewUrl}
            alt={alt}
            crop={draftCrop}
            shapes={draftAnnotations}
            selectedId={selectedId}
            onSelectShape={onSelectedIdChange}
            onShapesChange={onDraftAnnotationsChange}
          />

          <p className="text-center text-xs text-ink/50">
            This is the cropped image as it will appear in the output ·
            drag a shape to move it · Delete removes the selected shape
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Crop → Annotate editor for a studio slot image and — when the slot is
 * paired (before/after) — its sibling too, open and editable side by side.
 * Each photo's Crop/Annotate mode is fully independent (see `EditorPanel`).
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
        MediaLightbox stops propagation on its own content wrapper, but that
        wrapper is sized to the *widest* row in this column (e.g. the aspect
        controls or the toolbar), which can be wider than the actual photo.
        Without this, clicking that leftover space read as "inside" and
        didn't close. So this whole block closes on click by default, and
        only the specific, tightly-sized interactive pieces (each control
        group, the crop/annotate surface itself, Done/Cancel) opt back out via
        their own stopPropagation.
      */}
      <div className="flex flex-col items-center gap-6" onClick={commitAndClose}>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-center">
          {orderedPanels}
        </div>

        <p className="text-center text-xs text-ink/40">
          Done saves your edits · Cancel discards them · click outside to save
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              commitAndClose();
            }}
            className="rounded-xl bg-berry px-5 py-2.5 font-semibold text-night transition hover:brightness-110"
          >
            Done
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              cancelAndClose();
            }}
            className="rounded-xl border border-ink/20 bg-night/50 px-5 py-2.5 font-semibold text-ink transition hover:border-berry/40 hover:bg-night/70"
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

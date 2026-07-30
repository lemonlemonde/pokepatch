"use client";

import { useState } from "react";
import {
  ROTATE_SNAP_DEG,
  hitTest,
  normalizeShape,
  resizeRotatedShape,
  shapeCenter,
  shapeRotation,
  visualAtan2,
} from "@/lib/shapeAnnotations";

/**
 * Shape select / move / resize / rotate state machine, shared by every
 * surface that edits annotation shapes.
 *
 * Shapes are normalized 0–1 against whatever frame the caller is drawing in
 * (the full image for the output annotator, the cropped region for the slot
 * editor) — this hook never needs to know which.
 *
 * The in-progress drag is buffered internally and exposed as `liveShapes`;
 * `onShapesChange` fires **once, on pointer release**. Committing on every
 * pointermove re-renders the caller's whole tree per pixel of movement,
 * which made dragging visibly laggy when the shapes live in a parent's
 * state.
 *
 * @param clientToNormalized (clientX, clientY) => {x, y} | null
 * @param surfaceRef ref to the element carrying onPointerMove/Up — pointer
 *   capture is always taken and released there, including for handle drags,
 *   so a drag that leaves the element still tracks and still releases.
 */
export default function useShapeDrag({
  shapes,
  selectedId,
  aspect = 1,
  clientToNormalized,
  surfaceRef,
  onSelect,
  onShapesChange,
}) {
  const [drag, setDrag] = useState(null);

  const liveShapes = drag?.value ?? shapes;
  const selected = liveShapes.find((shape) => shape.id === selectedId) ?? null;

  function onPointerDownSurface(event) {
    if (event.button !== 0) return;
    const point = clientToNormalized(event.clientX, event.clientY);
    if (!point) return;

    // Topmost shape wins.
    for (let i = liveShapes.length - 1; i >= 0; i -= 1) {
      const shape = liveShapes[i];
      if (hitTest(shape, point.x, point.y, aspect)) {
        onSelect(shape.id);
        setDrag({
          mode: "move",
          id: shape.id,
          startX: point.x,
          startY: point.y,
          origin: { ...shape },
          value: null,
        });
        surfaceRef.current?.setPointerCapture(event.pointerId);
        return;
      }
    }

    onSelect(null);
  }

  function onPointerDownHandle(event, handleId) {
    event.stopPropagation();
    if (!selected || event.button !== 0) return;
    const point = clientToNormalized(event.clientX, event.clientY);
    if (!point) return;

    if (handleId === "rotate") {
      const { cx, cy } = shapeCenter(selected);
      setDrag({
        mode: "rotate",
        id: selected.id,
        origin: { ...selected },
        startAngle: visualAtan2(point.x, point.y, cx, cy, aspect),
        value: null,
      });
    } else {
      setDrag({
        mode: "resize",
        id: selected.id,
        handleId,
        origin: { ...selected },
        value: null,
      });
    }
    surfaceRef.current?.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag) return;
    const point = clientToNormalized(event.clientX, event.clientY);
    if (!point) return;

    const next = shapes.map((shape) => {
      if (shape.id !== drag.id) return shape;

      if (drag.mode === "move") {
        const dx = point.x - drag.startX;
        const dy = point.y - drag.startY;
        return normalizeShape({
          ...drag.origin,
          x: drag.origin.x + dx,
          y: drag.origin.y + dy,
        });
      }

      if (drag.mode === "rotate") {
        const { cx, cy } = shapeCenter(drag.origin);
        const angle = visualAtan2(point.x, point.y, cx, cy, aspect);
        let degrees =
          shapeRotation(drag.origin) +
          ((angle - drag.startAngle) * 180) / Math.PI;
        if (event.shiftKey) {
          degrees = Math.round(degrees / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG;
        }
        return { ...drag.origin, rotation: degrees };
      }

      return resizeRotatedShape(
        drag.origin,
        drag.handleId,
        point.x,
        point.y,
        event.shiftKey,
        aspect,
      );
    });

    setDrag((prev) => (prev ? { ...prev, value: next } : prev));
  }

  function onPointerUp(event) {
    if (!drag) return;
    if (drag.value) onShapesChange(drag.value);
    setDrag(null);
    try {
      surfaceRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
  }

  return {
    liveShapes,
    selected,
    isRotating: drag?.mode === "rotate",
    onPointerDownSurface,
    onPointerDownHandle,
    onPointerMove,
    onPointerUp,
  };
}

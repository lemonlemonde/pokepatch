"use client";

import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";

/**
 * Minimal ink signature pad (pointer + touch). Exposes clear(), isEmpty(), toPngBytes().
 */
const SignaturePad = forwardRef(function SignaturePad(
  { className = "", disabled = false },
  ref
) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastRef = useRef(null);
  const dirtyRef = useRef(false);
  const strokeStyleRef = useRef(null);

  function configureStroke(ctx) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2.25;
    strokeStyleRef.current = ctx;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let restoreImg = null;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const width = parent.clientWidth;
      const height = Math.max(120, Math.round(width * 0.32));
      const prev = dirtyRef.current ? canvas.toDataURL("image/png") : null;

      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      configureStroke(ctx);
      ctx.clearRect(0, 0, width, height);

      if (prev) {
        restoreImg = new Image();
        const img = restoreImg;
        img.onload = () => {
          if (restoreImg !== img) return;
          ctx.drawImage(img, 0, 0, width, height);
        };
        img.src = prev;
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => {
      restoreImg = null;
      observer.disconnect();
    };
  }, []);

  useImperativeHandle(ref, () => ({
    clear() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      configureStroke(ctx);
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      dirtyRef.current = false;
      lastRef.current = null;
      drawingRef.current = false;
    },
    isEmpty() {
      return !dirtyRef.current;
    },
    async toPngBytes() {
      const canvas = canvasRef.current;
      if (!canvas || !dirtyRef.current) return null;
      const blob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/png");
      });
      if (!blob) return null;
      return new Uint8Array(await blob.arrayBuffer());
    },
  }));

  function pointFromEvent(event) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function startDraw(event) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    if (!point) return;
    drawingRef.current = true;
    lastRef.current = point;
    try {
      canvasRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Older browsers may not support capture; drawing still works.
    }
  }

  function moveDraw(event) {
    if (disabled || !drawingRef.current) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    const ctx = strokeStyleRef.current ?? canvas?.getContext("2d");
    const point = pointFromEvent(event);
    const last = lastRef.current;
    if (!ctx || !point || !last) return;
    if (!strokeStyleRef.current) configureStroke(ctx);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastRef.current = point;
    dirtyRef.current = true;
  }

  function endDraw(event) {
    if (!drawingRef.current) return;
    event.preventDefault();
    drawingRef.current = false;
    lastRef.current = null;
    try {
      if (canvasRef.current?.hasPointerCapture?.(event.pointerId)) {
        canvasRef.current.releasePointerCapture(event.pointerId);
      }
    } catch {
      // ignore
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className={`touch-none cursor-crosshair bg-white ${className}`}
      onPointerDown={startDraw}
      onPointerMove={moveDraw}
      onPointerUp={endDraw}
      onPointerCancel={endDraw}
    />
  );
});

export default SignaturePad;

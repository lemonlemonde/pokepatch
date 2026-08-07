"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseGuideStepText } from "@/lib/restorationGuideLinks";
import {
  RESTORATION_GUIDE_NODES,
  RESTORATION_GUIDE_START_ID,
} from "@/lib/restorationGuideTree";
import {
  buildGuideGraphLayout,
  computeBandEdgeGeometry,
  displayNodeLines,
  nodeBranchLabel,
} from "@/lib/restorationGuideLayout";

const MAX_ZOOM = 2.5;
const ABSOLUTE_MIN_ZOOM = 0.35;
const POPOVER_OFFSET = 14;
const POPOVER_WIDTH = 300;

const FLY_DURATION_MS = 480;

function computeFocusOnNode({
  viewportWidth,
  viewportHeight,
  nodeX,
  nodeY,
  nodeWidth,
  nodeHeight,
  currentZoom,
  minZoom,
}) {
  const targetZoom = clampZoom(Math.max(currentZoom, 0.72), minZoom);
  const centerX = nodeX + nodeWidth / 2;
  const centerY = nodeY + nodeHeight / 2;

  return {
    zoom: targetZoom,
    panX: viewportWidth / 2 - centerX * targetZoom,
    panY: viewportHeight / 2 - centerY * targetZoom,
  };
}

function clampZoom(value, minZoom = ABSOLUTE_MIN_ZOOM) {
  return Math.min(MAX_ZOOM, Math.max(minZoom, value));
}

function computeFitZoom(viewportWidth, viewportHeight, canvasWidth, canvasHeight) {
  const padding = 40;
  return Math.min(
    (viewportWidth - padding) / canvasWidth,
    (viewportHeight - padding) / canvasHeight,
  );
}

function computeFitView(viewportWidth, viewportHeight, canvasWidth, canvasHeight) {
  const zoom = computeFitZoom(viewportWidth, viewportHeight, canvasWidth, canvasHeight);
  return {
    zoom,
    panX: (viewportWidth - canvasWidth * zoom) / 2,
    panY: (viewportHeight - canvasHeight * zoom) / 2,
  };
}

function zoomAtPoint({ zoom, panX, panY, nextZoom, anchorX, anchorY, minZoom }) {
  const clamped = clampZoom(nextZoom, minZoom);
  const ratio = clamped / zoom;
  return {
    zoom: clamped,
    panX: anchorX - (anchorX - panX) * ratio,
    panY: anchorY - (anchorY - panY) * ratio,
  };
}

function clampPopoverPositionCanvas(canvasX, canvasY, view, viewportWidth, viewportHeight) {
  const margin = 12;
  const minX = (-view.panX + margin) / view.zoom;
  const minY = (-view.panY + margin) / view.zoom;
  const maxX = (viewportWidth - view.panX - margin - POPOVER_WIDTH) / view.zoom;
  const maxY = (viewportHeight - view.panY - margin) / view.zoom;

  return {
    x: Math.min(Math.max(minX, canvasX), Math.max(minX, maxX)),
    y: Math.min(Math.max(minY, canvasY), Math.max(minY, maxY)),
  };
}

function useGuideCanvas(viewportRef, canvasWidth, canvasHeight) {
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isFlying, setIsFlying] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const viewRef = useRef(view);
  viewRef.current = view;

  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const hasFitRef = useRef(false);
  const flyTimeoutRef = useRef(null);
  const minZoomRef = useRef(ABSOLUTE_MIN_ZOOM);

  const refitToView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || canvasWidth <= 0) return;
    const fitView = computeFitView(
      viewport.clientWidth,
      viewport.clientHeight,
      canvasWidth,
      canvasHeight,
    );
    minZoomRef.current = Math.max(ABSOLUTE_MIN_ZOOM, fitView.zoom);
    setView(fitView);
  }, [canvasHeight, canvasWidth, viewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || canvasWidth <= 0) return undefined;

    const tryFit = () => {
      if (viewport.clientWidth <= 0) return;
      if (!hasFitRef.current) {
        hasFitRef.current = true;
        refitToView();
      }
    };

    tryFit();
    const observer = new ResizeObserver(tryFit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [canvasHeight, canvasWidth, refitToView, viewportRef]);

  useEffect(() => {
    hasFitRef.current = false;
  }, [canvasWidth, canvasHeight]);

  useEffect(
    () => () => {
      if (flyTimeoutRef.current) {
        window.clearTimeout(flyTimeoutRef.current);
      }
    },
    [],
  );

  const flyToView = useCallback((targetView) => {
    if (flyTimeoutRef.current) {
      window.clearTimeout(flyTimeoutRef.current);
    }

    setIsFlying(true);
    setView(targetView);
    flyTimeoutRef.current = window.setTimeout(() => {
      setIsFlying(false);
      flyTimeoutRef.current = null;
    }, FLY_DURATION_MS);
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.code !== "Space" || event.repeat) return;
      event.preventDefault();
      setSpaceHeld(true);
    }

    function onKeyUp(event) {
      if (event.code !== "Space") return;
      setSpaceHeld(false);
      dragRef.current = null;
      setIsDragging(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const beginPan = useCallback((clientX, clientY) => {
    const current = viewRef.current;
    dragRef.current = {
      startX: clientX,
      startY: clientY,
      startPanX: current.panX,
      startPanY: current.panY,
      moved: false,
    };
    setIsDragging(true);
  }, []);

  const movePan = useCallback((clientX, clientY) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = clientX - drag.startX;
    const dy = clientY - drag.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      drag.moved = true;
    }

    setView((current) => ({
      ...current,
      panX: drag.startPanX + dx,
      panY: drag.startPanY + dy,
    }));
  }, []);

  const endPan = useCallback(() => {
    if (dragRef.current?.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback(
    (event) => {
      if (event.target instanceof Element && event.target.closest("[data-guide-popover]")) {
        return;
      }

      event.preventDefault();
      const viewport = viewportRef.current;
      if (!viewport) return;

      const rect = viewport.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      const anchorY = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.1 : 0.9;

      setView((current) =>
        zoomAtPoint({
          ...current,
          nextZoom: current.zoom * factor,
          anchorX,
          anchorY,
          minZoom: minZoomRef.current,
        }),
      );
    },
    [viewportRef],
  );

  const handlePointerDown = useCallback(
    (event) => {
      const fromPanSurface = Boolean(event.target.closest("[data-guide-pan-surface]"));
      const onViewport = event.target === event.currentTarget;
      const middleButton = event.button === 1;
      const spacePan = spaceHeld && event.button === 0;

      if (!fromPanSurface && !onViewport && !middleButton && !spacePan) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      beginPan(event.clientX, event.clientY);
    },
    [beginPan, spaceHeld],
  );

  const handlePointerMove = useCallback(
    (event) => {
      if (!dragRef.current) return;
      movePan(event.clientX, event.clientY);
    },
    [movePan],
  );

  const handlePointerUp = useCallback(
    (event) => {
      if (!dragRef.current) return false;
      const moved = dragRef.current.moved;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      endPan();
      return !moved;
    },
    [endPan],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [handleWheel, viewportRef]);

  const cursorClass = isDragging
    ? "cursor-grabbing"
    : spaceHeld
      ? "cursor-grab"
      : "cursor-default";

  return {
    view,
    cursorClass,
    spaceHeld,
    isDragging,
    isFlying,
    suppressClickRef,
    minZoomRef,
    refitToView,
    flyToView,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}

function useFullscreen(containerRef, onChange) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function sync() {
      const active = document.fullscreenElement === containerRef.current;
      setIsFullscreen(active);
      onChange?.(active);
    }

    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [containerRef, onChange]);

  const toggle = useCallback(async () => {
    const element = containerRef.current;
    if (!element) return;

    try {
      if (document.fullscreenElement === element) {
        await document.exitFullscreen();
      } else {
        await element.requestFullscreen();
      }
    } catch {
      // Fullscreen unsupported or blocked.
    }
  }, [containerRef]);

  return { isFullscreen, toggle };
}

function FullscreenButton({ isFullscreen, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isFullscreen}
      aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
      className="rounded-lg border border-ink/15 bg-cream/90 px-2.5 py-1.5 text-xs font-semibold text-ink/70 backdrop-blur-sm transition hover:border-ink/30 hover:text-ink"
    >
      {isFullscreen ? "Exit full screen" : "Full screen"}
    </button>
  );
}

function CanvasToolbar({ isFullscreen, onToggleFullscreen, onResetView }) {
  return (
    <div className="absolute right-3 top-3 z-[60] flex items-center gap-2">
      <button
        type="button"
        onClick={onResetView}
        className="rounded-lg border border-ink/15 bg-cream/90 px-2.5 py-1.5 text-xs font-semibold text-ink/70 backdrop-blur-sm transition hover:border-ink/30 hover:text-ink"
      >
        Reset view
      </button>
      <FullscreenButton isFullscreen={isFullscreen} onToggle={onToggleFullscreen} />
    </div>
  );
}

const SECTION_STYLES = {
  concepts: {
    accent: "border-l-violet-400/60",
    badge: "bg-violet-400/10 text-violet-700",
  },
  start: {
    accent: "border-l-mint/60",
    badge: "bg-mint/15 text-mint",
  },
  damage: {
    accent: "border-l-blush/50",
    badge: "bg-blush/10 text-blush",
  },
  wrap_up: {
    accent: "border-l-amber-400/60",
    badge: "bg-amber-400/10 text-amber-700",
  },
  technique: {
    accent: "border-l-sky-400/60",
    badge: "bg-sky-400/10 text-sky-700",
  },
};

function GuideSectionBand({ band }) {
  return (
    <div
      className="pointer-events-none absolute z-[5] rounded-2xl border border-ink/12 bg-cream/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
      style={{
        left: band.x,
        top: band.y,
        width: band.width,
        height: band.height,
      }}
    >
      <span className="absolute inset-x-0 top-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/40">
        {band.label}
      </span>
    </div>
  );
}

function nodeBandId(nodeId, nodeMeta) {
  const section = nodeMeta.get(nodeId)?.section;
  if (section === "concepts") return "core_concepts";
  if (section === "technique") return "techniques";
  if (section === "wrap_up") return "wrap_up";
  if (section === "damage") return "damage";
  if (section === "start") return "start";
  return null;
}

function GuideStepContent({ step, onNavigateToNode }) {
  const parts = parseGuideStepText(step);

  return parts.map((part, index) => {
    if (part.type === "link") {
      return (
        <button
          key={`${part.nodeId}-${index}`}
          type="button"
          onClick={() => onNavigateToNode(part.nodeId)}
          className="font-medium text-blush underline decoration-blush/40 underline-offset-2 transition hover:text-berry hover:decoration-berry/50"
        >
          {part.label}
        </button>
      );
    }

    return <span key={index}>{part.value}</span>;
  });
}

function NodePopover({ nodeId, x, y, section, onClose, onNavigateToNode }) {
  const node = RESTORATION_GUIDE_NODES[nodeId];
  if (!node) return null;

  const branch = nodeBranchLabel(nodeId);
  const styles = SECTION_STYLES[section] ?? SECTION_STYLES.damage;

  return (
    <div
      data-guide-popover
      role="dialog"
      aria-label="Node details"
      className="absolute z-50 flex w-[300px] max-h-80 flex-col overflow-hidden rounded-xl border border-ink/15 bg-cream "
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        className={`flex items-start justify-between gap-2 border-b border-ink/10 border-l-[3px] px-3.5 py-2.5 ${styles.accent}`}
      >
        <div className="min-w-0">
          {branch ? (
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">
              {branch}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-md px-1.5 py-0.5 text-sm leading-none text-ink/45 transition hover:bg-ink/10 hover:text-ink"
        >
          ×
        </button>
      </div>

      <div className="overflow-y-auto px-3.5 py-3">
        <p className="text-sm font-semibold leading-snug text-ink">{node.title}</p>
        <ol className="mt-2.5 list-decimal space-y-2 pl-4 text-xs leading-relaxed text-ink/75">
          {node.steps.map((step, index) => (
            <li key={index}>
              <GuideStepContent step={step} onNavigateToNode={onNavigateToNode} />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function TreeNodeButton({
  nodeId,
  x,
  y,
  width,
  height,
  selected,
  section,
  step,
  onSelect,
  suppressClickRef,
  spaceHeld,
}) {
  const lines = displayNodeLines(nodeId);
  const styles = SECTION_STYLES[section] ?? SECTION_STYLES.damage;

  return (
    <button
      type="button"
      data-guide-node
      onClick={(event) => {
        if (suppressClickRef.current) return;
        onSelect(nodeId, event);
      }}
      className={`absolute z-20 flex items-center gap-2 rounded-xl border border-l-[3px] px-2.5 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-berry/40 ${
        spaceHeld ? "pointer-events-none" : ""
      } ${
        selected
          ? `border-berry/70 bg-cream text-ink shadow-[0_0_0_1px_rgba(224,81,138,0.3)] ${styles.accent}`
          : `border-ink/10 bg-cream/85 text-ink/90 hover:border-ink/20 hover:bg-cream ${styles.accent}`
      }`}
      style={{ left: x, top: y, width, height }}
      aria-pressed={selected}
    >
      {step ? (
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${styles.badge}`}
        >
          {step}
        </span>
      ) : null}
      <span className="line-clamp-2 min-w-0 flex-1 text-[11px] font-medium leading-snug">
        {lines.join(" ")}
      </span>
    </button>
  );
}

function GuideTreeCanvas({ layout }) {
  const shellRef = useRef(null);
  const viewportRef = useRef(null);
  const {
    nodes,
    bandEdges,
    bands,
    canvasWidth,
    canvasHeight,
    nodeWidth,
    nodeHeight,
    positions,
  } = layout;

  const nodeMeta = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const bandById = useMemo(() => new Map(bands.map((band) => [band.id, band])), [bands]);

  const [selectedId, setSelectedId] = useState(RESTORATION_GUIDE_START_ID);
  const [popover, setPopover] = useState(null);

  const {
    view,
    cursorClass,
    spaceHeld,
    isDragging,
    isFlying,
    suppressClickRef,
    minZoomRef,
    refitToView,
    flyToView,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useGuideCanvas(viewportRef, canvasWidth, canvasHeight);

  const handleFullscreenChange = useCallback(() => {
    window.requestAnimationFrame(() => {
      refitToView();
    });
  }, [refitToView]);

  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(
    shellRef,
    handleFullscreenChange,
  );

  const openPopoverAtNode = useCallback(
    (nodeId, anchorX, anchorY) => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const { x, y } = clampPopoverPositionCanvas(
        anchorX,
        anchorY,
        view,
        viewport.clientWidth,
        viewport.clientHeight,
      );

      setSelectedId(nodeId);
      setPopover({ nodeId, x, y });
    },
    [view],
  );

  const openPopover = useCallback(
    (nodeId, event) => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const rect = viewport.getBoundingClientRect();
      const rawCanvasX =
        (event.clientX - rect.left - view.panX) / view.zoom + POPOVER_OFFSET;
      const rawCanvasY =
        (event.clientY - rect.top - view.panY) / view.zoom + POPOVER_OFFSET;

      openPopoverAtNode(nodeId, rawCanvasX, rawCanvasY);
    },
    [openPopoverAtNode, view],
  );

  const navigatePopoverToNode = useCallback(
    (nodeId) => {
      const viewport = viewportRef.current;
      const position = positions.get(nodeId);
      if (!viewport || !position) return;

      const targetView = computeFocusOnNode({
        viewportWidth: viewport.clientWidth,
        viewportHeight: viewport.clientHeight,
        nodeX: position.x,
        nodeY: position.y,
        nodeWidth,
        nodeHeight,
        currentZoom: view.zoom,
        minZoom: minZoomRef.current,
      });

      const popoverX = position.x + nodeWidth + POPOVER_OFFSET;
      const popoverY = position.y + POPOVER_OFFSET;
      const { x, y } = clampPopoverPositionCanvas(
        popoverX,
        popoverY,
        targetView,
        viewport.clientWidth,
        viewport.clientHeight,
      );

      setSelectedId(nodeId);
      setPopover({ nodeId, x, y });
      flyToView(targetView);
    },
    [flyToView, nodeWidth, positions, view.zoom],
  );

  const closePopover = useCallback(() => {
    setPopover(null);
  }, []);

  useEffect(() => {
    if (!popover) return undefined;

    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      if (document.fullscreenElement === shellRef.current) return;
      closePopover();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePopover, popover]);

  const wrappedPointerUp = useCallback(
    (event) => {
      const wasBackgroundClick = handlePointerUp(event);
      if (
        wasBackgroundClick &&
        popover &&
        !event.target.closest("[data-guide-popover]") &&
        !event.target.closest("[data-guide-node]")
      ) {
        closePopover();
      }
    },
    [closePopover, handlePointerUp, popover],
  );

  const connectedBandEdgeKeys = useMemo(() => {
    const activeBandId = nodeBandId(selectedId, nodeMeta);
    if (!activeBandId) return new Set();

    const keys = new Set();
    for (const edge of bandEdges) {
      if (edge.from === activeBandId || edge.to === activeBandId) {
        keys.add(`${edge.from}-${edge.to}`);
      }
    }
    return keys;
  }, [bandEdges, nodeMeta, selectedId]);

  return (
    <div
      ref={shellRef}
      className={`relative overflow-hidden bg-cream/10 ${
        isFullscreen
          ? "flex h-full w-full flex-col rounded-none border-0 bg-night"
          : "rounded-2xl border border-ink/10"
      }`}
    >
      <CanvasToolbar
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onResetView={refitToView}
      />

      <div
        ref={viewportRef}
        className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.06),transparent_55%)] ${cursorClass} ${
          isFullscreen ? "h-full" : "h-[min(72vh,860px)]"
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={wrappedPointerUp}
        onPointerCancel={wrappedPointerUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div
          className="absolute left-0 top-0 will-change-transform"
          style={{
            width: canvasWidth,
            height: canvasHeight,
            transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
            transformOrigin: "0 0",
           transition: isDragging
              ? "none"
              : isFlying
                ? `transform ${FLY_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
                : "transform 0.18s ease-out",
          }}
        >
          <div
            data-guide-pan-surface
            className="absolute inset-0 z-0"
            aria-hidden="true"
          />

          {bands.map((band) => (
            <GuideSectionBand key={band.id} band={band} />
          ))}

          <svg
            className="pointer-events-none absolute inset-0 z-[1]"
            width={canvasWidth}
            height={canvasHeight}
            aria-hidden="true"
          >
            {bandEdges.map((edge) => {
              const fromBand = bandById.get(edge.from);
              const toBand = bandById.get(edge.to);
              if (!fromBand || !toBand) return null;

              const key = `${edge.from}-${edge.to}`;
              const highlighted = connectedBandEdgeKeys.has(key);
              const { path } = computeBandEdgeGeometry(fromBand, toBand);

              return (
                <path
                  key={key}
                  d={path}
                  fill="none"
                  stroke={highlighted ? "rgba(224, 81, 138, 0.55)" : "rgba(100, 116, 139, 0.28)"}
                  strokeWidth={highlighted ? 2.25 : 1.5}
                />
              );
            })}
          </svg>

          {nodes.map((node) => (
            <TreeNodeButton
              key={node.id}
              nodeId={node.id}
              x={node.x}
              y={node.y}
              width={nodeWidth}
              height={nodeHeight}
              selected={selectedId === node.id}
              section={nodeMeta.get(node.id)?.section}
              step={nodeMeta.get(node.id)?.step}
              onSelect={openPopover}
              suppressClickRef={suppressClickRef}
              spaceHeld={spaceHeld}
            />
          ))}

          {popover ? (
            <NodePopover
              nodeId={popover.nodeId}
              x={popover.x}
              y={popover.y}
              section={nodeMeta.get(popover.nodeId)?.section}
              onClose={closePopover}
              onNavigateToNode={navigatePopoverToNode}
            />
          ) : null}
        </div>
      </div>

      {!isFullscreen ? (
        <p className="pointer-events-none absolute bottom-3 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-ink/10 bg-ink/[0.04] px-3 py-1 text-[10px] text-ink/45 backdrop-blur-sm">
          Click a step · Scroll to zoom · Space + drag to pan
        </p>
      ) : null}
    </div>
  );
}

export default function RestorationGuide() {
  const layout = useMemo(() => buildGuideGraphLayout(), []);

  return <GuideTreeCanvas layout={layout} />;
}

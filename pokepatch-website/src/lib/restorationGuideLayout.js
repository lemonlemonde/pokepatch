import {
  RESTORATION_GUIDE_DAMAGE_BRANCHES,
  RESTORATION_GUIDE_NODES,
  RESTORATION_GUIDE_STEPS,
  RESTORATION_GUIDE_TECHNIQUES,
} from "@/lib/restorationGuideTree";

export const NODE_WIDTH = 156;
export const NODE_HEIGHT = 52;
const V_GAP = 48;
const TECHNIQUE_V_GAP = 32;
const H_GAP = 20;
const BAND_GAP = 40;
const BAND_PADDING = 22;
const BAND_LABEL_HEIGHT = 26;
export const CANVAS_PADDING = 48;

const DAMAGE_COLS = 3;

/**
 * @typedef {{ id: string, x: number, y: number, depth: number, section?: string, step?: number }} LayoutNode
 * @typedef {{ from: string, to: string, label: string }} LayoutBandEdge
 * @typedef {{ id: string, label: string, x: number, y: number, width: number, height: number }} LayoutBand
 */

function wrapText(text, maxLineLength = 22, maxLines = 2) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  /** @type {string[]} */
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLineLength) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);
    current = word.length > maxLineLength ? `${word.slice(0, maxLineLength - 1)}…` : word;

    if (lines.length >= maxLines - 1) break;
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] =
      last.length > maxLineLength - 1
        ? `${last.slice(0, maxLineLength - 2)}…`
        : `${last}…`;
  }

  return lines.slice(0, maxLines);
}

export function displayNodeLines(nodeId) {
  const node = RESTORATION_GUIDE_NODES[nodeId];
  if (!node) return [nodeId];
  return wrapText(node.title, 24, 2);
}

export function nodeBranchLabel(nodeId) {
  if (nodeId.startsWith("technique_")) return "Techniques";
  if (nodeId === "core_concepts") return "Core concepts";
  if (nodeId === "dirt_start" || nodeId === "scratches_start") return "Start";
  if (nodeId === "other_damage") return "Start";
  if (nodeId === "cool_press" || nodeId === "all_done") return "Wrap up";

  const step = RESTORATION_GUIDE_STEPS.find((entry) => entry.id === nodeId);
  return step?.label ?? null;
}

function bandBox(x, y, innerWidth, innerHeight, label) {
  return {
    x,
    y,
    width: innerWidth + BAND_PADDING * 2,
    height: BAND_LABEL_HEIGHT + BAND_PADDING + innerHeight + BAND_PADDING,
    label,
  };
}

/** Three-column dashboard: Start | Damage + Wrap up | Techniques */
export function buildGuideGraphLayout() {
  /** @type {LayoutNode[]} */
  const nodes = [];
  /** @type {LayoutBandEdge[]} */
  const bandEdges = [];
  /** @type {LayoutBand[]} */
  const bands = [];

  const bandTop = CANVAS_PADDING;

  // —— Core concepts band (above start) ——
  const coreConceptsBand = bandBox(
    CANVAS_PADDING,
    bandTop,
    NODE_WIDTH,
    NODE_HEIGHT,
    "Core concepts",
  );
  bands.push({ id: "core_concepts", ...coreConceptsBand });

  nodes.push({
    id: "core_concepts",
    x: coreConceptsBand.x + BAND_PADDING,
    y: coreConceptsBand.y + BAND_LABEL_HEIGHT + BAND_PADDING,
    depth: 0,
    section: "concepts",
  });

  const startBandTop = coreConceptsBand.y + coreConceptsBand.height + BAND_GAP;

  // —— Start band (left) ——
  const startStackHeight = 3 * NODE_HEIGHT + 2 * V_GAP;
  const startInnerWidth = NODE_WIDTH;
  const startBand = bandBox(CANVAS_PADDING, startBandTop, startInnerWidth, startStackHeight, "Start");
  bands.push({ id: "start", ...startBand });

  const startX = startBand.x + BAND_PADDING;
  const startY = startBand.y + BAND_LABEL_HEIGHT + BAND_PADDING;
  const startNodes = [
    { id: "dirt_start", step: 1 },
    { id: "scratches_start", step: 2 },
    { id: "other_damage", step: 3 },
  ];

  startNodes.forEach(({ id, step }, index) => {
    nodes.push({
      id,
      x: startX,
      y: startY + index * (NODE_HEIGHT + V_GAP),
      depth: index,
      section: "start",
      step,
    });
  });

  // —— Damage band (center) ——
  const damageBranches = RESTORATION_GUIDE_DAMAGE_BRANCHES;
  const damageRows = Math.ceil(damageBranches.length / DAMAGE_COLS);
  const damageGridWidth = DAMAGE_COLS * NODE_WIDTH + (DAMAGE_COLS - 1) * H_GAP;
  const damageGridHeight = damageRows * NODE_HEIGHT + (damageRows - 1) * V_GAP;
  const damageBandX = startBand.x + startBand.width + BAND_GAP;
  const damageBand = bandBox(damageBandX, startBandTop, damageGridWidth, damageGridHeight, "Other damage");
  bands.push({ id: "damage", ...damageBand });

  const damageInnerX = damageBand.x + BAND_PADDING;
  const damageInnerY = damageBand.y + BAND_LABEL_HEIGHT + BAND_PADDING;

  for (let index = 0; index < damageBranches.length; index += 1) {
    const branch = damageBranches[index];
    const col = index % DAMAGE_COLS;
    const row = Math.floor(index / DAMAGE_COLS);

    nodes.push({
      id: branch.id,
      x: damageInnerX + col * (NODE_WIDTH + H_GAP),
      y: damageInnerY + row * (NODE_HEIGHT + V_GAP),
      depth: row,
      section: "damage",
    });
  }

  bandEdges.push({ from: "core_concepts", to: "start", label: "Continue" });
  bandEdges.push({ from: "start", to: "damage", label: "Continue" });

  // —— Wrap up band (below damage) ——
  const wrapStackHeight = 2 * NODE_HEIGHT + V_GAP;
  const wrapBandY = damageBand.y + damageBand.height + BAND_GAP;
  const wrapBand = bandBox(damageBandX, wrapBandY, damageGridWidth, wrapStackHeight, "Wrap up");
  bands.push({ id: "wrap_up", ...wrapBand });

  const wrapX = wrapBand.x + BAND_PADDING + (damageGridWidth - NODE_WIDTH) / 2;
  const wrapY = wrapBand.y + BAND_LABEL_HEIGHT + BAND_PADDING;

  nodes.push(
    { id: "cool_press", x: wrapX, y: wrapY, depth: 0, section: "wrap_up", step: 1 },
    {
      id: "all_done",
      x: wrapX,
      y: wrapY + NODE_HEIGHT + V_GAP,
      depth: 1,
      section: "wrap_up",
      step: 2,
    },
  );

  bandEdges.push({ from: "damage", to: "wrap_up", label: "Continue" });

  // —— Techniques band (right) ——
  const techniquesInnerHeight =
    RESTORATION_GUIDE_TECHNIQUES.length * NODE_HEIGHT +
    Math.max(RESTORATION_GUIDE_TECHNIQUES.length - 1, 0) * TECHNIQUE_V_GAP;
  const techniquesBandX = damageBand.x + damageBand.width + BAND_GAP;
  const techniquesBand = bandBox(
    techniquesBandX,
    startBandTop,
    NODE_WIDTH,
    techniquesInnerHeight,
    "Techniques",
  );
  bands.push({ id: "techniques", ...techniquesBand });

  const techniquesInnerX = techniquesBand.x + BAND_PADDING;
  const techniquesInnerY = techniquesBand.y + BAND_LABEL_HEIGHT + BAND_PADDING;

  for (let index = 0; index < RESTORATION_GUIDE_TECHNIQUES.length; index += 1) {
    const technique = RESTORATION_GUIDE_TECHNIQUES[index];
    nodes.push({
      id: technique.id,
      x: techniquesInnerX,
      y: techniquesInnerY + index * (NODE_HEIGHT + TECHNIQUE_V_GAP),
      depth: index,
      section: "technique",
    });
  }

  const canvasWidth = techniquesBand.x + techniquesBand.width + CANVAS_PADDING;
  const canvasHeight = Math.max(
    wrapBand.y + wrapBand.height + CANVAS_PADDING,
    techniquesBand.y + techniquesBand.height + CANVAS_PADDING,
  );

  const positions = new Map(nodes.map((node) => [node.id, node]));

  return {
    nodes,
    bandEdges,
    positions,
    bands,
    canvasWidth,
    canvasHeight,
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
  };
}

/** Connect two section bands with a single clean elbow line. */
export function computeBandEdgeGeometry(fromBand, toBand) {
  const fromCx = fromBand.x + fromBand.width / 2;
  const fromCy = fromBand.y + fromBand.height / 2;
  const toCx = toBand.x + toBand.width / 2;
  const toCy = toBand.y + toBand.height / 2;

  const dx = toCx - fromCx;
  const dy = toCy - fromCy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const x1 = fromBand.x + fromBand.width;
    const y1 = fromCy;
    const x2 = toBand.x;
    const y2 = toCy;
    const midX = x1 + (x2 - x1) / 2;
    const path = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;

    return {
      path,
      labelX: midX,
      labelY: (y1 + y2) / 2,
    };
  }

  const x1 = fromCx;
  const y1 = fromBand.y + fromBand.height;
  const x2 = toCx;
  const y2 = toBand.y;
  const midY = y1 + (y2 - y1) / 2;
  const path = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;

  return {
    path,
    labelX: (x1 + x2) / 2,
    labelY: midY,
  };
}

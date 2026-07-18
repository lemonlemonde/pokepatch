import logoSrc from "@/app/pokepatch_icon.png";

export const INSTAGRAM_WIDTH = 1080;
export const INSTAGRAM_HEIGHT = 1080;
// --- 1×2 formatter layout (comparison / paired-sides) ---
export const EDGE_PADDING = 18;
export const COLUMN_GAP = 18;
export const SLOT_WIDTH =
  (INSTAGRAM_WIDTH - 2 * EDGE_PADDING - COLUMN_GAP) / 2;
export const LEFT_COLUMN_X = EDGE_PADDING;
export const RIGHT_COLUMN_X = EDGE_PADDING + SLOT_WIDTH + COLUMN_GAP;
export const BACKGROUND = "#000000";
export const LABEL_FONT_SIZE = 34;
export const LABEL_FONT_FAMILY =
  'Nunito, "Helvetica Neue", Helvetica, Arial, sans-serif';
export const LABEL_COLOR = "rgba(255, 255, 255, 0.9)";
export const LABEL_TRACKING = 14;
export const LABEL_GAP = 28;
export const BRAND_HANDLE = "@pokepatch.cards";
export const LABEL_BLOCK_HEIGHT = LABEL_GAP + LABEL_FONT_SIZE;
export const CARD_RADIUS = 8;

// --- 2×2 grid formatter layout ---
// Photos are typically 3024×4032 (3:4 portrait). Card cells are sized for that
// aspect; GRID_*_GAP is the only space between the actual photo edges.
export const GRID_CARD_ASPECT = 3024 / 4032; // width / height
// Outer margin on the left/right (and contributes to the top with the brand band).
export const GRID_EDGE_PADDING = 25;
// Gap between the BEFORE | AFTER photo edges.
export const GRID_COLUMN_GAP = 80;
// Equal clear air from card edge → letter tops and letter bottoms → next cards.
export const GRID_LABEL_GAP = 18;
// Extra space at the bottom of the canvas only (on top of GRID_EDGE_PADDING).
export const GRID_BOTTOM_PADDING = 10;
// Reserved top space so the branding badge doesn't sit on the cards.
export const GRID_TOP_BRAND_BAND = 80;

/** Ink bounds for BEFORE/AFTER (caps sit high in the em box; don't use font size). */
function measureGridLabelInk(ctx) {
  ctx.save();
  ctx.font = `500 ${LABEL_FONT_SIZE}px ${LABEL_FONT_FAMILY}`;
  ctx.textBaseline = "alphabetic";
  const before = ctx.measureText("BEFORE");
  const after = ctx.measureText("AFTER");
  ctx.restore();
  const ascent = Math.max(
    before.actualBoundingBoxAscent || LABEL_FONT_SIZE * 0.75,
    after.actualBoundingBoxAscent || LABEL_FONT_SIZE * 0.75,
  );
  const descent = Math.max(
    before.actualBoundingBoxDescent || LABEL_FONT_SIZE * 0.1,
    after.actualBoundingBoxDescent || LABEL_FONT_SIZE * 0.1,
  );
  return { ascent, descent, height: ascent + descent };
}

/** Max 3:4 card size that fits the grid with the current gaps. */
function getGridCardMaxSize(rowCount, cardsRegionHeight) {
  const availableW = INSTAGRAM_WIDTH - 2 * GRID_EDGE_PADDING;
  const maxH = Math.max(1, cardsRegionHeight / Math.max(rowCount, 1));
  const maxW = Math.max(1, (availableW - GRID_COLUMN_GAP) / 2);

  let cardW = maxW;
  let cardH = cardW / GRID_CARD_ASPECT;
  if (cardH > maxH) {
    cardH = maxH;
    cardW = cardH * GRID_CARD_ASPECT;
  }
  return {
    cardW: Math.max(1, Math.floor(cardW)),
    cardH: Math.max(1, Math.floor(cardH)),
  };
}

let labelFontReady;
let logoReady;

function resolveAssetSrc(src) {
  return typeof src === "string" ? src : src.src;
}

export function enableHighQuality(ctx) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
}

export function ensureLabelFont() {
  if (!labelFontReady) {
    labelFontReady = document.fonts
      .load(`500 ${LABEL_FONT_SIZE}px Nunito`)
      .catch(() => undefined);
  }
  return labelFontReady;
}

/** Opaque content box — the PNG has wide transparent padding L/R. */
function getOpaqueBounds(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { sx: 0, sy: 0, sw: width, sh: height };
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const side = Math.ceil(Math.max(maxX - minX + 1, maxY - minY + 1) * 1.02);
  const sx = Math.max(0, Math.floor(cx - side / 2));
  const sy = Math.max(0, Math.floor(cy - side / 2));
  return {
    sx,
    sy,
    sw: Math.min(side, width - sx),
    sh: Math.min(side, height - sy),
  };
}

export function ensureLogo() {
  if (!logoReady) {
    logoReady = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        img.contentBounds = getOpaqueBounds(img);
        resolve(img);
      };
      img.onerror = () => reject(new Error("Failed to load PokePatch logo"));
      img.src = resolveAssetSrc(logoSrc);
    });
  }
  return logoReady;
}

export function getSourceDimensions(source) {
  return {
    width: source.videoWidth || source.naturalWidth || source.width,
    height: source.videoHeight || source.naturalHeight || source.height,
  };
}

export function fillBackground(ctx) {
  const gradient = ctx.createRadialGradient(
    INSTAGRAM_WIDTH / 2,
    INSTAGRAM_HEIGHT * 0.42,
    0,
    INSTAGRAM_WIDTH / 2,
    INSTAGRAM_HEIGHT * 0.42,
    INSTAGRAM_WIDTH * 0.78,
  );
  gradient.addColorStop(0, "#14141c");
  gradient.addColorStop(1, BACKGROUND);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, INSTAGRAM_WIDTH, INSTAGRAM_HEIGHT);
}

/** Fit the full image inside the slot (contain) — no cropping. */
export function getContainMetrics(source, width, maxHeight) {
  const { width: sourceWidth, height: sourceHeight } =
    getSourceDimensions(source);
  const scale = Math.min(width / sourceWidth, maxHeight / sourceHeight);
  const newW = Math.round(sourceWidth * scale);
  const newH = Math.round(sourceHeight * scale);

  return { newW, newH, sw: newW, sh: newH, sx: 0, sy: 0 };
}

/** Shared frame: same width for both; height matches the taller scaled card. */
export function getSharedTargetSize(leftMetrics, rightMetrics, maxSlotWidth) {
  const targetSw = Math.min(
    maxSlotWidth,
    Math.max(leftMetrics.sw, rightMetrics.sw),
  );
  const leftH = Math.round(leftMetrics.sh * (targetSw / leftMetrics.sw));
  const rightH = Math.round(rightMetrics.sh * (targetSw / rightMetrics.sw));
  return { targetSw, targetSh: Math.max(leftH, rightH) };
}

export function prepareResized(source, metrics) {
  const resized = document.createElement("canvas");
  resized.width = metrics.newW;
  resized.height = metrics.newH;
  const ctx = resized.getContext("2d");
  enableHighQuality(ctx);
  ctx.drawImage(source, 0, 0, metrics.newW, metrics.newH);
  return resized;
}

function drawCard(ctx, resized, metrics, drawX, drawY, targetSw, targetSh) {
  // Same width as the taller card's frame; preserve aspect (no crop).
  let drawW = targetSw;
  let drawH = Math.round(metrics.sh * (targetSw / metrics.sw));
  if (drawH > targetSh) {
    const fit = targetSh / drawH;
    drawW = Math.round(drawW * fit);
    drawH = targetSh;
  }
  // Equal white extension above and below when this card is shorter.
  const imageX = drawX + Math.floor((targetSw - drawW) / 2);
  const imageY = drawY + Math.floor((targetSh - drawH) / 2);

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(drawX, drawY, targetSw, targetSh, CARD_RADIUS);
  ctx.fill();
  ctx.restore();

  ctx.save();
  enableHighQuality(ctx);
  ctx.beginPath();
  ctx.roundRect(drawX, drawY, targetSw, targetSh, CARD_RADIUS);
  ctx.clip();
  ctx.drawImage(
    resized,
    metrics.sx,
    metrics.sy,
    metrics.sw,
    metrics.sh,
    imageX,
    imageY,
    drawW,
    drawH,
  );
  ctx.restore();

  ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(
    drawX + 0.5,
    drawY + 0.5,
    targetSw - 1,
    targetSh - 1,
    CARD_RADIUS,
  );
  ctx.stroke();
}

function drawTrackedText(ctx, text, centerX, y, tracking) {
  const chars = [...text];
  const widths = chars.map((char) => ctx.measureText(char).width);
  const totalWidth =
    widths.reduce((sum, width) => sum + width, 0) +
    tracking * Math.max(chars.length - 1, 0);
  let x = centerX - totalWidth / 2;

  ctx.textAlign = "left";
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, y);
    x += widths[i] + tracking;
  }
  ctx.textAlign = "center";
}

function drawColumn(
  ctx,
  resized,
  metrics,
  columnX,
  slotWidth,
  label,
  targetSw,
  targetSh,
  imageTop,
) {
  const drawX = columnX + Math.floor((slotWidth - targetSw) / 2);
  drawCard(ctx, resized, metrics, drawX, imageTop, targetSw, targetSh);

  ctx.font = `500 ${LABEL_FONT_SIZE}px ${LABEL_FONT_FAMILY}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = LABEL_COLOR;

  const labelY = imageTop + targetSh + LABEL_GAP + LABEL_FONT_SIZE / 2;
  drawTrackedText(
    ctx,
    label.toUpperCase(),
    columnX + slotWidth / 2,
    labelY,
    LABEL_TRACKING,
  );
}

export function drawBranding(ctx, logoImg) {
  const padding = 24;
  const maxFrameSize = 72;
  const gap = 10;
  const fontSize = 24;
  const innerPad = 14;

  // Keep the old small visual size (full-frame scale), but crop transparent
  // padding so it doesn't add empty space left/right of the mark in the badge.
  const bounds =
    logoImg.contentBounds ?? {
      sx: 0,
      sy: 0,
      sw: logoImg.naturalWidth,
      sh: logoImg.naturalHeight,
    };
  const logoScale = Math.min(
    maxFrameSize / logoImg.naturalWidth,
    maxFrameSize / logoImg.naturalHeight,
  );
  const logoW = Math.max(1, Math.round(bounds.sw * logoScale));
  const logoH = Math.max(1, Math.round(bounds.sh * logoScale));

  ctx.font = `500 ${fontSize}px ${LABEL_FONT_FAMILY}`;
  const textWidth = ctx.measureText(BRAND_HANDLE).width;
  const blockW = innerPad + logoW + gap + textWidth + innerPad;
  const blockH = Math.max(logoH, fontSize) + innerPad * 2;
  const blockX = INSTAGRAM_WIDTH - padding - blockW;
  const blockY = padding;

  ctx.fillStyle = "rgba(12, 12, 12, 0.88)";
  ctx.beginPath();
  ctx.roundRect(blockX, blockY, blockW, blockH, 12);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(blockX + 0.5, blockY + 0.5, blockW - 1, blockH - 1, 12);
  ctx.stroke();

  enableHighQuality(ctx);
  ctx.drawImage(
    logoImg,
    bounds.sx,
    bounds.sy,
    bounds.sw,
    bounds.sh,
    blockX + innerPad,
    blockY + (blockH - logoH) / 2,
    logoW,
    logoH,
  );

  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(
    BRAND_HANDLE,
    blockX + innerPad + logoW + gap,
    blockY + blockH / 2,
  );
}

export function drawComparisonFrame(
  ctx,
  leftSource,
  rightSource,
  leftLabel,
  rightLabel,
  logoImg,
) {
  const maxImageHeight =
    INSTAGRAM_HEIGHT - 2 * EDGE_PADDING - 2 * LABEL_BLOCK_HEIGHT;
  const leftMetrics = getContainMetrics(
    leftSource,
    SLOT_WIDTH,
    maxImageHeight,
  );
  const rightMetrics = getContainMetrics(
    rightSource,
    SLOT_WIDTH,
    maxImageHeight,
  );
  const { targetSw, targetSh } = getSharedTargetSize(
    leftMetrics,
    rightMetrics,
    SLOT_WIDTH,
  );
  const imageTop =
    EDGE_PADDING +
    Math.floor((INSTAGRAM_HEIGHT - 2 * EDGE_PADDING - targetSh) / 2);

  const leftResized = prepareResized(leftSource, leftMetrics);
  const rightResized = prepareResized(rightSource, rightMetrics);

  enableHighQuality(ctx);
  fillBackground(ctx);
  drawColumn(
    ctx,
    leftResized,
    leftMetrics,
    LEFT_COLUMN_X,
    SLOT_WIDTH,
    leftLabel,
    targetSw,
    targetSh,
    imageTop,
  );
  drawColumn(
    ctx,
    rightResized,
    rightMetrics,
    RIGHT_COLUMN_X,
    SLOT_WIDTH,
    rightLabel,
    targetSw,
    targetSh,
    imageTop,
  );
  drawBranding(ctx, logoImg);
}

/**
 * Front | back side-by-side with a single centered label (e.g. BEFORE / AFTER).
 */
export function drawPairedSidesFrame(
  ctx,
  leftSource,
  rightSource,
  label,
  logoImg,
) {
  const maxImageHeight =
    INSTAGRAM_HEIGHT - 2 * EDGE_PADDING - LABEL_BLOCK_HEIGHT;
  const leftMetrics = getContainMetrics(
    leftSource,
    SLOT_WIDTH,
    maxImageHeight,
  );
  const rightMetrics = getContainMetrics(
    rightSource,
    SLOT_WIDTH,
    maxImageHeight,
  );
  const { targetSw, targetSh } = getSharedTargetSize(
    leftMetrics,
    rightMetrics,
    SLOT_WIDTH,
  );
  const blockHeight = targetSh + LABEL_BLOCK_HEIGHT;
  const imageTop =
    EDGE_PADDING +
    Math.floor((INSTAGRAM_HEIGHT - 2 * EDGE_PADDING - blockHeight) / 2);

  const leftResized = prepareResized(leftSource, leftMetrics);
  const rightResized = prepareResized(rightSource, rightMetrics);

  enableHighQuality(ctx);
  fillBackground(ctx);

  const leftDrawX = LEFT_COLUMN_X + Math.floor((SLOT_WIDTH - targetSw) / 2);
  const rightDrawX = RIGHT_COLUMN_X + Math.floor((SLOT_WIDTH - targetSw) / 2);
  drawCard(ctx, leftResized, leftMetrics, leftDrawX, imageTop, targetSw, targetSh);
  drawCard(
    ctx,
    rightResized,
    rightMetrics,
    rightDrawX,
    imageTop,
    targetSw,
    targetSh,
  );

  ctx.font = `500 ${LABEL_FONT_SIZE}px ${LABEL_FONT_FAMILY}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = LABEL_COLOR;
  const labelY = imageTop + targetSh + LABEL_GAP + LABEL_FONT_SIZE / 2;
  drawTrackedText(
    ctx,
    label.toUpperCase(),
    INSTAGRAM_WIDTH / 2,
    labelY,
    LABEL_TRACKING,
  );

  drawBranding(ctx, logoImg);
}

/**
 * Draw a 2×2 before/after grid. Each row is one before/after pair (before in
 * the left column, after in the right); up to 2 rows are supported. BEFORE /
 * AFTER labels sit in the middle band between the two rows (or under a single
 * row), with equal clear padding from card edges to the letter ink bounds.
 *
 * Cells are sized for 3024×4032 (3:4). Each card frame matches its image
 * (no shared square pad). Gaps are between the actual photo edges.
 *
 * Spacing knobs (grid-only — see GRID_* constants above):
 *   GRID_EDGE_PADDING     — left/right (and base) outer margin
 *   GRID_COLUMN_GAP       — space between BEFORE | AFTER photo edges
 *   GRID_LABEL_GAP        — equal space above & below BEFORE / AFTER text
 *   GRID_BOTTOM_PADDING   — extra bottom-only margin
 */
export function drawGridFrame(ctx, rows, logoImg) {
  enableHighQuality(ctx);
  fillBackground(ctx);

  const rowCount = rows.length;
  const contentTop = GRID_EDGE_PADDING + GRID_TOP_BRAND_BAND;
  const contentBottom =
    INSTAGRAM_HEIGHT - GRID_EDGE_PADDING - GRID_BOTTOM_PADDING;
  const rowsRegionHeight = contentBottom - contentTop;
  const labelInk = measureGridLabelInk(ctx);
  const midBand = 2 * GRID_LABEL_GAP + labelInk.height;
  const cardsRegionHeight = Math.max(1, rowsRegionHeight - midBand);
  const { cardW: maxCardW, cardH: maxCardH } = getGridCardMaxSize(
    rowCount,
    cardsRegionHeight,
  );
  const centerX = INSTAGRAM_WIDTH / 2;
  const beforeLabelX =
    centerX - Math.floor(GRID_COLUMN_GAP / 2) - maxCardW / 2;
  const afterLabelX = centerX + Math.ceil(GRID_COLUMN_GAP / 2) + maxCardW / 2;

  const rowData = rows.map((row) => {
    // Contain-fit into the 3:4 cell. Exact 3024×4032 photos fill it with no pad.
    const leftMetrics = getContainMetrics(row.before, maxCardW, maxCardH);
    const rightMetrics = getContainMetrics(row.after, maxCardW, maxCardH);
    return {
      leftMetrics,
      rightMetrics,
      leftResized: prepareResized(row.before, leftMetrics),
      rightResized: prepareResized(row.after, rightMetrics),
      leftW: leftMetrics.sw,
      leftH: leftMetrics.sh,
      rightW: rightMetrics.sw,
      rightH: rightMetrics.sh,
      rowH: Math.max(leftMetrics.sh, rightMetrics.sh),
    };
  });

  const cardsHeight = rowData.reduce((sum, row) => sum + row.rowH, 0);
  const blockHeight = cardsHeight + midBand;
  let cursorY =
    contentTop + Math.floor((rowsRegionHeight - blockHeight) / 2);

  function drawRow(row, rowTop) {
    const leftDrawX = centerX - Math.floor(GRID_COLUMN_GAP / 2) - row.leftW;
    const rightDrawX = centerX + Math.ceil(GRID_COLUMN_GAP / 2);
    const leftDrawY = rowTop + Math.floor((row.rowH - row.leftH) / 2);
    const rightDrawY = rowTop + Math.floor((row.rowH - row.rightH) / 2);

    drawCard(
      ctx,
      row.leftResized,
      row.leftMetrics,
      leftDrawX,
      leftDrawY,
      row.leftW,
      row.leftH,
    );
    drawCard(
      ctx,
      row.rightResized,
      row.rightMetrics,
      rightDrawX,
      rightDrawY,
      row.rightW,
      row.rightH,
    );
  }

  // First row (or the only row).
  drawRow(rowData[0], cursorY);
  cursorY += rowData[0].rowH;

  // BEFORE / AFTER: GRID_LABEL_GAP clear air above ink top and below ink bottom.
  ctx.font = `500 ${LABEL_FONT_SIZE}px ${LABEL_FONT_FAMILY}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = LABEL_COLOR;
  const labelY = cursorY + GRID_LABEL_GAP + labelInk.ascent;
  drawTrackedText(ctx, "BEFORE", beforeLabelX, labelY, LABEL_TRACKING);
  drawTrackedText(ctx, "AFTER", afterLabelX, labelY, LABEL_TRACKING);
  cursorY += midBand;

  // Second row, when present.
  if (rowCount > 1) {
    drawRow(rowData[1], cursorY);
  }

  drawBranding(ctx, logoImg);
}

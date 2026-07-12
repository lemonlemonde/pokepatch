import logoSrc from "@/app/pokepatch_icon.png";

export const INSTAGRAM_WIDTH = 1080;
export const INSTAGRAM_HEIGHT = 1080;
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

export function ensureLogo() {
  if (!logoReady) {
    logoReady = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
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
  const maxLogoSize = 72;
  const gap = 10;
  const fontSize = 24;
  const innerPad = 14;

  const logoScale = Math.min(
    maxLogoSize / logoImg.naturalWidth,
    maxLogoSize / logoImg.naturalHeight,
  );
  const logoW = Math.round(logoImg.naturalWidth * logoScale);
  const logoH = Math.round(logoImg.naturalHeight * logoScale);

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

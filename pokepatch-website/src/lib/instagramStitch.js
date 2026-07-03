import logoSrc from "@/app/pokepatch_icon.png";

const INSTAGRAM_WIDTH = 1080;
const INSTAGRAM_HEIGHT = 1080;
const EDGE_PADDING = 18;
const COLUMN_GAP = 18;
const SLOT_WIDTH = (INSTAGRAM_WIDTH - 2 * EDGE_PADDING - COLUMN_GAP) / 2;
const LEFT_COLUMN_X = EDGE_PADDING;
const RIGHT_COLUMN_X = EDGE_PADDING + SLOT_WIDTH + COLUMN_GAP;
const DIVIDER_X = EDGE_PADDING + SLOT_WIDTH + COLUMN_GAP / 2;
const BACKGROUND = "#000000";
const LABEL_FONT_SIZE = 34;
const LABEL_FONT_FAMILY = 'Nunito, "Helvetica Neue", Helvetica, Arial, sans-serif';
const LABEL_COLOR = "rgba(255, 255, 255, 0.9)";
const LABEL_TRACKING = 14;
const LABEL_GAP = 28;
const CROP_TIGHTNESS = 0.28;
const BRAND_HANDLE = "@pokepatch.cards";
const LABEL_BLOCK_HEIGHT = LABEL_GAP + LABEL_FONT_SIZE;
const CARD_RADIUS = 8;
const VERTICAL_CROP = 20;

let labelFontReady;
let logoReady;

function resolveAssetSrc(src) {
  return typeof src === "string" ? src : src.src;
}

function enableHighQuality(ctx) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
}

function ensureLabelFont() {
  if (!labelFontReady) {
    labelFontReady = document.fonts
      .load(`500 ${LABEL_FONT_SIZE}px Nunito`)
      .catch(() => undefined);
  }
  return labelFontReady;
}

function ensureLogo() {
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

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load ${file.name}`));
    };
    img.src = url;
  });
}

function fillBackground(ctx) {
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

function getSlightCropMetrics(img, width, maxHeight) {
  const containScale = Math.min(width / img.width, maxHeight / img.height);
  const coverScale = Math.max(width / img.width, maxHeight / img.height);
  const scale =
    containScale + (coverScale - containScale) * CROP_TIGHTNESS;

  const newW = Math.round(img.width * scale);
  const newH = Math.round(img.height * scale);
  const sw = Math.min(width, newW);
  const sh = Math.min(maxHeight, newH);
  const sx = Math.max(0, Math.floor((newW - width) / 2));
  const sy = Math.max(0, Math.floor((newH - maxHeight) / 2));

  return { newW, newH, sw, sh, sx, sy };
}

function getSharedTargetSize(leftMetrics, rightMetrics) {
  const targetSh = Math.max(leftMetrics.sh, rightMetrics.sh);
  const leftW = Math.round(leftMetrics.sw * (targetSh / leftMetrics.sh));
  const rightW = Math.round(rightMetrics.sw * (targetSh / rightMetrics.sh));
  const targetSw = Math.max(leftW, rightW);

  return { targetSw, targetSh };
}

function prepareResized(img, metrics) {
  const resized = document.createElement("canvas");
  resized.width = metrics.newW;
  resized.height = metrics.newH;
  const ctx = resized.getContext("2d");
  enableHighQuality(ctx);
  ctx.drawImage(img, 0, 0, metrics.newW, metrics.newH);
  return resized;
}

function getVerticalCrop(targetSh) {
  return Math.min(VERTICAL_CROP, Math.floor(targetSh / 4));
}

function drawCard(ctx, resized, metrics, drawX, drawY, targetSw, targetSh) {
  const crop = getVerticalCrop(targetSh);
  const frameY = drawY + crop;
  const frameH = targetSh - 2 * crop;
  const cropRatio = crop / targetSh;
  const srcY = metrics.sy + metrics.sh * cropRatio;
  const srcH = metrics.sh * (1 - 2 * cropRatio);

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#0d0d0d";
  ctx.beginPath();
  ctx.roundRect(drawX, frameY, targetSw, frameH, CARD_RADIUS);
  ctx.fill();
  ctx.restore();

  ctx.save();
  enableHighQuality(ctx);
  ctx.beginPath();
  ctx.roundRect(drawX, frameY, targetSw, frameH, CARD_RADIUS);
  ctx.clip();
  ctx.drawImage(
    resized,
    metrics.sx,
    srcY,
    metrics.sw,
    srcH,
    drawX,
    frameY,
    targetSw,
    frameH,
  );
  ctx.restore();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(
    drawX + 0.5,
    frameY + 0.5,
    targetSw - 1,
    frameH - 1,
    CARD_RADIUS,
  );
  ctx.stroke();
}

function drawCenterDivider(ctx, imageTop, imageHeight) {
  const crop = getVerticalCrop(imageHeight);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(DIVIDER_X + 0.5, imageTop + crop + 16);
  ctx.lineTo(DIVIDER_X + 0.5, imageTop + imageHeight - crop - 16);
  ctx.stroke();
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
  const crop = getVerticalCrop(targetSh);
  drawCard(ctx, resized, metrics, drawX, imageTop, targetSw, targetSh);

  ctx.font = `500 ${LABEL_FONT_SIZE}px ${LABEL_FONT_FAMILY}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = LABEL_COLOR;

  const labelY =
    imageTop + targetSh - crop + LABEL_GAP + LABEL_FONT_SIZE / 2;
  drawTrackedText(
    ctx,
    label.toUpperCase(),
    columnX + slotWidth / 2,
    labelY,
    LABEL_TRACKING,
  );
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

function drawBranding(ctx, logoImg) {
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

async function stitchComparison(leftFile, rightFile, leftLabel, rightLabel) {
  const [, logoImg] = await Promise.all([ensureLabelFont(), ensureLogo()]);

  const [leftImg, rightImg] = await Promise.all([
    loadImage(leftFile),
    loadImage(rightFile),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = INSTAGRAM_WIDTH;
  canvas.height = INSTAGRAM_HEIGHT;

  const maxImageHeight =
    INSTAGRAM_HEIGHT - 2 * EDGE_PADDING - 2 * LABEL_BLOCK_HEIGHT;
  const leftMetrics = getSlightCropMetrics(leftImg, SLOT_WIDTH, maxImageHeight);
  const rightMetrics = getSlightCropMetrics(rightImg, SLOT_WIDTH, maxImageHeight);
  const { targetSw, targetSh } = getSharedTargetSize(leftMetrics, rightMetrics);
  const imageTop =
    EDGE_PADDING +
    Math.floor((INSTAGRAM_HEIGHT - 2 * EDGE_PADDING - targetSh) / 2);

  const leftResized = prepareResized(leftImg, leftMetrics);
  const rightResized = prepareResized(rightImg, rightMetrics);

  const ctx = canvas.getContext("2d");
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
  drawCenterDivider(ctx, imageTop, targetSh);
  drawBranding(ctx, logoImg);

  return canvas;
}

export async function stitchBothPosts(files) {
  const [beforeFront, beforeBack, afterFront, afterBack] = files;
  const [front, back] = await Promise.all([
    stitchComparison(beforeFront, afterFront, "before", "after"),
    stitchComparison(beforeBack, afterBack, "before", "after"),
  ]);
  return { front, back };
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to export image"));
      },
      "image/png",
    );
  });
}

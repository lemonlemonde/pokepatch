/**
 * Server-side Instagram carousel (4:5) before/after stitch for the
 * discord-clamperl app. Mirrors the Studio carousel experiment layout in
 * studioLayout.js at logical 1080×1350 and exports lossless PNG (no Studio 6×
 * JPEG path).
 */

import { Image } from "npm:imagescript@3.12.2";

export const CAROUSEL_WIDTH = 1080;
export const CAROUSEL_HEIGHT = 1350;

/** Fetched once per isolate — Edge does not bundle loose Deno.readFile assets. */
const NUNITO_REF = "8c6a9bb9732545b9ed53f29ec5e1ab0ff53c4e6f";
const NUNITO_URL =
  `https://cdn.jsdelivr.net/gh/googlefonts/nunito@${NUNITO_REF}/fonts/variable/Nunito%5Bwght%5D.ttf`;
const NUNITO_ITALIC_URL =
  `https://cdn.jsdelivr.net/gh/googlefonts/nunito@${NUNITO_REF}/fonts/variable/Nunito-Italic%5Bwght%5D.ttf`;
const LOGO_URL = "https://pokepatch.cards/email/pokepatch-icon.png";

/** Overview pairs skipped at the start of each side (before[0..1], after[0..1]). */
export const SKIP_OVERVIEW_PAIRS = 2;

const BACKGROUND = 0x000000ff;
const LABEL_COLOR = 0xffffffe6; // ~0.9 alpha
const BRAND_HANDLE = "@pokepatch.cards";
const CARD_RADIUS = 8;
const BADGE_RADIUS = 12;
const THUMB_RADIUS = 14;

/** Experiment carousel metrics — keep in sync with studioLayout.js. */
const EDGE = 28;
const COLUMN_GAP = 24;
const CONTENT_TOP = 28;
const LABEL_FONT = 28;
const LABEL_GAP = 18;
const LABEL_TRACKING = 10;
const CHIP_THUMB = 168;
const CHIP_FONT = 28;
const CHIP_TEXT_W = 400;
const CHIP_PAD_X = 14;
const CHIP_PAD_Y = 10;
const CHIP_GAP = 40;
const CHIP_TEXT_GAP = 12;
const CHIP_LINE_GAP = 6;
const BRAND_FRAME = 48;
const BRAND_FONT = 22;
const BRAND_PAD = 12;
const BRAND_GAP = 16;
const BRANDING_GAP_ABOVE_IMAGES = 24;
const LABEL_BLOCK_HEIGHT = LABEL_GAP + LABEL_FONT;

const SLOT_WIDTH = (CAROUSEL_WIDTH - 2 * EDGE - COLUMN_GAP) / 2;
const LEFT_X = EDGE;
const RIGHT_X = EDGE + SLOT_WIDTH + COLUMN_GAP;

export type CarouselOverlay = {
  card?: string;
  set?: string;
  frontBytes?: Uint8Array | null;
};

export type CarouselPairInput = {
  beforeBytes: Uint8Array;
  afterBytes: Uint8Array;
};

type Assets = {
  font: Uint8Array;
  fontItalic: Uint8Array;
  logo: Image;
  logoBounds: { sx: number; sy: number; sw: number; sh: number };
};

let assetsPromise: Promise<Assets> | null = null;

async function fetchBytes(url: string, label: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${label} (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Load fonts/logo over HTTPS and cache on the isolate. Loose files under
 * `_shared/` are not included in the Supabase Edge bundle, so readFile fails
 * on hosted functions.
 */
async function loadAssets(): Promise<Assets> {
  const [font, fontItalic, logoBytes] = await Promise.all([
    fetchBytes(NUNITO_URL, "Nunito"),
    fetchBytes(NUNITO_ITALIC_URL, "Nunito Italic"),
    fetchBytes(LOGO_URL, "PokePatch logo"),
  ]);
  const logo = await Image.decode(logoBytes);
  return {
    font,
    fontItalic,
    logo,
    logoBounds: opaqueBounds(logo),
  };
}

function ensureAssets(): Promise<Assets> {
  if (!assetsPromise) assetsPromise = loadAssets();
  return assetsPromise;
}

/** Warm fonts/logo before the first stitch (call once per job). */
export function preloadInstaAssets(): Promise<unknown> {
  return ensureAssets();
}

function opaqueBounds(img: Image): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
} {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const alpha = img.getPixelAt(x, y) & 0xff;
      if (alpha > 16) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return { sx: 0, sy: 0, sw: img.width, sh: img.height };
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const side = Math.ceil(Math.max(maxX - minX + 1, maxY - minY + 1) * 1.02);
  const sx = Math.max(0, Math.floor(cx - side / 2));
  const sy = Math.max(0, Math.floor(cy - side / 2));
  return {
    sx,
    sy,
    sw: Math.min(side, img.width - sx),
    sh: Math.min(side, img.height - sy),
  };
}

function containSize(
  srcW: number,
  srcH: number,
  maxW: number,
  maxH: number
): { w: number; h: number } {
  const scale = Math.min(maxW / srcW, maxH / srcH);
  return {
    w: Math.max(1, Math.round(srcW * scale)),
    h: Math.max(1, Math.round(srcH * scale)),
  };
}

function sharedTarget(
  left: { w: number; h: number },
  right: { w: number; h: number },
  maxSlotWidth: number
): { tw: number; th: number } {
  const tw = Math.min(maxSlotWidth, Math.max(left.w, right.w));
  const leftH = Math.round(left.h * (tw / left.w));
  const rightH = Math.round(right.h * (tw / right.w));
  return { tw, th: Math.max(leftH, rightH) };
}

function prepareCard(source: Image, tw: number, th: number): Image {
  const card = source.clone().cover(tw, th);
  card.roundCorners(CARD_RADIUS);
  return card;
}

async function renderTrackedLabel(
  font: Uint8Array,
  text: string,
  size: number,
  tracking: number,
  color: number
): Promise<Image> {
  const chars = [...text.toUpperCase()];
  const glyphs: Image[] = [];
  for (const char of chars) {
    glyphs.push(
      await Image.renderText(font, size, char === " " ? "\u00a0" : char, color, undefined, {
        variations: { wght: 500 },
      })
    );
  }
  const totalW =
    glyphs.reduce((sum, g) => sum + g.width, 0) +
    tracking * Math.max(chars.length - 1, 0);
  const totalH = Math.max(...glyphs.map((g) => g.height), size);
  const out = new Image(Math.max(1, Math.ceil(totalW)), totalH);
  out.fill(0x00000000);
  let x = 0;
  for (let i = 0; i < glyphs.length; i += 1) {
    const g = glyphs[i];
    out.composite(g, Math.round(x), Math.round((totalH - g.height) / 2));
    x += g.width + tracking;
  }
  return out;
}

async function measureTextWidth(
  font: Uint8Array,
  text: string,
  size: number,
  weight: number,
  italic: boolean,
  italicFont: Uint8Array
): Promise<number> {
  if (!text) return 0;
  const img = await Image.renderText(
    italic ? italicFont : font,
    size,
    text,
    0xffffffff,
    undefined,
    { variations: { wght: weight } }
  );
  return img.width;
}

type FieldLine = { label: string; value: string };

async function layoutLabeledField(
  font: Uint8Array,
  italicFont: Uint8Array,
  label: string,
  value: string,
  fontSize: number,
  maxTextW: number,
  lineGap: number
): Promise<{ lines: FieldLine[]; height: number }> {
  const raw = (value ?? "").trim();
  const labelW = await measureTextWidth(font, label, fontSize, 700, false, italicFont);
  const firstValueMax = Math.max(8, maxTextW - labelW);
  const words = raw.split(/\s+/).filter(Boolean);
  const lines: FieldLine[] = [];
  let wordIndex = 0;

  let firstValue = "";
  while (wordIndex < words.length) {
    const next =
      firstValue.length === 0
        ? words[wordIndex]
        : `${firstValue} ${words[wordIndex]}`;
    const w = await measureTextWidth(font, next, fontSize, 400, true, italicFont);
    if (w <= firstValueMax) {
      firstValue = next;
      wordIndex += 1;
    } else {
      break;
    }
  }
  if (firstValue.length === 0 && wordIndex < words.length) {
    firstValue = words[wordIndex];
    wordIndex += 1;
  }
  lines.push({ label, value: firstValue });

  let current = "";
  while (wordIndex < words.length) {
    const word = words[wordIndex];
    const next = current.length === 0 ? word : `${current} ${word}`;
    const w = await measureTextWidth(font, next, fontSize, 400, true, italicFont);
    if (w <= maxTextW) {
      current = next;
      wordIndex += 1;
      continue;
    }
    if (current.length > 0) {
      lines.push({ label: "", value: current });
      current = "";
      continue;
    }
    lines.push({ label: "", value: word });
    wordIndex += 1;
  }
  if (current.length > 0) lines.push({ label: "", value: current });

  const height =
    lines.length * fontSize + Math.max(0, lines.length - 1) * lineGap;
  return { lines, height };
}

function drawBadgeBackground(
  canvas: Image,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const badge = new Image(Math.max(1, w), Math.max(1, h));
  badge.fill(0x0c0c0ce0);
  badge.roundCorners(BADGE_RADIUS);
  canvas.composite(badge, x, y);
}

async function drawLabeledLine(
  canvas: Image,
  font: Uint8Array,
  italicFont: Uint8Array,
  label: string,
  value: string,
  x: number,
  y: number,
  fontSize: number
): Promise<void> {
  let cursorX = x;
  if (label) {
    const labelImg = await Image.renderText(font, fontSize, label, 0xffffffeb, undefined, {
      variations: { wght: 700 },
    });
    canvas.composite(labelImg, cursorX, y);
    cursorX += labelImg.width;
  }
  if (value) {
    const valueImg = await Image.renderText(
      italicFont,
      fontSize,
      value,
      0xffffffeb,
      undefined,
      { variations: { wght: 400 } }
    );
    canvas.composite(valueImg, cursorX, y);
  }
}

async function drawCardInfo(
  canvas: Image,
  assets: Assets,
  overlay: CarouselOverlay,
  blockY: number
): Promise<void> {
  const card = (overlay.card ?? "").trim();
  const set = (overlay.set ?? "").trim();
  if (!card && !set && !overlay.frontBytes) return;

  let front: Image | null = null;
  if (overlay.frontBytes) {
    try {
      front = await Image.decode(overlay.frontBytes);
    } catch {
      front = null;
    }
  }

  const cardField = await layoutLabeledField(
    assets.font,
    assets.fontItalic,
    "Card: ",
    card,
    CHIP_FONT,
    CHIP_TEXT_W,
    CHIP_LINE_GAP
  );
  const setField = await layoutLabeledField(
    assets.font,
    assets.fontItalic,
    "Set: ",
    set,
    CHIP_FONT,
    CHIP_TEXT_W,
    CHIP_LINE_GAP
  );
  const textH = cardField.height + CHIP_LINE_GAP + setField.height;
  const textW = CHIP_TEXT_W;

  let thumbW = 0;
  let thumbH = 0;
  let thumb: Image | null = null;
  if (front) {
    const scale = Math.min(CHIP_THUMB / front.width, CHIP_THUMB / front.height);
    thumbW = Math.max(1, Math.round(front.width * scale));
    thumbH = Math.max(1, Math.round(front.height * scale));
    thumb = front.clone().fit(thumbW, thumbH);
    thumb.roundCorners(THUMB_RADIUS);
  }

  const blockW = CHIP_PAD_X + CHIP_THUMB + CHIP_TEXT_GAP + textW + CHIP_PAD_X;
  const blockH = Math.max(CHIP_THUMB, textH) + CHIP_PAD_Y * 2;
  const blockX = Math.floor((CAROUSEL_WIDTH - blockW) / 2);

  drawBadgeBackground(canvas, blockX, blockY, blockW, blockH);

  if (thumb) {
    const thumbX = blockX + CHIP_PAD_X + Math.floor((CHIP_THUMB - thumbW) / 2);
    const thumbY = blockY + Math.floor((blockH - thumbH) / 2);
    canvas.composite(thumb, thumbX, thumbY);
  }

  const textX = blockX + CHIP_PAD_X + CHIP_THUMB + CHIP_TEXT_GAP;
  let textTop = blockY + Math.floor((blockH - textH) / 2);
  for (const line of cardField.lines) {
    await drawLabeledLine(
      canvas,
      assets.font,
      assets.fontItalic,
      line.label,
      line.value,
      textX,
      textTop,
      CHIP_FONT
    );
    textTop += CHIP_FONT + CHIP_LINE_GAP;
  }
  // fieldGap === lineGap, so the trailing lineGap already spaces the fields.
  for (const line of setField.lines) {
    await drawLabeledLine(
      canvas,
      assets.font,
      assets.fontItalic,
      line.label,
      line.value,
      textX,
      textTop,
      CHIP_FONT
    );
    textTop += CHIP_FONT + CHIP_LINE_GAP;
  }
}

function chipHeight(): number {
  const textH = CHIP_FONT * 2 + CHIP_LINE_GAP;
  return Math.max(CHIP_THUMB, textH) + 2 * CHIP_PAD_Y;
}

function bottomReserve(hasCardInfo: boolean): number {
  if (!hasCardInfo) return EDGE;
  return CHIP_GAP + chipHeight() + EDGE;
}

async function measureBrandChip(assets: Assets): Promise<{
  blockW: number;
  blockH: number;
  logoW: number;
  logoH: number;
  textW: number;
}> {
  const bounds = assets.logoBounds;
  const logoScale = Math.min(BRAND_FRAME / bounds.sw, BRAND_FRAME / bounds.sh);
  const logoW = Math.max(1, Math.round(bounds.sw * logoScale));
  const logoH = Math.max(1, Math.round(bounds.sh * logoScale));
  const textImg = await Image.renderText(
    assets.font,
    BRAND_FONT,
    BRAND_HANDLE,
    0xffffffeb,
    undefined,
    { variations: { wght: 500 } }
  );
  const blockW = BRAND_PAD + logoW + BRAND_GAP + textImg.width + BRAND_PAD;
  const blockH = Math.max(logoH, BRAND_FONT) + BRAND_PAD * 2;
  return { blockW, blockH, logoW, logoH, textW: textImg.width };
}

async function drawBranding(
  canvas: Image,
  assets: Assets,
  placement: { x: number; y: number },
  measured: Awaited<ReturnType<typeof measureBrandChip>>
): Promise<void> {
  drawBadgeBackground(
    canvas,
    placement.x,
    placement.y,
    measured.blockW,
    measured.blockH
  );

  const bounds = assets.logoBounds;
  const logoCrop = assets.logo
    .clone()
    .crop(bounds.sx, bounds.sy, bounds.sw, bounds.sh)
    .resize(measured.logoW, measured.logoH);
  canvas.composite(
    logoCrop,
    placement.x + BRAND_PAD,
    placement.y + Math.floor((measured.blockH - measured.logoH) / 2)
  );

  const textImg = await Image.renderText(
    assets.font,
    BRAND_FONT,
    BRAND_HANDLE,
    0xffffffeb,
    undefined,
    { variations: { wght: 500 } }
  );
  canvas.composite(
    textImg,
    placement.x + BRAND_PAD + measured.logoW + BRAND_GAP,
    placement.y + Math.floor((measured.blockH - textImg.height) / 2)
  );
}

/**
 * Stitch one before/after pair into a 1080×1350 PNG.
 */
export async function stitchCarouselPairPng(
  beforeBytes: Uint8Array,
  afterBytes: Uint8Array,
  overlay: CarouselOverlay = {}
): Promise<Uint8Array> {
  const assets = await ensureAssets();
  const [beforeImg, afterImg] = await Promise.all([
    Image.decode(beforeBytes),
    Image.decode(afterBytes),
  ]);

  const hasCardInfo = Boolean(
    overlay.frontBytes || (overlay.card ?? "").trim() || (overlay.set ?? "").trim()
  );
  const reserve = bottomReserve(hasCardInfo);
  const brand = await measureBrandChip(assets);
  const brandLift = brand.blockH + BRANDING_GAP_ABOVE_IMAGES;

  const maxImageHeight =
    CAROUSEL_HEIGHT -
    CONTENT_TOP -
    brandLift -
    reserve -
    2 * LABEL_BLOCK_HEIGHT;

  const leftMetrics = containSize(
    beforeImg.width,
    beforeImg.height,
    SLOT_WIDTH,
    maxImageHeight
  );
  const rightMetrics = containSize(
    afterImg.width,
    afterImg.height,
    SLOT_WIDTH,
    maxImageHeight
  );
  const { tw, th } = sharedTarget(leftMetrics, rightMetrics, SLOT_WIDTH);
  const imagesAndLabelsHeight = th + LABEL_BLOCK_HEIGHT;

  const stackH = brandLift +
    (hasCardInfo
      ? imagesAndLabelsHeight + reserve - EDGE
      : imagesAndLabelsHeight);
  const bandH = CAROUSEL_HEIGHT - CONTENT_TOP - EDGE;
  const imageTop =
    CONTENT_TOP +
    brandLift +
    Math.max(0, Math.floor((bandH - stackH) / 2));

  const leftCard = prepareCard(beforeImg, tw, th);
  const rightCard = prepareCard(afterImg, tw, th);
  const [beforeLabel, afterLabel] = await Promise.all([
    renderTrackedLabel(assets.font, "before", LABEL_FONT, LABEL_TRACKING, LABEL_COLOR),
    renderTrackedLabel(assets.font, "after", LABEL_FONT, LABEL_TRACKING, LABEL_COLOR),
  ]);

  const canvas = new Image(CAROUSEL_WIDTH, CAROUSEL_HEIGHT);
  canvas.fill(BACKGROUND);

  const leftDrawX = LEFT_X + Math.floor((SLOT_WIDTH - tw) / 2);
  const rightDrawX = RIGHT_X + Math.floor((SLOT_WIDTH - tw) / 2);

  // Soft drop-shadow stand-in: offset dark rounded rect under each card.
  for (const x of [leftDrawX, rightDrawX]) {
    const shadow = new Image(tw, th);
    shadow.fill(0x0000008c);
    shadow.roundCorners(CARD_RADIUS);
    canvas.composite(shadow, x, imageTop + 8);
  }

  canvas.composite(leftCard, leftDrawX, imageTop);
  canvas.composite(rightCard, rightDrawX, imageTop);

  const labelY = imageTop + th + LABEL_GAP;
  canvas.composite(
    beforeLabel,
    LEFT_X + Math.floor((SLOT_WIDTH - beforeLabel.width) / 2),
    labelY
  );
  canvas.composite(
    afterLabel,
    RIGHT_X + Math.floor((SLOT_WIDTH - afterLabel.width) / 2),
    labelY
  );

  const afterCardRight = rightDrawX + tw;
  await drawBranding(
    canvas,
    assets,
    {
      x: afterCardRight - brand.blockW,
      y: imageTop - BRANDING_GAP_ABOVE_IMAGES - brand.blockH,
    },
    brand
  );

  if (hasCardInfo) {
    const contentBottom = imageTop + th + LABEL_BLOCK_HEIGHT;
    await drawCardInfo(canvas, assets, overlay, contentBottom + CHIP_GAP);
  }

  return await canvas.encodePNG();
}

/**
 * Stitch pairs one at a time. ImageScript hangs/OOMs on Edge when two
 * 1080×1350 stitches run concurrently — keep this strictly sequential.
 */
export async function stitchCarouselPairs(
  pairs: CarouselPairInput[],
  overlay: CarouselOverlay = {}
): Promise<{ key: string; label: string; png: Uint8Array }[]> {
  const solo = pairs.length === 1;
  const out: { key: string; label: string; png: Uint8Array }[] = [];
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    const png = await stitchCarouselPairPng(
      pair.beforeBytes,
      pair.afterBytes,
      overlay
    );
    const n = index + 1;
    out.push({
      key: `pair-${n}`,
      label: solo ? "Post" : `Pair ${n}`,
      png,
    });
  }
  return out;
}

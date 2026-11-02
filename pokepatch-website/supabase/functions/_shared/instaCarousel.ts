/**
 * Server-side Instagram carousel (4:5) before/after stitch for the
 * discord-clamperl app. Mirrors the Studio carousel experiment layout in
 * studioLayout.js at logical 1080×1350 and exports lossless PNG (no Studio 6×
 * JPEG path).
 */

import { Image } from "npm:imagescript@3.12.2";
import * as jpeg from "npm:jpeg-js@0.4.4";

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
  /** Pre-decoded chip thumb — avoids re-decoding catalog art every pair. */
  frontThumb?: Image | null;
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

/** Cover + round in place — caller must not reuse `source` afterward. */
function prepareCard(source: Image, tw: number, th: number): Image {
  source.cover(tw, th);
  source.roundCorners(CARD_RADIUS);
  return source;
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * Read JPEG Exif Orientation (1–8). Default 1 when missing.
 * Needed because jpeg-js does not auto-rotate like ImageScript.decode.
 */
function jpegExifOrientation(bytes: Uint8Array): number {
  if (!isJpeg(bytes)) return 1;
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) break;
    while (i < bytes.length && bytes[i] === 0xff) i += 1;
    if (i >= bytes.length) break;
    const marker = bytes[i];
    i += 1;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (i + 1 >= bytes.length) break;
    const len = readU16BE(bytes, i);
    if (len < 2 || i + len > bytes.length) break;
    if (marker === 0xe1 && len >= 14) {
      const start = i + 2;
      if (
        bytes[start] === 0x45 &&
        bytes[start + 1] === 0x78 &&
        bytes[start + 2] === 0x69 &&
        bytes[start + 3] === 0x66 &&
        bytes[start + 4] === 0 &&
        bytes[start + 5] === 0
      ) {
        const tiff = start + 6;
        const le = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
        const be = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
        if (le || be) {
          const u16 = (off: number) =>
            le ? readU16LE(bytes, off) : readU16BE(bytes, off);
          const u32 = (off: number) =>
            le
              ? bytes[off] |
                (bytes[off + 1] << 8) |
                (bytes[off + 2] << 16) |
                (bytes[off + 3] << 24)
              : readU32BE(bytes, off);
          const ifd0 = tiff + u32(tiff + 4);
          if (ifd0 + 2 <= bytes.length) {
            const entries = u16(ifd0);
            for (let e = 0; e < entries; e += 1) {
              const entry = ifd0 + 2 + e * 12;
              if (entry + 12 > bytes.length) break;
              if (u16(entry) === 0x0112 && u16(entry + 2) === 3) {
                const value = u16(entry + 8);
                if (value >= 1 && value <= 8) return value;
              }
            }
          }
        }
      }
    }
    i += len;
  }
  return 1;
}

function orientedSize(
  w: number,
  h: number,
  orientation: number
): { w: number; h: number } {
  return orientation >= 5 && orientation <= 8 ? { w: h, h: w } : { w, h };
}

/** Rotate/mirror RGBA buffer to upright pixels (Exif orientation). */
function applyExifOrientationRgba(
  data: Uint8Array,
  width: number,
  height: number,
  orientation: number
): { data: Uint8Array; width: number; height: number } {
  if (orientation <= 1 || orientation > 8) {
    return { data, width, height };
  }
  const srcW = width;
  const srcH = height;
  const swap = orientation >= 5;
  const dstW = swap ? srcH : srcW;
  const dstH = swap ? srcW : srcH;
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < srcH; y += 1) {
    for (let x = 0; x < srcW; x += 1) {
      let dx = x;
      let dy = y;
      switch (orientation) {
        case 2:
          dx = srcW - 1 - x;
          dy = y;
          break;
        case 3:
          dx = srcW - 1 - x;
          dy = srcH - 1 - y;
          break;
        case 4:
          dx = x;
          dy = srcH - 1 - y;
          break;
        case 5:
          dx = y;
          dy = x;
          break;
        case 6:
          dx = srcH - 1 - y;
          dy = x;
          break;
        case 7:
          dx = srcH - 1 - y;
          dy = srcW - 1 - x;
          break;
        case 8:
          dx = y;
          dy = srcW - 1 - x;
          break;
      }
      const si = (y * srcW + x) * 4;
      const di = (dy * dstW + dx) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: dstW, height: dstH };
}

/** Cover-resize RGBA into tw×th with box filtering when shrinking. */
function coverRgba(
  src: Uint8Array,
  sw: number,
  sh: number,
  tw: number,
  th: number
): Uint8Array {
  const scale = Math.max(tw / sw, th / sh);
  const rw = Math.max(1, Math.round(sw * scale));
  const rh = Math.max(1, Math.round(sh * scale));
  const ox = Math.floor((rw - tw) / 2);
  const oy = Math.floor((rh - th) / 2);
  const out = new Uint8Array(tw * th * 4);

  for (let y = 0; y < th; y += 1) {
    for (let x = 0; x < tw; x += 1) {
      const x0 = ((x + ox) / scale);
      const y0 = ((y + oy) / scale);
      const x1 = ((x + ox + 1) / scale);
      const y1 = ((y + oy + 1) / scale);
      const sx0 = Math.max(0, Math.floor(x0));
      const sy0 = Math.max(0, Math.floor(y0));
      const sx1 = Math.min(sw, Math.ceil(x1));
      const sy1 = Math.min(sh, Math.ceil(y1));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const si = (sy * sw + sx) * 4;
          r += src[si];
          g += src[si + 1];
          b += src[si + 2];
          a += src[si + 3];
          count += 1;
        }
      }
      const di = (y * tw + x) * 4;
      if (count === 0) {
        const sx = Math.min(sw - 1, Math.max(0, Math.floor(x0)));
        const sy = Math.min(sh - 1, Math.max(0, Math.floor(y0)));
        const si = (sy * sw + sx) * 4;
        out[di] = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = src[si + 3];
      } else {
        out[di] = Math.round(r / count);
        out[di + 1] = Math.round(g / count);
        out[di + 2] = Math.round(b / count);
        out[di + 3] = Math.round(a / count);
      }
    }
  }
  return out;
}

/**
 * Decode a phone photo and cover to slot size without ImageScript.decode on
 * large JPEGs (WASM heap does not free across pairs and hangs by pair 3).
 */
async function decodeCoverCard(
  bytes: Uint8Array,
  tw: number,
  th: number
): Promise<Image> {
  if (isJpeg(bytes)) {
    const orientation = jpegExifOrientation(bytes);
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    const upright = applyExifOrientationRgba(
      decoded.data as Uint8Array,
      decoded.width,
      decoded.height,
      orientation
    );
    const covered = coverRgba(
      upright.data,
      upright.width,
      upright.height,
      tw,
      th
    );
    const card = new Image(tw, th);
    card.bitmap = covered;
    card.roundCorners(CARD_RADIUS);
    return card;
  }

  // PNG / other: rare for wooper uploads; keep ImageScript path.
  return prepareCard(await Image.decode(bytes), tw, th);
}

/**
 * Read width/height from JPEG/PNG headers without a full ImageScript decode.
 * Avoids the double-decode that OOMs/hangs Edge when both sides are phone photos.
 */
function probeImageSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52
  ) {
    const w = readU32BE(bytes, 16);
    const h = readU32BE(bytes, 20);
    return w > 0 && h > 0 ? { w, h } : null;
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 8 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      while (i < bytes.length && bytes[i] === 0xff) i += 1;
      if (i >= bytes.length) break;
      const marker = bytes[i];
      i += 1;
      if (marker === 0xd9 || marker === 0xda) break;
      // Standalone markers (no length payload).
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (i + 1 >= bytes.length) break;
      const len = readU16BE(bytes, i);
      if (len < 2 || i + len > bytes.length) break;
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && len >= 7) {
        const h = readU16BE(bytes, i + 3);
        const w = readU16BE(bytes, i + 5);
        if (w > 0 && h > 0) return { w, h };
      }
      i += len;
    }
  }

  return null;
}

/** Prefer header probe; fall back to one ImageScript decode for exotic formats. */
async function measureImageBytes(
  bytes: Uint8Array
): Promise<{ w: number; h: number; via: "header" | "decode" }> {
  const probed = probeImageSize(bytes);
  if (probed) {
    if (isJpeg(bytes)) {
      return {
        ...orientedSize(probed.w, probed.h, jpegExifOrientation(bytes)),
        via: "header",
      };
    }
    return { ...probed, via: "header" };
  }
  const img = await Image.decode(bytes);
  return { w: img.width, h: img.height, via: "decode" };
}

/**
 * Decode catalog art once per job into a chip-sized thumb (mutates overlay).
 */
export async function prepareCarouselOverlay(
  overlay: CarouselOverlay
): Promise<void> {
  if (overlay.frontThumb || !overlay.frontBytes) return;
  try {
    const front = await Image.decode(overlay.frontBytes);
    const scale = Math.min(
      CHIP_THUMB / Math.max(1, front.width),
      CHIP_THUMB / Math.max(1, front.height)
    );
    const tw = Math.max(1, Math.round(front.width * scale));
    const th = Math.max(1, Math.round(front.height * scale));
    front.resize(tw, th);
    front.roundCorners(THUMB_RADIUS);
    overlay.frontThumb = front;
  } catch {
    overlay.frontThumb = null;
  }
  overlay.frontBytes = null;
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
  const thumb = overlay.frontThumb ?? null;
  if (!card && !set && !thumb) return;

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

  const thumbW = thumb?.width ?? 0;
  const thumbH = thumb?.height ?? 0;

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

export type StitchPhase =
  | "measure"
  | "decode_after"
  | "decode_before"
  | "compose"
  | "encode";

/**
 * Stitch one before/after pair into a 1080×1350 PNG.
 * Optional `onPhase` reports ImageScript steps for Discord / Edge logs.
 */
export async function stitchCarouselPairPng(
  beforeBytes: Uint8Array,
  afterBytes: Uint8Array,
  overlay: CarouselOverlay = {},
  onPhase?: (
    phase: StitchPhase,
    extra?: Record<string, unknown>
  ) => void | Promise<void>
): Promise<Uint8Array> {
  const started = Date.now();
  const assets = await ensureAssets();

  const hasCardInfo = Boolean(
    overlay.frontThumb ||
      (overlay.card ?? "").trim() ||
      (overlay.set ?? "").trim()
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

  // Header measure (no bitmap), then decode→cover→composite one side at a
  // time so we never hold two phone-resolution ImageScript bitmaps.
  await onPhase?.("measure", {
    detail: `before ${(beforeBytes.byteLength / (1024 * 1024)).toFixed(1)}MB / after ${(afterBytes.byteLength / (1024 * 1024)).toFixed(1)}MB`,
  });
  const beforeSize = await measureImageBytes(beforeBytes);
  const afterSize = await measureImageBytes(afterBytes);
  const measureDetail =
    `${beforeSize.w}×${beforeSize.h} / ${afterSize.w}×${afterSize.h} (${beforeSize.via}/${afterSize.via})`;
  console.log(
    "clamperl stitch measure",
    JSON.stringify({
      before: [beforeSize.w, beforeSize.h, beforeBytes.byteLength, beforeSize.via],
      after: [afterSize.w, afterSize.h, afterBytes.byteLength, afterSize.via],
      ms: Date.now() - started,
    })
  );
  await onPhase?.("measure", {
    detail: measureDetail,
    before: beforeSize,
    after: afterSize,
    beforeBytes: beforeBytes.byteLength,
    afterBytes: afterBytes.byteLength,
  });

  const leftMetrics = containSize(
    beforeSize.w,
    beforeSize.h,
    SLOT_WIDTH,
    maxImageHeight
  );
  const rightMetrics = containSize(
    afterSize.w,
    afterSize.h,
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

  await onPhase?.("compose", { detail: `slot ${tw}×${th}` });
  const [beforeLabel, afterLabel] = await Promise.all([
    renderTrackedLabel(assets.font, "before", LABEL_FONT, LABEL_TRACKING, LABEL_COLOR),
    renderTrackedLabel(assets.font, "after", LABEL_FONT, LABEL_TRACKING, LABEL_COLOR),
  ]);

  const canvas = new Image(CAROUSEL_WIDTH, CAROUSEL_HEIGHT);
  canvas.fill(BACKGROUND);

  const leftDrawX = LEFT_X + Math.floor((SLOT_WIDTH - tw) / 2);
  const rightDrawX = RIGHT_X + Math.floor((SLOT_WIDTH - tw) / 2);

  // One shared soft shadow (avoid allocating two rounded full-slot bitmaps).
  const shadow = new Image(tw, th);
  shadow.fill(0x0000008c);
  shadow.roundCorners(CARD_RADIUS);
  canvas.composite(shadow, leftDrawX, imageTop + 8);
  canvas.composite(shadow, rightDrawX, imageTop + 8);

  // JPEG phone photos: decode on JS heap (jpeg-js), cover in JS, then only a
  // slot-sized bitmap enters ImageScript — avoids WASM heap growth across pairs.
  await onPhase?.("decode_after", {
    detail: `${afterSize.w}×${afterSize.h} → ${tw}×${th}`,
  });
  {
    const rightCard = await decodeCoverCard(afterBytes, tw, th);
    canvas.composite(rightCard, rightDrawX, imageTop);
  }

  await onPhase?.("decode_before", {
    detail: `${beforeSize.w}×${beforeSize.h} → ${tw}×${th}`,
  });
  {
    const leftCard = await decodeCoverCard(beforeBytes, tw, th);
    canvas.composite(leftCard, leftDrawX, imageTop);
  }

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

  await onPhase?.("encode");
  const png = await canvas.encodePNG();
  console.log(
    "clamperl stitch encode",
    JSON.stringify({ bytes: png.byteLength, ms: Date.now() - started })
  );
  return png;
}

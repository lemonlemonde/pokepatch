import {
  STUDIO_EXPORT_SCALE,
  drawComparisonFrame,
  drawPairedSidesFrame,
  enableHighQuality,
  ensureLabelFont,
  ensureLogo,
  getOutputCanvasSize,
  stampLogicalSize,
} from "@/lib/studioLayout";

/**
 * Output canvas supersampled by `STUDIO_EXPORT_SCALE`. All the layout code
 * keeps working in 1080-space: the transform below maps its coordinates onto
 * the larger backing store, and `stampLogicalSize` lets it read the logical
 * size instead of mistaking the enlarged canvas for a Reel.
 */
function createOutputCanvas(format) {
  const { width, height } = getOutputCanvasSize(format);
  const canvas = document.createElement("canvas");
  canvas.width = width * STUDIO_EXPORT_SCALE;
  canvas.height = height * STUDIO_EXPORT_SCALE;
  stampLogicalSize(canvas, width, height);

  // `alpha: false` skips per-pixel compositing against a transparent backdrop,
  // which is measurable at this canvas size. Safe because `fillBackground`
  // paints the whole frame before anything else is drawn, and the export
  // format has no alpha channel to preserve anyway.
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(STUDIO_EXPORT_SCALE, 0, 0, STUDIO_EXPORT_SCALE, 0, 0);
  enableHighQuality(ctx);
  return { canvas, ctx };
}

/**
 * Accepts a File/Blob or an already-rendered canvas. Slots that were cropped or
 * annotated arrive as canvases so they skip an encode/decode round trip.
 */
export function loadImage(file) {
  if (typeof file?.getContext === "function") return Promise.resolve(file);
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

/**
 * Resolve Studio overlay options into canvas overlay payload.
 * @param {{
 *   showCardInfo?: boolean,
 *   showCaption?: boolean,
 *   frontFile?: File | null,
 *   card?: string,
 *   set?: string,
 *   restoration?: string,
 * } | null} options
 */
export async function resolveOverlay(options) {
  if (!options) return null;

  const overlay = {};
  if (options.showCardInfo && options.frontFile) {
    overlay.cardInfo = {
      frontImg: await loadImage(options.frontFile),
      card: options.card ?? "",
      set: options.set ?? "",
    };
  }
  if (options.showCaption && options.restoration) {
    overlay.caption = options.restoration;
  }
  return overlay.cardInfo || overlay.caption ? overlay : null;
}

async function stitchComparison(
  leftFile,
  rightFile,
  leftLabel,
  rightLabel,
  overlay = null,
  format = "square",
) {
  const [, logoImg] = await Promise.all([ensureLabelFont(), ensureLogo()]);

  const [leftImg, rightImg] = await Promise.all([
    loadImage(leftFile),
    loadImage(rightFile),
  ]);

  const { canvas, ctx } = createOutputCanvas(format);
  drawComparisonFrame(
    ctx,
    leftImg,
    rightImg,
    leftLabel,
    rightLabel,
    logoImg,
    overlay,
  );

  return canvas;
}

/**
 * Before-After Pair posts from a flat [before, after, before, after, …] list.
 * Only stitches complete pairs. Returns [{ key, label, canvas }, …].
 */
export async function stitchBeforeAfterPairRows(
  files,
  overlayOptions = null,
  format = "square",
) {
  const overlay = await resolveOverlay(overlayOptions);
  const complete = [];
  for (let i = 0; i + 1 < files.length; i += 2) {
    const before = files[i];
    const after = files[i + 1];
    if (before && after) {
      complete.push({ before, after, rowIndex: complete.length });
    }
  }

  const solo = complete.length === 1;
  return Promise.all(
    complete.map(async ({ before, after, rowIndex }) => {
      const canvas = await stitchComparison(
        before,
        after,
        "before",
        "after",
        overlay,
        format,
      );
      const n = rowIndex + 1;
      return {
        key: solo ? "any" : `pair-${n}`,
        label: solo ? "Any" : `Pair ${n}`,
        canvas,
      };
    }),
  );
}

/** Front + Back before/after posts for the 1×2 Front-Back Pair mode. */
export async function stitchBothPosts(
  files,
  overlayOptions = null,
  format = "square",
) {
  const [beforeFront, beforeBack, afterFront, afterBack] = files;
  const overlay = await resolveOverlay(overlayOptions);
  const tasks = [];
  if (beforeFront && afterFront) {
    tasks.push(
      stitchComparison(
        beforeFront,
        afterFront,
        "before",
        "after",
        overlay,
        format,
      ).then((canvas) => ["front", canvas]),
    );
  }
  if (beforeBack && afterBack) {
    tasks.push(
      stitchComparison(
        beforeBack,
        afterBack,
        "before",
        "after",
        overlay,
        format,
      ).then((canvas) => ["back", canvas]),
    );
  }
  const entries = await Promise.all(tasks);
  return Object.fromEntries(entries);
}

async function stitchPairedSides(
  leftFile,
  rightFile,
  label,
  overlay = null,
  format = "square",
) {
  const [, logoImg] = await Promise.all([ensureLabelFont(), ensureLogo()]);

  const [leftImg, rightImg] = await Promise.all([
    loadImage(leftFile),
    loadImage(rightFile),
  ]);

  const { canvas, ctx } = createOutputCanvas(format);
  drawPairedSidesFrame(ctx, leftImg, rightImg, label, logoImg, overlay);

  return canvas;
}

/** Front-Back Pair posts. Only stitches pairs that have both images. */
export async function stitchBeforeAfterPosts(
  files,
  overlayOptions = null,
  format = "square",
) {
  const [beforeFront, beforeBack, afterFront, afterBack] = files;
  const overlay = await resolveOverlay(overlayOptions);
  const tasks = [];
  if (beforeFront && beforeBack) {
    tasks.push(
      stitchPairedSides(
        beforeFront,
        beforeBack,
        "before",
        overlay,
        format,
      ).then((canvas) => ["before", canvas]),
    );
  }
  if (afterFront && afterBack) {
    tasks.push(
      stitchPairedSides(afterFront, afterBack, "after", overlay, format).then(
        (canvas) => ["after", canvas],
      ),
    );
  }
  const entries = await Promise.all(tasks);
  return Object.fromEntries(entries);
}

/**
 * Exported post format. JPEG rather than WebP purely for encode speed: WebP's
 * cost stops being linear past ~30 megapixels (a 6× Reel takes ~22s and blocks
 * the main thread, since `toBlob` is synchronous work), while JPEG stays linear
 * and does the same frame in ~1s. Files run ~75% larger, which is the trade.
 *
 * Quality is high enough that chroma subsampling is the only visible
 * difference, and these frames are white cards and white text on black — the
 * luma-dominated case where it costs least.
 */
export const OUTPUT_MIME = "image/jpeg";
export const OUTPUT_QUALITY = 0.98;
export const OUTPUT_EXT = "jpg";

export function canvasToBlob(
  canvas,
  mimeType = OUTPUT_MIME,
  quality = OUTPUT_QUALITY,
) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to export image"));
      },
      mimeType,
      quality,
    );
  });
}

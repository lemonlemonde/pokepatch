import {
  INSTAGRAM_HEIGHT,
  INSTAGRAM_WIDTH,
  drawComparisonFrame,
  drawPairedSidesFrame,
  enableHighQuality,
  ensureLabelFont,
  ensureLogo,
} from "@/lib/studioLayout";

export function loadImage(file) {
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
) {
  const [, logoImg] = await Promise.all([ensureLabelFont(), ensureLogo()]);

  const [leftImg, rightImg] = await Promise.all([
    loadImage(leftFile),
    loadImage(rightFile),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = INSTAGRAM_WIDTH;
  canvas.height = INSTAGRAM_HEIGHT;

  const ctx = canvas.getContext("2d");
  enableHighQuality(ctx);
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

/** Before-After Pair posts. Only stitches pairs that have both images. */
export async function stitchBothPosts(files, overlayOptions = null) {
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
      ).then((canvas) => ["front", canvas]),
    );
  }
  if (beforeBack && afterBack) {
    tasks.push(
      stitchComparison(beforeBack, afterBack, "before", "after", overlay).then(
        (canvas) => ["back", canvas],
      ),
    );
  }
  const entries = await Promise.all(tasks);
  return Object.fromEntries(entries);
}

async function stitchPairedSides(leftFile, rightFile, label, overlay = null) {
  const [, logoImg] = await Promise.all([ensureLabelFont(), ensureLogo()]);

  const [leftImg, rightImg] = await Promise.all([
    loadImage(leftFile),
    loadImage(rightFile),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = INSTAGRAM_WIDTH;
  canvas.height = INSTAGRAM_HEIGHT;

  const ctx = canvas.getContext("2d");
  enableHighQuality(ctx);
  drawPairedSidesFrame(ctx, leftImg, rightImg, label, logoImg, overlay);

  return canvas;
}

/** Front-Back Pair posts. Only stitches pairs that have both images. */
export async function stitchBeforeAfterPosts(files, overlayOptions = null) {
  const [beforeFront, beforeBack, afterFront, afterBack] = files;
  const overlay = await resolveOverlay(overlayOptions);
  const tasks = [];
  if (beforeFront && beforeBack) {
    tasks.push(
      stitchPairedSides(beforeFront, beforeBack, "before", overlay).then(
        (canvas) => ["before", canvas],
      ),
    );
  }
  if (afterFront && afterBack) {
    tasks.push(
      stitchPairedSides(afterFront, afterBack, "after", overlay).then(
        (canvas) => ["after", canvas],
      ),
    );
  }
  const entries = await Promise.all(tasks);
  return Object.fromEntries(entries);
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

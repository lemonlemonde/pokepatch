import {
  drawComparisonFrame,
  drawPairedSidesFrame,
  enableHighQuality,
  ensureLabelFont,
  ensureLogo,
  getOutputCanvasSize,
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
  format = "square",
) {
  const [, logoImg] = await Promise.all([ensureLabelFont(), ensureLogo()]);

  const [leftImg, rightImg] = await Promise.all([
    loadImage(leftFile),
    loadImage(rightFile),
  ]);

  const { width, height } = getOutputCanvasSize(format);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

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

/** Legacy Front + Back before/after posts (video / fixed 4-slot layout). */
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

  const { width, height } = getOutputCanvasSize(format);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  enableHighQuality(ctx);
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

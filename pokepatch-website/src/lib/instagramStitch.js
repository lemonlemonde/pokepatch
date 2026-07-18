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

async function stitchComparison(leftFile, rightFile, leftLabel, rightLabel) {
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
  drawComparisonFrame(ctx, leftImg, rightImg, leftLabel, rightLabel, logoImg);

  return canvas;
}

/** Before-After Pair posts. Only stitches pairs that have both images. */
export async function stitchBothPosts(files) {
  const [beforeFront, beforeBack, afterFront, afterBack] = files;
  const tasks = [];
  if (beforeFront && afterFront) {
    tasks.push(
      stitchComparison(beforeFront, afterFront, "before", "after").then(
        (canvas) => ["front", canvas],
      ),
    );
  }
  if (beforeBack && afterBack) {
    tasks.push(
      stitchComparison(beforeBack, afterBack, "before", "after").then(
        (canvas) => ["back", canvas],
      ),
    );
  }
  const entries = await Promise.all(tasks);
  return Object.fromEntries(entries);
}

async function stitchPairedSides(leftFile, rightFile, label) {
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
  drawPairedSidesFrame(ctx, leftImg, rightImg, label, logoImg);

  return canvas;
}

/** Front-Back Pair posts. Only stitches pairs that have both images. */
export async function stitchBeforeAfterPosts(files) {
  const [beforeFront, beforeBack, afterFront, afterBack] = files;
  const tasks = [];
  if (beforeFront && beforeBack) {
    tasks.push(
      stitchPairedSides(beforeFront, beforeBack, "before").then((canvas) => [
        "before",
        canvas,
      ]),
    );
  }
  if (afterFront && afterBack) {
    tasks.push(
      stitchPairedSides(afterFront, afterBack, "after").then((canvas) => [
        "after",
        canvas,
      ]),
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

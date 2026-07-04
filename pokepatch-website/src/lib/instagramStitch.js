import {
  INSTAGRAM_HEIGHT,
  INSTAGRAM_WIDTH,
  drawComparisonFrame,
  enableHighQuality,
  ensureLabelFont,
  ensureLogo,
} from "@/lib/studioLayout";

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

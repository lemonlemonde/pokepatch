import { loadImage } from "@/lib/instagramStitch";
import {
  INSTAGRAM_HEIGHT,
  INSTAGRAM_WIDTH,
  drawGridFrame,
  enableHighQuality,
  ensureLabelFont,
  ensureLogo,
} from "@/lib/studioLayout";

const PAIRS_PER_POST = 2;

/**
 * Build one or more 1080×1080 before/after grid posts from before/after pairs.
 * Pairs are grouped 2 at a time into a 2×2 layout, so N pairs produce
 * ceil(N / 2) canvases.
 *
 * @param {{ before: File, after: File }[]} pairs
 * @returns {Promise<HTMLCanvasElement[]>}
 */
export async function stitchGridPosts(pairs) {
  if (!pairs.length) return [];

  const [, logoImg] = await Promise.all([ensureLabelFont(), ensureLogo()]);

  const loadedRows = await Promise.all(
    pairs.map(async (pair) => ({
      before: await loadImage(pair.before),
      after: await loadImage(pair.after),
    })),
  );

  const posts = [];
  for (let i = 0; i < loadedRows.length; i += PAIRS_PER_POST) {
    posts.push(loadedRows.slice(i, i + PAIRS_PER_POST));
  }

  return posts.map((rows) => {
    const canvas = document.createElement("canvas");
    canvas.width = INSTAGRAM_WIDTH;
    canvas.height = INSTAGRAM_HEIGHT;

    const ctx = canvas.getContext("2d");
    enableHighQuality(ctx);
    drawGridFrame(ctx, rows, logoImg);

    return canvas;
  });
}

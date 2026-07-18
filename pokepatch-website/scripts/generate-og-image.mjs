// Generates the Open Graph / social share image at src/app/opengraph-image.png
// (Next.js file convention). Rerun after changing the logo or branding:
//
//   node scripts/generate-og-image.mjs

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFile, writeFile } from "fs/promises";
import sharp from "sharp";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const logoPath = join(root, "src/app/pokepatch_icon.png");
const outPath = join(root, "src/app/opengraph-image.png");

const WIDTH = 1200;
const HEIGHT = 630;
const LOGO_HEIGHT = 240;

const logo = sharp(await readFile(logoPath));
const meta = await logo.metadata();
const logoWidth = Math.round((meta.width / meta.height) * LOGO_HEIGHT);
const logoBase64 = (await logo.png().toBuffer()).toString("base64");

// Mirrors the site's dark plum background with soft pastel blobs.
const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="blob1" cx="15%" cy="20%" r="70%">
      <stop offset="0%" stop-color="#79344d" stop-opacity="0.35"/>
      <stop offset="70%" stop-color="#79344d" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blob2" cx="85%" cy="15%" r="70%">
      <stop offset="0%" stop-color="#3d624c" stop-opacity="0.3"/>
      <stop offset="70%" stop-color="#3d624c" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blob3" cx="80%" cy="85%" r="70%">
      <stop offset="0%" stop-color="#32254d" stop-opacity="0.4"/>
      <stop offset="70%" stop-color="#32254d" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#120c1f"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#blob1)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#blob2)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#blob3)"/>
  <image
    href="data:image/png;base64,${logoBase64}"
    x="${(WIDTH - logoWidth) / 2}" y="100"
    width="${logoWidth}" height="${LOGO_HEIGHT}"
  />
  <text
    x="50%" y="440"
    text-anchor="middle"
    font-family="Verdana, DejaVu Sans, sans-serif"
    font-size="76" font-weight="bold"
    fill="#F3E9F2"
  >PokePatch</text>
  <text
    x="50%" y="505"
    text-anchor="middle"
    font-family="Verdana, DejaVu Sans, sans-serif"
    font-size="34" font-weight="bold"
    fill="#E0518A"
  >Trading Card Restorations</text>
  <text
    x="50%" y="570"
    text-anchor="middle"
    font-family="Verdana, DejaVu Sans, sans-serif"
    font-size="26"
    fill="#F3E9F2" fill-opacity="0.6"
  >pokepatch.cards</text>
</svg>
`;

const png = await sharp(Buffer.from(svg)).png().toBuffer();
await writeFile(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes)`);

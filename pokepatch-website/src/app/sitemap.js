export const dynamic = "force-static";

/** Public marketing pages only — auth/account routes are excluded on purpose. */
const PUBLIC_PATHS = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/gallery/", changeFrequency: "weekly", priority: 0.9 },
  { path: "/contact/", changeFrequency: "monthly", priority: 0.8 },
];

/** @see https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap */
export default function sitemap() {
  const base = "https://pokepatch.cards";

  return PUBLIC_PATHS.map(({ path, changeFrequency, priority }) => ({
    url: `${base}${path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  }));
}

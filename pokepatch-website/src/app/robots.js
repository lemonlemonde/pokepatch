import { PRIVATE_ROUTE_PREFIXES } from "@/lib/privatePageMetadata";

/** @see https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots */
export const dynamic = "force-static";

export default function robots() {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: PRIVATE_ROUTE_PREFIXES,
    },
    sitemap: "https://pokepatch.cards/sitemap.xml",
  };
}

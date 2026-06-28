import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
	// GitHub Pages project site: lemonlemonde.github.io/pokepatch
	basePath: "/pokepatch",
	assetPrefix: "/pokepatch/",
	trailingSlash: true,
	images: {
	    unoptimized: true, // Disable default image optimization
	},
	// do this to output static exports!!
	output: "export",
	// pin the workspace root (a stray lockfile elsewhere can confuse inference)
	turbopack: {
		root: __dirname,
	},
};

export default nextConfig;

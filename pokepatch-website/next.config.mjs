import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function supabaseHostname() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	if (!url) return null;
	try {
		return new URL(url).hostname;
	} catch {
		return null;
	}
}

const supabaseHost = supabaseHostname();

/** @type {import('next').NextConfig} */
const nextConfig = {
	// GitHub Pages project site: lemonlemonde.github.io/pokepatch
	trailingSlash: true,
	images: {
	    unoptimized: true, // Disable default image optimization
		...(supabaseHost
			? {
					remotePatterns: [
						{
							protocol: "https",
							hostname: supabaseHost,
							pathname: "/storage/v1/object/public/**",
						},
					],
				}
			: {}),
	},
	// do this to output static exports!!
	output: "export",
	// pin the workspace root (a stray lockfile elsewhere can confuse inference)
	turbopack: {
		root: __dirname,
	},
};

export default nextConfig;

import Link from "next/link";
import SocialLinks from "@/components/SocialLinks";

const FOOTER_LINKS = [
  { href: "/", label: "Home" },
  { href: "/gallery", label: "Gallery" },
  { href: "/contact", label: "Get Free Quote" },
];

export default function Footer() {
  return (
    <footer className="mt-auto bg-gradient-to-b from-night/90 to-night/60 px-6 py-8 text-center text-sm text-blush/80">
      <p className="font-display text-base text-ink">
        PokePatch: Card Restorations
      </p>
      <nav aria-label="Footer">
        <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm font-semibold">
          {FOOTER_LINKS.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className="text-blush/90 transition hover:text-ink hover:underline"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <SocialLinks className="mt-4" />
      <p className="mt-3 text-xs text-ink/50">
        &copy; {new Date().getFullYear()} PokePatch. All rights reserved.
      </p>
    </footer>
  );
}

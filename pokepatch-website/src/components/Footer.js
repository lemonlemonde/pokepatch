import Link from "next/link";
import SocialLinks from "@/components/SocialLinks";

const FOOTER_LINKS = [
  { href: "/", label: "Home" },
  { href: "/gallery", label: "Gallery" },
  { href: "/quote", label: "Get Free Quote" },
];

export default function Footer() {
  return (
    <footer className="relative z-10 mt-auto border-t border-ink/10 px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 text-center">
        <p className="text-sm font-medium tracking-tight text-ink">
          PokePatch · Card Restorations
        </p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {FOOTER_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink/45 transition hover:text-ink"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <SocialLinks />
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink/35">
          &copy; {new Date().getFullYear()} PokePatch
        </p>
      </div>
    </footer>
  );
}

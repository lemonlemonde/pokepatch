import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/gallery", label: "Gallery" },
  { href: "/contact", label: "Contact" },
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b-2 border-ink/20 bg-blush/60 backdrop-blur-sm">
      <nav className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-display text-lg font-bold text-ink"
        >
          <span className="h-8 w-8 rounded-full bg-pink-300 shadow-cozy-sm" />
          PokePatch
        </Link>
        <ul className="flex gap-6">
          {links.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className="rounded-full px-3 py-1 font-secondary text-sm font-semibold text-ink/80 transition hover:bg-white/60 hover:text-ink"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

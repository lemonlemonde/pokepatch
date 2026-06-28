import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/gallery", label: "Gallery" },
  { href: "/contact", label: "Contact" },
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b-2 border-ink/20 bg-blush/60 backdrop-blur-sm">
      <nav className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2 font-display text-base font-bold text-ink sm:text-lg"
        >
          <span className="h-7 w-7 shrink-0 rounded-full bg-pink-300 shadow-cozy-sm sm:h-8 sm:w-8" />
          PokePatch
        </Link>
        <ul className="flex shrink-0 gap-1 sm:gap-4">
          {links.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className="rounded-full px-2 py-1 font-secondary text-sm font-semibold text-ink/80 transition hover:bg-white/60 hover:text-ink sm:px-3"
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

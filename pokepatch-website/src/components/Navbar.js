import Link from "next/link";
import Image from "next/image";
import logo from "../app/pokepatch_icon.png";

const links = [
  { href: "/", label: "Home" },
  { href: "/gallery", label: "Gallery" },
  { href: "/contact", label: "Contact" },
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b-2 border-ink/20 bg-[#fbdce5]">
      <nav className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2 font-display text-base font-bold text-ink sm:text-lg"
        >
          <Image
            src={logo}
            alt="PokePatch logo"
            priority
            className="h-8 w-auto shrink-0 sm:h-9"
          />
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

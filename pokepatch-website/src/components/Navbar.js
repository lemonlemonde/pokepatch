"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import logo from "../app/pokepatch_icon.png";

const links = [
  { href: "/", label: "Home" },
  { href: "/gallery", label: "Gallery" },
  { href: "/contact", label: "Get a Quote" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-50 flex justify-center px-4 pt-4">
      <nav
        className={`flex w-full max-w-4xl items-center justify-between gap-2 rounded-full border px-4 py-2.5 transition-all duration-300 sm:px-6 ${
          scrolled
            ? "border-ink/15 bg-night/70 shadow-cozy-sm backdrop-blur-md"
            : "border-transparent bg-transparent"
        }`}
      >
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
                className="rounded-full px-2 py-1 font-secondary text-sm font-semibold text-blush/90 transition hover:bg-ink/10 hover:text-ink sm:px-3"
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

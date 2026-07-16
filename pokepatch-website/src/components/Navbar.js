"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import logo from "../app/pokepatch_icon.png";

const links = [
  { href: "/", label: "Home" },
  { href: "/gallery", label: "Gallery" },
  { href: "/contact", label: "Get a Quote" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-50 flex justify-center px-4 pt-4">
      <nav
        className={`flex w-full max-w-4xl flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border px-4 py-2.5 transition-all duration-300 sm:justify-between sm:px-6 ${
          scrolled
            ? "border-ink/15 bg-night/70 shadow-cozy-sm backdrop-blur-md"
            : "border-transparent bg-transparent"
        }`}
      >
        <Link
          href="/"
          className="flex shrink-0 -translate-x-3.5 items-center gap-0.5 font-display text-base font-bold text-ink sm:translate-x-0 sm:gap-2 sm:text-lg"
        >
          <Image
            src={logo}
            alt="PokePatch logo"
            priority
            className="h-8 w-auto shrink-0 sm:h-9"
          />
          <span className="-ml-2 sm:ml-0">PokePatch</span>
        </Link>
        <ul className="flex shrink-0 justify-center gap-1 sm:justify-end sm:gap-4">
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
          {user ? (
            <li>
              <Link
                href="/my-orders"
                className="rounded-full px-2 py-1 font-secondary text-sm font-semibold text-blush/90 transition hover:bg-ink/10 hover:text-ink sm:px-3"
              >
                My Orders
              </Link>
            </li>
          ) : (
            <li>
              <Link
                href="/login"
                className="rounded-full px-2 py-1 font-secondary text-sm font-semibold text-blush/90 transition hover:bg-ink/10 hover:text-ink sm:px-3"
              >
                Log in
              </Link>
            </li>
          )}
        </ul>
      </nav>
    </header>
  );
}

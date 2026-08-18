"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { isAdminAllowedEmail } from "@/lib/adminAccess";
import { supabase } from "@/lib/supabaseClient";
import logo from "../app/pokepatch_icon.png";
import { REVEAL_EASE } from "@/components/ExpandReveal";

const BASE_LINKS = [
  { href: "/", label: "Home" },
  { href: "/gallery", label: "Gallery" },
  { href: "/quote", label: "Get Free Quote" },
];

function normalizePath(path) {
  const stripped = (path ?? "/").replace(/\/+$/, "");
  return stripped === "" ? "/" : stripped;
}

function MenuIcon({ open }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      {open ? (
        <path d="M6 6l12 12M18 6L6 18" />
      ) : (
        <path d="M4 7h16M4 12h16M4 17h16" />
      )}
    </svg>
  );
}

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const pathname = usePathname();
  const customerAuthEnabled = isCustomerAuthEnabled();
  const { user } = useAuth();
  const showAdmin = customerAuthEnabled && isAdminAllowedEmail(user?.email);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!customerAuthEnabled || !user || !supabase) {
      setUnreadCount(0);
      return undefined;
    }

    let cancelled = false;

    async function refreshUnread() {
      try {
        const { data, error } = await supabase.rpc("get_my_unread_message_count");
        if (error) throw error;
        if (!cancelled) {
          setUnreadCount(Number(data) || 0);
        }
      } catch {
        if (!cancelled) setUnreadCount(0);
      }
    }

    refreshUnread();

    const onFocus = () => refreshUnread();
    const onRead = () => refreshUnread();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pokepatch:messages-read", onRead);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pokepatch:messages-read", onRead);
    };
  }, [customerAuthEnabled, user, pathname]);

  const links = [...BASE_LINKS];
  if (customerAuthEnabled) {
    if (user) {
      links.push(
        { href: "/my-orders", label: "My Orders", badge: unreadCount },
        { href: "/account", label: "Account" },
      );
      if (showAdmin) {
        links.push({ href: "/admin/orders/", label: "Admin" });
      }
    } else {
      links.push({ href: "/login", label: "Log in" });
    }
  }

  const currentPath = normalizePath(pathname);

  function isActive(href) {
    const target = normalizePath(href);
    if (target === "/") return currentPath === "/";
    return currentPath === target || currentPath.startsWith(`${target}/`);
  }

  function linkClassName(href) {
    return `block px-3 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition sm:px-3 sm:py-1.5 ${
      isActive(href) ? "text-ink" : "text-ink/45 hover:text-ink"
    }`;
  }

  const solid = scrolled || menuOpen;

  return (
    <header className="sticky top-0 z-50 flex justify-center px-3 pt-3 sm:px-4 sm:pt-4">
      <nav
        className={`w-full max-w-6xl rounded-xl border px-3 py-2 transition-[background-color,border-color,backdrop-filter] duration-300 ease-out sm:px-6 sm:py-2.5 ${
          solid
            ? "border-ink/10 bg-[#0a0714]/80 backdrop-blur-md"
            : "border-transparent bg-transparent"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="flex min-w-0 shrink items-center gap-2 text-sm font-medium tracking-tight text-ink sm:text-base"
          >
            <Image
              src={logo}
              alt="PokePatch logo"
              priority
              className="h-8 w-auto shrink-0 sm:h-9"
            />
            <span className="truncate">PokePatch</span>
          </Link>

          <ul className="hidden items-center gap-1 sm:flex sm:gap-2">
            {links.map(({ href, label, badge }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive(href) ? "page" : undefined}
                  className={`${linkClassName(href)} inline-flex items-center gap-1.5`}
                >
                  {label}
                  {badge > 0 ? (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-[11px] font-bold leading-5 text-night">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink/60 transition hover:bg-ink/5 hover:text-ink sm:hidden"
          >
            <MenuIcon open={menuOpen} />
          </button>
        </div>

        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ${REVEAL_EASE} sm:hidden ${
            menuOpen
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <ul
              className="mt-2 space-y-1 border-t border-ink/10 pt-2"
              aria-hidden={!menuOpen}
            >
              {links.map(({ href, label, badge }) => (
                <li key={href}>
                  <Link
                    href={href}
                    tabIndex={menuOpen ? undefined : -1}
                    aria-current={isActive(href) ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                    className={`${linkClassName(href)} inline-flex items-center gap-1.5`}
                  >
                    {label}
                    {badge > 0 ? (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-[11px] font-bold leading-5 text-night">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </nav>
    </header>
  );
}

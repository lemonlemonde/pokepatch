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

const BASE_LINKS = [
  { href: "/", label: "Home" },
  { href: "/gallery", label: "Gallery" },
  { href: "/contact", label: "Get a Quote" },
];

// The site is exported with trailing slashes, so normalize before comparing.
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
      strokeWidth="2.5"
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

  // Close the mobile menu after navigating.
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
    const onRead = () => setUnreadCount(0);
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
        { href: "/my-orders", label: "My Orders" },
        { href: "/messages", label: "Messages", badge: unreadCount },
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
    return `block rounded-full px-3 py-1.5 text-sm font-semibold transition sm:px-3 sm:py-1 ${
      isActive(href)
        ? "bg-ink/15 text-ink"
        : "text-blush/90 hover:bg-ink/10 hover:text-ink"
    }`;
  }

  const solid = scrolled || menuOpen;

  return (
    <header className="sticky top-0 z-50 flex justify-center px-4 pt-4">
      <nav
        className={`w-full max-w-4xl border px-4 py-2.5 transition-all duration-300 sm:px-6 ${
          menuOpen ? "rounded-3xl" : "rounded-full"
        } ${
          solid
            ? "border-ink/15 bg-night/70 shadow-cozy-sm backdrop-blur-md"
            : "border-transparent bg-transparent"
        }`}
      >
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-1.5 font-display text-base font-bold text-ink sm:gap-2 sm:text-lg"
          >
            <Image
              src={logo}
              alt="PokePatch logo"
              priority
              className="h-8 w-auto shrink-0 sm:h-9"
            />
            PokePatch
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
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-berry px-1.5 text-[11px] font-bold leading-5 text-night">
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
            className="grid h-9 w-9 place-items-center rounded-full text-blush/90 transition hover:bg-ink/10 hover:text-ink sm:hidden"
          >
            <MenuIcon open={menuOpen} />
          </button>
        </div>

        {menuOpen && (
          <ul className="mt-2 space-y-1 border-t border-ink/10 pt-2 sm:hidden">
            {links.map(({ href, label, badge }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive(href) ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                  className={`${linkClassName(href)} inline-flex items-center gap-1.5`}
                >
                  {label}
                  {badge > 0 ? (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-berry px-1.5 text-[11px] font-bold leading-5 text-night">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </header>
  );
}

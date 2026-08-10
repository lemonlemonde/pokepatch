"use client";

import { useEffect, useRef } from "react";

/**
 * Scroll in/out for marketing copy.
 * Prefers CSS scroll-driven animations (no per-frame JS). Falls back to a
 * single IntersectionObserver that toggles a class — never writes styles on
 * every scroll tick.
 */
export default function ScrollReveal({
  as: Comp = "div",
  className = "",
  children,
  variant = "default",
}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      el.classList.add("scroll-reveal-visible");
      return;
    }

    // Native view timelines — browser handles compositing; no JS needed.
    if (CSS.supports?.("animation-timeline: view()")) {
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        el.classList.toggle("scroll-reveal-visible", entry.isIntersecting);
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Comp
      ref={ref}
      className={`scroll-reveal scroll-reveal--${variant} ${className}`.trim()}
    >
      {children}
    </Comp>
  );
}

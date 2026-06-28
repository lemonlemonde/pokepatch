"use client";

import { useEffect, useRef, useState } from "react";

const MOBILE_MAX_WIDTH = 640;
const CENTER_BAND = 0.02;

export default function useCenterActive() {
  const ref = useRef(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    let frame = null;

    function update() {
      frame = null;
      const el = ref.current;
      if (!el) return;

      if (window.innerWidth > MOBILE_MAX_WIDTH) {
        setActive(false);
        return;
      }

      const nav = document.querySelector("header");
      const navHeight = nav ? nav.getBoundingClientRect().height : 0;

      const rect = el.getBoundingClientRect();
      const elementCenter = rect.top + rect.height / 2;
      const visibleHeight = window.innerHeight - navHeight;
      const viewportCenter = navHeight + visibleHeight / 2;
      const band = visibleHeight * CENTER_BAND;

      setActive(Math.abs(elementCenter - viewportCenter) < band);
    }

    function onScroll() {
      if (frame === null) {
        frame = window.requestAnimationFrame(update);
      }
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  return { ref, active };
}

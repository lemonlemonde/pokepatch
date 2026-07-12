"use client";

import { Suspense, useEffect } from "react";
import { usePathname } from "next/navigation";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import {
  initPostHog,
  isPostHogEnabled,
  posthog,
  shouldTrackPath,
} from "@/lib/posthog";

function PostHogPageView() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || !isPostHogEnabled() || !shouldTrackPath(pathname)) {
      return;
    }

    posthog.capture("$pageview", {
      $current_url: window.location.href,
    });
  }, [pathname]);

  return null;
}

export default function PostHogProvider({ children }) {
  useEffect(() => {
    initPostHog();
  }, []);

  if (!isPostHogEnabled()) {
    return children;
  }

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  );
}

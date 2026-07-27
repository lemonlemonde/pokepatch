"use client";

import { Suspense, useEffect } from "react";
import { usePathname } from "next/navigation";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useAuth } from "@/contexts/AuthContext";
import {
  initPostHog,
  isPostHogEnabled,
  posthog,
  shouldTrackPath,
  syncPostHogForUser,
} from "@/lib/posthog";

function PostHogPageView() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || !isPostHogEnabled() || !shouldTrackPath(pathname)) {
      return;
    }
    if (posthog.has_opted_out_capturing()) {
      return;
    }

    posthog.capture("$pageview", {
      $current_url: window.location.href,
    });
  }, [pathname]);

  return null;
}

function PostHogAdminGate() {
  const { user } = useAuth();

  useEffect(() => {
    syncPostHogForUser(user?.email);
  }, [user?.email]);

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
        <PostHogAdminGate />
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  );
}

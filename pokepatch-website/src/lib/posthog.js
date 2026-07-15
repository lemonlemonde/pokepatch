import posthog from "posthog-js";

let initialized = false;

export function isPostHogEnabled() {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

export function shouldTrackPath(pathname) {
  return !pathname.startsWith("/admin");
}

export function initPostHog() {
  if (typeof window === "undefined" || initialized || !isPostHogEnabled()) {
    return;
  }

  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host:
      process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: false,
    disable_session_recording: true,
  });

  initialized = true;
}

export function capture(event, properties) {
  if (!isPostHogEnabled() || typeof window === "undefined") return;
  if (!initialized) initPostHog();
  posthog.capture(event, properties);
}

export { posthog };

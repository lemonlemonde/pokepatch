import posthog from "posthog-js";
import { isAdminAllowedEmail } from "@/lib/adminAccess";

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
    disable_session_recording: false,
  });

  initialized = true;
}

/** Opt out all capture + recordings when the signed-in email is an admin. */
export function syncPostHogForUser(email) {
  if (!isPostHogEnabled() || typeof window === "undefined") return;
  if (!initialized) initPostHog();

  if (isAdminAllowedEmail(email)) {
    posthog.opt_out_capturing();
    return;
  }

  if (posthog.has_opted_out_capturing()) {
    posthog.opt_in_capturing();
  }
}

export function capture(event, properties) {
  if (!isPostHogEnabled() || typeof window === "undefined") return;
  if (!initialized) initPostHog();
  if (posthog.has_opted_out_capturing()) return;
  posthog.capture(event, properties);
}

export { posthog };

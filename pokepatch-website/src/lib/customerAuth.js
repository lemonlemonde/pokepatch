export function isCustomerAuthEnabled() {
  return process.env.NEXT_PUBLIC_CUSTOMER_AUTH_ENABLED === "true";
}

/** Post-confirm redirect URL for signup / resend confirmation emails. */
export function getAuthEmailRedirectTo(path = "/my-orders") {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
}

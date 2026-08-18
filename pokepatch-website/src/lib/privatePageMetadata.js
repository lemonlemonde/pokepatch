/** Paths crawlers should skip — keep in sync with private route layouts. */
export const PRIVATE_ROUTE_PREFIXES = [
  "/admin/",
  "/login/",
  "/account/",
  "/my-orders/",
  "/messages/",
  "/thank-you/",
  "/verify-email/",
  "/reset-password/",
];

/** Shared metadata for customer/auth flows — not marketing pages. */
export const privatePageMetadata = {
  robots: {
    index: false,
    follow: false,
  },
};

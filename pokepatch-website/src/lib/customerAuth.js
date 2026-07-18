export function isCustomerAuthEnabled() {
  return process.env.NEXT_PUBLIC_CUSTOMER_AUTH_ENABLED === "true";
}

export function getAdminAllowedEmails() {
  const raw = process.env.NEXT_PUBLIC_ADMIN_ALLOWED_EMAILS || "";
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminAllowedEmail(email) {
  if (!email) return false;
  const allowed = getAdminAllowedEmails();
  if (allowed.length === 0) return false;
  return allowed.includes(String(email).trim().toLowerCase());
}

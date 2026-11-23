export const CONTACT_TYPES = [
  { value: "phone", label: "Phone" },
  { value: "instagram", label: "Instagram" },
];

/** Kept so older orders that stored Discord still display a label. */
export const LEGACY_CONTACT_TYPES = [
  ...CONTACT_TYPES,
  { value: "discord", label: "Discord" },
];

export const OTHER_CONTACTS_COPY =
  "Add at least one more way we can reach you (phone or Instagram). Then choose which method we'll actually use below.";

export const PREFERRED_CONTACT_COPY =
  "We'll contact you through this method — this is how you'll hear from us.";

export const CONTACT_FIELD_HINTS = {
  phone: "We'll text or call this number if you mark Phone as how we'll contact you.",
  instagram:
    "We'll DM this account if you mark Instagram as how we'll contact you.",
};

export function contactTypeLabel(type) {
  if (type === "email") return "Email";
  const found = LEGACY_CONTACT_TYPES.find((entry) => entry.value === type);
  return found?.label ?? "Contact";
}

export function isOfferedContactType(type) {
  return type === "email" || CONTACT_TYPES.some((entry) => entry.value === type);
}

/** Dropdown options for admin: Discord only when the row is already Discord. */
export function contactTypeOptionsFor(currentType) {
  if (currentType === "discord") return LEGACY_CONTACT_TYPES;
  return CONTACT_TYPES;
}

export function isPreferredContact(preferredType, contactType) {
  return (preferredType || "email") === contactType;
}

export function preferredContactReachLabel({
  preferredId,
  email,
  contactValues,
  preferredValue,
}) {
  const type = preferredId || "email";
  const label = contactTypeLabel(type).toLowerCase();
  const value = (
    type === "email"
      ? (email ?? preferredValue ?? "")
      : (contactValues?.[type] ?? preferredValue ?? "")
  ).trim();
  return value ? `${label} (${value})` : label;
}

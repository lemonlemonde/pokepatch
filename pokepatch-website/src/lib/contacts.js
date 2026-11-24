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
  "Add at least one (phone or Instagram).";

export const CONTACT_FIELD_HINTS = {
  phone: "We'll text or call this number.",
  instagram: "We'll DM this account.",
};

export function contactTypeLabel(type) {
  if (type === "email") return "Email";
  const found = LEGACY_CONTACT_TYPES.find((entry) => entry.value === type);
  return found?.label ?? "Contact";
}

export function isOfferedContactType(type) {
  return CONTACT_TYPES.some((entry) => entry.value === type);
}

export function filledContactTypes(contactValues) {
  return CONTACT_TYPES.filter(
    (type) => (contactValues?.[type.value] ?? "").trim() !== ""
  );
}

export function preferredContactOptions(contactValues) {
  return filledContactTypes(contactValues).map((type) => ({
    id: type.value,
    label: `${type.label} (${contactValues[type.value].trim()})`,
  }));
}

export function effectivePreferredContactId(preferredId, contactValues) {
  const options = preferredContactOptions(contactValues);
  if (options.some((option) => option.id === preferredId)) return preferredId;
  return options[0]?.id ?? "";
}

/** Dropdown options for admin: Discord only when the row is already Discord. */
export function contactTypeOptionsFor(currentType) {
  if (currentType === "discord") return LEGACY_CONTACT_TYPES;
  return CONTACT_TYPES;
}

export function isPreferredContact(preferredType, contactType) {
  return (preferredType || "email") === contactType;
}

export function preferredContactReachSentence({
  preferredId,
  contactValues,
  preferredValue,
}) {
  const type = isOfferedContactType(preferredId)
    ? preferredId
    : filledContactTypes(contactValues)[0]?.value;
  if (!type) return "Add a phone or Instagram so we know how to reach you.";
  const label = contactTypeLabel(type);
  const value = (
    contactValues?.[type] ??
    preferredValue ??
    ""
  ).trim();
  return value
    ? `We'll reach you by ${label} at ${value}.`
    : `We'll reach you by ${label}.`;
}

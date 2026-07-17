export const CONTACT_TYPES = [
  { value: "phone", label: "Phone" },
  { value: "discord", label: "Discord" },
  { value: "instagram", label: "Instagram" },
];

export function contactTypeLabel(value) {
  return CONTACT_TYPES.find((type) => type.value === value)?.label ?? value;
}

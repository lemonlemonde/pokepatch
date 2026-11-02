/** Permanent owner portfolio order — wooper/clamperl address as #-1. */
export const OWNER_ORDER_DISPLAY_ID = -1;

export function isOwnerOrderDisplayId(value: number): boolean {
  return value === OWNER_ORDER_DISPLAY_ID;
}

/** Valid wooper/clamperl order numbers: positive display ids, or #-1. */
export function isAllowedOrderDisplayId(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    (value > 0 || value === OWNER_ORDER_DISPLAY_ID)
  );
}

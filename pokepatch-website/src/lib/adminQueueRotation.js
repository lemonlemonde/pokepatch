/**
 * Admin To do → In progress fairness: pull 2 priority orders, then 1 regular.
 * Cycle position lives in localStorage so refresh keeps your place.
 */

const ADMIN_QUEUE_ROTATION_KEY = "pokepatch.admin.queueRotation";
export const PRIORITIES_PER_REGULAR = 2;

function normalizePrioritiesRemaining(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > PRIORITIES_PER_REGULAR) {
    return PRIORITIES_PER_REGULAR;
  }
  return Math.floor(n);
}

export function defaultQueueRotation() {
  return { prioritiesRemaining: PRIORITIES_PER_REGULAR };
}

export function readQueueRotation() {
  if (typeof window === "undefined") return defaultQueueRotation();
  try {
    const raw = window.localStorage.getItem(ADMIN_QUEUE_ROTATION_KEY);
    if (!raw) return defaultQueueRotation();
    const parsed = JSON.parse(raw);
    return {
      prioritiesRemaining: normalizePrioritiesRemaining(
        parsed?.prioritiesRemaining
      ),
    };
  } catch {
    return defaultQueueRotation();
  }
}

export function writeQueueRotation(state) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      ADMIN_QUEUE_ROTATION_KEY,
      JSON.stringify({
        prioritiesRemaining: normalizePrioritiesRemaining(
          state?.prioritiesRemaining
        ),
      })
    );
  } catch {
    // ignore quota / private mode
  }
}

/** After a To do → In progress pull, advance the 2P→1R cadence. */
export function advanceQueueRotation(current, pulledIsPriority) {
  if (pulledIsPriority) {
    return {
      prioritiesRemaining: Math.max(
        0,
        normalizePrioritiesRemaining(current?.prioritiesRemaining) - 1
      ),
    };
  }
  return { prioritiesRemaining: PRIORITIES_PER_REGULAR };
}

/**
 * Pick the next To do order under the 2-priority : 1-regular rule.
 * `todoOrders` should already be column-sorted (priority first, then FIFO).
 * Falls back to the other lane when the preferred lane is empty.
 */
export function pickNextTodoOrder(todoOrders, rotation) {
  const todo = todoOrders ?? [];
  if (todo.length === 0) return null;

  const priority = [];
  const regular = [];
  for (const order of todo) {
    if (order?.is_priority) priority.push(order);
    else regular.push(order);
  }

  if (priority.length === 0) return regular[0] ?? null;
  if (regular.length === 0) return priority[0] ?? null;

  if (normalizePrioritiesRemaining(rotation?.prioritiesRemaining) > 0) {
    return priority[0];
  }
  return regular[0];
}

/**
 * Admin To do → In progress fairness:
 * Immediate always goes next and does not consume the cadence.
 * Among the rest: Rush × 3, Priority × 2, Standard × 1. Skip empty lanes.
 * Cycle position lives in localStorage so refresh keeps your place.
 */

import {
  QUEUE_PULL_CYCLE,
  QUEUE_SPEED_IMMEDIATE,
  QUEUE_SPEED_STANDARD,
  isImmediateQueueSpeed,
  normalizeQueueSpeed,
} from "@/lib/queueSpeed";

const ADMIN_QUEUE_ROTATION_KEY = "pokepatch.admin.queueRotation";

function normalizeCycleIndex(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n) % QUEUE_PULL_CYCLE.length;
}

export function defaultQueueRotation() {
  return { cycleIndex: 0 };
}

export function readQueueRotation() {
  if (typeof window === "undefined") return defaultQueueRotation();
  try {
    const raw = window.localStorage.getItem(ADMIN_QUEUE_ROTATION_KEY);
    if (!raw) return defaultQueueRotation();
    const parsed = JSON.parse(raw);
    if (parsed?.cycleIndex != null) {
      return { cycleIndex: normalizeCycleIndex(parsed.cycleIndex) };
    }
    // Legacy 2-priority : 1-regular counter — start a fresh cadence.
    return defaultQueueRotation();
  } catch {
    return defaultQueueRotation();
  }
}

export function writeQueueRotation(state) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      ADMIN_QUEUE_ROTATION_KEY,
      JSON.stringify({ cycleIndex: normalizeCycleIndex(state?.cycleIndex) })
    );
  } catch {
    // ignore quota / private mode
  }
}

function orderSpeed(order) {
  return normalizeQueueSpeed(order?.queue_speed, {
    isPriority: order?.is_priority,
  });
}

/**
 * After a To do → In progress pull, advance past the lane we just took.
 * Immediate pulls leave the fairness pointer where it is.
 */
export function advanceQueueRotation(current, pulledSpeed) {
  if (isImmediateQueueSpeed(pulledSpeed)) {
    return { cycleIndex: normalizeCycleIndex(current?.cycleIndex) };
  }
  const start = normalizeCycleIndex(current?.cycleIndex);
  const speed = normalizeQueueSpeed(pulledSpeed);
  for (let step = 0; step < QUEUE_PULL_CYCLE.length; step += 1) {
    const index = (start + step) % QUEUE_PULL_CYCLE.length;
    if (QUEUE_PULL_CYCLE[index] === speed) {
      return {
        cycleIndex: (index + 1) % QUEUE_PULL_CYCLE.length,
      };
    }
  }
  return { cycleIndex: (start + 1) % QUEUE_PULL_CYCLE.length };
}

/**
 * Immediate orders always win. Otherwise 3 Rush : 2 Priority : 1 Standard.
 * `todoOrders` should already be column-sorted (fastest first, then FIFO
 * within each lane). Falls back to the next cycle lane that has orders.
 */
export function pickNextTodoOrder(todoOrders, rotation) {
  const todo = todoOrders ?? [];
  if (todo.length === 0) return null;

  const bySpeed = {
    immediate: [],
    express: [],
    fast: [],
    standard: [],
  };
  for (const order of todo) {
    const speed = orderSpeed(order);
    (bySpeed[speed] ?? bySpeed[QUEUE_SPEED_STANDARD]).push(order);
  }

  if (bySpeed[QUEUE_SPEED_IMMEDIATE].length) {
    return bySpeed[QUEUE_SPEED_IMMEDIATE][0];
  }

  const start = normalizeCycleIndex(rotation?.cycleIndex);
  for (let step = 0; step < QUEUE_PULL_CYCLE.length; step += 1) {
    const speed = QUEUE_PULL_CYCLE[(start + step) % QUEUE_PULL_CYCLE.length];
    const lane = bySpeed[speed];
    if (lane?.length) return lane[0];
  }
  return todo[0] ?? null;
}

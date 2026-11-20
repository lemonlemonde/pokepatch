/**
 * Admin To do → In progress fairness:
 * Immediate always goes next and does not consume the cadence.
 * Among the rest: Rush × 3, Priority × 2, Standard × 1. Skip empty lanes.
 * Cycle position lives on the server (`queue_pull_state`) so every session
 * sees the same next order.
 */

import {
  QUEUE_PULL_CYCLE,
  QUEUE_SPEED_IMMEDIATE,
  QUEUE_SPEED_STANDARD,
  isImmediateQueueSpeed,
  normalizeQueueSpeed,
} from "@/lib/queueSpeed";

export function normalizeCycleIndex(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n) % QUEUE_PULL_CYCLE.length;
}

export function defaultQueueRotation() {
  return { cycleIndex: 0 };
}

/** Parse `queue_rotation` from admin-api list / save / set_status payloads. */
export function queueRotationFromPayload(payload) {
  if (payload == null) return null;
  const nested = payload.queue_rotation ?? payload.queueRotation ?? payload;
  const raw = nested?.cycle_index ?? nested?.cycleIndex;
  if (raw == null) return null;
  return { cycleIndex: normalizeCycleIndex(raw) };
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

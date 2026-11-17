/**
 * Two products:
 *   In line — Standard, Priority ($15), Rush ($30). Same kind of thing: wait,
 *   but further forward. DB keys stay `fast` / `express`.
 *   Start next — Immediate ($100). Skip the waiting lanes.
 * One order is one speed; mixed carts split.
 */

export const QUEUE_SPEED_STANDARD = "standard";
export const QUEUE_SPEED_FAST = "fast";
export const QUEUE_SPEED_EXPRESS = "express";
export const QUEUE_SPEED_IMMEDIATE = "immediate";

export const QUEUE_SPEEDS = [
  QUEUE_SPEED_STANDARD,
  QUEUE_SPEED_FAST,
  QUEUE_SPEED_EXPRESS,
  QUEUE_SPEED_IMMEDIATE,
];

export const QUEUE_SPEED_RANK = {
  [QUEUE_SPEED_STANDARD]: 0,
  [QUEUE_SPEED_FAST]: 1,
  [QUEUE_SPEED_EXPRESS]: 2,
  [QUEUE_SPEED_IMMEDIATE]: 3,
};

export const QUEUE_SPEED_LABEL = {
  [QUEUE_SPEED_STANDARD]: "Standard",
  [QUEUE_SPEED_FAST]: "Priority",
  [QUEUE_SPEED_EXPRESS]: "Rush",
  [QUEUE_SPEED_IMMEDIATE]: "Immediate",
};

export const QUEUE_SPEED_FEE = {
  [QUEUE_SPEED_STANDARD]: 0,
  [QUEUE_SPEED_FAST]: 15,
  [QUEUE_SPEED_EXPRESS]: 30,
  [QUEUE_SPEED_IMMEDIATE]: 100,
};

export const QUEUE_SPEED_ADJUSTMENT_LABEL = {
  [QUEUE_SPEED_FAST]: "Priority queue",
  [QUEUE_SPEED_EXPRESS]: "Rush queue",
  [QUEUE_SPEED_IMMEDIATE]: "Immediate start",
};

/** Older $15 quotes used these labels. */
export const LEGACY_FAST_ADJUSTMENT_LABELS = [
  "Priority service",
  "Fast queue",
];

/** Older $30 quotes used this label. */
export const LEGACY_EXPRESS_ADJUSTMENT_LABEL = "Express queue";

export const QUEUE_SPEED_HINT = {
  [QUEUE_SPEED_STANDARD]: "Regular wait. No extra fee.",
  [QUEUE_SPEED_FAST]: "Move ahead of Standard. Still waits in line.",
  [QUEUE_SPEED_EXPRESS]: "Move ahead of Priority. Still waits in line.",
  [QUEUE_SPEED_IMMEDIATE]: "Skip the waiting lanes. I start this card next.",
};

/** Third-person copy for FAQ, extras, and the public queue. */
export const QUEUE_SPEED_PUBLIC_HINT = {
  [QUEUE_SPEED_STANDARD]: "Regular wait. No extra fee.",
  [QUEUE_SPEED_FAST]: "Move ahead of Standard. Still waits in line.",
  [QUEUE_SPEED_EXPRESS]: "Move ahead of Priority. Still waits in line.",
  [QUEUE_SPEED_IMMEDIATE]: "Skip the waiting lanes. We start this card next.",
};

export function queueSpeedPriceTag(speed) {
  const rate = QUEUE_SPEED_FEE[speed];
  if (!rate) return "Included";
  return `$${rate} per card`;
}

export function queueSpeedNamedPrice(speed) {
  const name = QUEUE_SPEED_LABEL[speed];
  const rate = QUEUE_SPEED_FEE[speed];
  if (!rate) return `${name} (included)`;
  return `${name} ($${rate} per card)`;
}

export const QUEUE_SPEED_MIXED_COPY =
  "Queue speed is per card. If cards in the same request use different speeds, they become separate orders.";

export const QUEUE_SPEED_IN_LINE_COPY =
  "Priority and Rush are the same kind of product: you still wait in line, you just sit further forward. Rush sits ahead of Priority. Standard is included and waits in the regular line.";

export const QUEUE_SPEED_IMMEDIATE_COPY =
  "Immediate is not a faster waiting lane. We skip the waiting lanes and start that card next.";

export function queueSpeedFaqEntries() {
  const priority = queueSpeedNamedPrice(QUEUE_SPEED_FAST);
  const rush = queueSpeedNamedPrice(QUEUE_SPEED_EXPRESS);
  const immediate = queueSpeedNamedPrice(QUEUE_SPEED_IMMEDIATE);
  return [
    {
      question: "Can I get my cards restored faster?",
      answer: `Yes. You can wait in line or skip it. ${priority} and ${rush} still wait — Rush just sits ahead of Priority. ${immediate} skips the waiting lanes and we start that card next. Standard is included. ${QUEUE_SPEED_MIXED_COPY}`,
      items: QUEUE_SPEEDS.map((speed) => ({
        label: `${QUEUE_SPEED_LABEL[speed]} — ${queueSpeedPriceTag(speed).toLowerCase()}`,
        text: QUEUE_SPEED_PUBLIC_HINT[speed],
      })),
    },
    {
      question: "What's the difference between Priority, Rush, and Immediate?",
      answer: `${QUEUE_SPEED_IN_LINE_COPY} ${QUEUE_SPEED_IMMEDIATE_COPY}`,
    },
    {
      question: "Can cards in the same order have different queue speeds?",
      answer:
        "Yes. Each card gets its own speed. If they differ, those cards become separate orders under My Orders.",
    },
  ];
}

export function queueSpeedQueueIntro() {
  return `Immediate ($${QUEUE_SPEED_FEE[QUEUE_SPEED_IMMEDIATE]} per card) skips the waiting lanes — we start those cards next. Rush ($${QUEUE_SPEED_FEE[QUEUE_SPEED_EXPRESS]}) and Priority ($${QUEUE_SPEED_FEE[QUEUE_SPEED_FAST]}) still wait in line, with Rush ahead of Priority. Standard is included.`;
}

export const QUEUE_SPEEDS_IN_LINE = [
  QUEUE_SPEED_STANDARD,
  QUEUE_SPEED_FAST,
  QUEUE_SPEED_EXPRESS,
];

export const PAID_QUEUE_SPEEDS = QUEUE_SPEEDS.filter(
  (speed) => QUEUE_SPEED_FEE[speed] > 0
);

function isCanceledStatus(status) {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  return s === "canceled" || s === "cancelled";
}

export function normalizeQueueSpeed(value, { isPriority } = {}) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (QUEUE_SPEEDS.includes(raw)) return raw;
  if (raw === "priority" || raw === "rare") return QUEUE_SPEED_FAST;
  if (raw === "regular" || raw === "normal") return QUEUE_SPEED_STANDARD;
  if (raw === "ultra" || raw === "rush") return QUEUE_SPEED_EXPRESS;
  if (raw === "now" || raw === "start" || raw === "jump") {
    return QUEUE_SPEED_IMMEDIATE;
  }
  if (Boolean(isPriority)) return QUEUE_SPEED_FAST;
  return QUEUE_SPEED_STANDARD;
}

export function cardQueueSpeed(card) {
  return normalizeQueueSpeed(card?.queue_speed ?? card?.queueSpeed, {
    isPriority: card?.is_priority ?? card?.isPriority,
  });
}

export function uniqueQueueSpeeds(cards) {
  const seen = new Set();
  for (const card of cards ?? []) {
    seen.add(cardQueueSpeed(card));
  }
  return QUEUE_SPEEDS.filter((speed) => seen.has(speed));
}

export function hasMixedQueueSpeed(cards) {
  return uniqueQueueSpeeds(cards).length > 1;
}

export function isPaidQueueSpeed(speed) {
  return PAID_QUEUE_SPEEDS.includes(normalizeQueueSpeed(speed));
}

export function isImmediateQueueSpeed(speed, isPriority = false) {
  return (
    normalizeQueueSpeed(speed, { isPriority }) === QUEUE_SPEED_IMMEDIATE
  );
}

export function queueSpeedFee(speed, cardCount) {
  const n = Math.floor(Number(cardCount));
  if (!Number.isFinite(n) || n <= 0) return 0;
  const rate = QUEUE_SPEED_FEE[normalizeQueueSpeed(speed)] ?? 0;
  return Math.round(n * rate * 100) / 100;
}

export function queueSpeedAdjustmentLabel(speed) {
  return QUEUE_SPEED_ADJUSTMENT_LABEL[normalizeQueueSpeed(speed)] ?? null;
}

export function queueSpeedDescription(speed, cardCount) {
  const normalized = normalizeQueueSpeed(speed);
  const label = queueSpeedAdjustmentLabel(normalized);
  if (!label) return null;
  const rate = QUEUE_SPEED_FEE[normalized];
  const n = Math.floor(Number(cardCount));
  const count = Number.isFinite(n) && n > 0 ? n : 0;
  if (count <= 1) return `${label} ($${rate} per card)`;
  return `${label} (${count} × $${rate})`;
}

export function compareQueueSpeed(a, b) {
  return (
    (QUEUE_SPEED_RANK[normalizeQueueSpeed(b)] ?? 0) -
    (QUEUE_SPEED_RANK[normalizeQueueSpeed(a)] ?? 0)
  );
}

function adjustmentDescription(row) {
  return String(row?.description ?? "")
    .trim()
    .toLowerCase();
}

function labelsForSpeed(speed) {
  const normalized = normalizeQueueSpeed(speed);
  const labels = [QUEUE_SPEED_ADJUSTMENT_LABEL[normalized]];
  if (normalized === QUEUE_SPEED_FAST) {
    labels.push(...LEGACY_FAST_ADJUSTMENT_LABELS);
  }
  if (normalized === QUEUE_SPEED_EXPRESS) {
    labels.push(LEGACY_EXPRESS_ADJUSTMENT_LABEL);
  }
  return labels.filter(Boolean).map((label) => String(label).trim().toLowerCase());
}

export function isQueueSpeedAdjustmentRow(row, speed = null) {
  const description = adjustmentDescription(row);
  if (!description) return false;
  if (speed) return labelsForSpeed(speed).includes(description);
  return (
    description === "immediate start" ||
    description === "rush queue" ||
    description === "express queue" ||
    description === "priority queue" ||
    description === "fast queue" ||
    description === "priority service"
  );
}

export function paidQueueSpeedsFromCards(cards) {
  const counts = Object.fromEntries(PAID_QUEUE_SPEEDS.map((speed) => [speed, 0]));
  for (const card of cards ?? []) {
    if (isCanceledStatus(card?.status)) continue;
    const speed = cardQueueSpeed(card);
    if (speed in counts) counts[speed] += 1;
  }
  return counts;
}

/** Border/fill for paid-queue quote receipts and similar panels. */
export function paidQueueChromeClass(speed, isPriority = false) {
  const normalized = normalizeQueueSpeed(speed, { isPriority });
  if (normalized === QUEUE_SPEED_IMMEDIATE) {
    return "border-mint/45 bg-mint/[0.10]";
  }
  if (normalized === QUEUE_SPEED_EXPRESS) {
    return "border-peach/40 bg-peach/[0.08]";
  }
  if (isPaidQueueSpeed(normalized)) {
    return "border-status-yellow/40 bg-status-yellow/[0.08]";
  }
  return "";
}

export function queueSpeedSurfaceClass(speed, isPriority = false) {
  const normalized = normalizeQueueSpeed(speed, { isPriority });
  if (normalized === QUEUE_SPEED_IMMEDIATE) {
    return "border-mint/50 bg-mint/[0.12]";
  }
  if (normalized === QUEUE_SPEED_EXPRESS) {
    return "border-peach/40 bg-peach/[0.08]";
  }
  if (normalized === QUEUE_SPEED_FAST) {
    return "border-status-yellow/40 bg-status-yellow/[0.08]";
  }
  return "border-ink/10 bg-ink/[0.03]";
}

export function queueSpeedRailClass(speed, isPriority = false) {
  const normalized = normalizeQueueSpeed(speed, { isPriority });
  if (normalized === QUEUE_SPEED_IMMEDIATE) return "bg-mint";
  if (normalized === QUEUE_SPEED_EXPRESS) return "bg-peach";
  if (normalized === QUEUE_SPEED_FAST) return "bg-status-yellow";
  return "";
}

export function queueSpeedControlClass(speed, isPriority = false) {
  const normalized = normalizeQueueSpeed(speed, { isPriority });
  if (normalized === QUEUE_SPEED_IMMEDIATE) {
    return "border-mint/55 bg-mint/15 text-mint";
  }
  if (normalized === QUEUE_SPEED_EXPRESS) {
    return "border-peach/55 bg-peach/15 text-peach";
  }
  if (normalized === QUEUE_SPEED_FAST) {
    return "border-status-yellow/55 bg-status-yellow/15 text-status-yellow";
  }
  return "border-ink/15 bg-transparent text-ink/30 hover:border-ink/30 hover:text-ink/55";
}

export function cycleQueueSpeed(value) {
  const current = normalizeQueueSpeed(value);
  const index = QUEUE_SPEEDS.indexOf(current);
  return QUEUE_SPEEDS[(index + 1) % QUEUE_SPEEDS.length];
}

/** Fairness among waiting lanes only. Immediate always jumps this cadence. */
export const QUEUE_PULL_CYCLE = [
  QUEUE_SPEED_EXPRESS,
  QUEUE_SPEED_EXPRESS,
  QUEUE_SPEED_EXPRESS,
  QUEUE_SPEED_FAST,
  QUEUE_SPEED_FAST,
  QUEUE_SPEED_STANDARD,
];

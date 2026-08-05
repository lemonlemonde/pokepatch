/**
 * Interactive restoration guide — tree of fix workflows.
 * Edit this file to add or refine steps; the admin Guide tab reads it directly.
 */

/**
 * @typedef {Object} ActionNode
 * @property {'action'} type
 * @property {string} id
 * @property {string} title
 * @property {string[]} steps
 * @property {string} [next]
 */

/** @typedef {ActionNode} GuideNode */

/** @type {string} */
const COOL_PRESS_STEP =
  "Sleeve the card and press between acrylic plates with clamps for 2–3 days. Clean the acrylic plates before pressing — dirt particles can cause indents.";

/** @type {Record<string, GuideNode>} */
export const RESTORATION_GUIDE_NODES = {
  core_concepts: {
    type: "action",
    id: "core_concepts",
    title: "How restorations work",
    steps: [
      "Scratches: buffing with micro abrasives. Do not buff too hard.",
      "Moisturizing (hydropump): makes the card softer and more workable. It also raises the card and expands the cardstock to help remove dents.",
      "Creases and edge lifts: only work when the card is moisturized and soft — not on a dry card. The heat pen must be used while the card is still humid.",
      "Flattening (roller, press): pushes down the card.",
      "Heat press: keeps the card malleable while holding it in place.",
      "Cool press: lets the card dry while flattened so that once dry it cannot warp again.",
    ],
  },

  technique_hydropump: {
    type: "action",
    id: "technique_hydropump",
    title: "Hydropump",
    steps: [
      "Stack from bottom to top: acrylic pane, parchment paper, foam pad, card, foam pad, parchment paper, acrylic pane.",
      "Apply 6 sprays of card spray onto the foam pads.",
      "Clamp the stack and let sit for the time specified in the workflow you are following.",
      "Do not leave the card in for more than 6 hours — the parchment paper will wrinkle and that pattern can press into the card.",
    ],
  },

  technique_spherical_press: {
    type: "action",
    id: "technique_spherical_press",
    title: "Spherical press tool",
    steps: [
      "Start with the smallest tip and lightly press down on the crease or defect.",
      "Work up progressively through larger tips, enlarging the dent so the roller can flatten it more easily later.",
      "It is OK to dent the card — the roller step flattens the dent afterward.",
      "Use hand weight only; do not press hard.",
    ],
  },

  technique_roller: {
    type: "action",
    id: "technique_roller",
    title: "Roller",
    steps: [
      "Use the roller on the area you are working — crease, dent, water damage, or lifted edge.",
      "Do not press hard; hand weight is enough.",
      "After a spherical press, roll to flatten out the dent. The crease is not expected to fully disappear at this step.",
    ],
  },

  technique_heat_pen: {
    type: "action",
    id: "technique_heat_pen",
    title: "Heat pen",
    steps: [
      "Set the heat pen to the blue setting.",
      "For creases and edge lifts, use the heat pen while the card is still humid from hydropump — not on a dry card.",
      "Use quick swirl motions along the crease, damaged area, or lifted edge — do not keep the tip in one place, which can burn the card.",
      "Hand weight only; do not press hard.",
      "Do not hold the button for longer than 5 seconds at a time.",
      "Wait for the pen to cool (10 seconds) before holding the button to heat up again.",
    ],
  },

  technique_heat_press: {
    type: "action",
    id: "technique_heat_press",
    title: "Heat press",
    steps: [
      "Press the card between 2 aluminum plates and 2 foam pads.",
      "Run at 165° for 30 minutes per cycle.",
      "The heat press auto-shuts off at 30 minutes — turn it off and back on if you need another cycle.",
      "Bubble creases use 2 cycles; most other workflows use 1 cycle unless the workflow says otherwise.",
    ],
  },

  dirt_start: {
    type: "action",
    id: "dirt_start",
    title: "Dirt removal",
    steps: [
      "Always do this first when the card is dirty.",
      "Only work on a dry card — do not remove dirt when the card is moist or wet.",
      "Apply card spray to a cotton swab.",
      "Locally and lightly scrub away the dirt with the swab.",
      "For stubborn dirt, keep lightly scrubbing until it is reduced. This may take a while — do not rush or press hard.",
      "Sometimes card spray can get into the edges of the card and puff them up. This is OK — it will go away on its own in about 20 minutes. Do not do anything to fix it.",
    ],
    next: "scratches_start",
  },

  scratches_start: {
    type: "action",
    id: "scratches_start",
    title: "Scratch removal",
    steps: [
      "Deep scratches (gouges) cannot be removed — document the defect for the customer.",
      "Shallow scratch on the plasticky / holo side: use Kurt's Recovery first. Lightly swirl with a foam brush on the holo area. Apply up to 3 times, or until gone — whichever comes first. Only use Recovery on the plasticky side. Follow with Kurt's Polish swirled over the card.",
      "Shallow scratch on the paper side (card back, or non-holo non-plasticky surfaces): use Kurt's Polish only. Lightly swirl with a foam brush over the scratched area.",
    ],
    next: "other_damage",
  },

  other_damage: {
    type: "action",
    id: "other_damage",
    title: "Other damage",
    steps: [
      "After dirt and scratches, check every damage type below.",
      "A card can have one, several, or none of these — use every workflow that applies.",
    ],
  },

  creases_start: {
    type: "action",
    id: "creases_start",
    title: "Crease removal",
    steps: [
      "[[technique_hydropump|Hydropump]] for 2 hours.",
      "Only work the crease while the card is moisturized and soft from hydropump — do not work creases on a dry card.",
      "Do not press out creases too hard — especially while the card is very wet from hydropump, which can fold the holo layer.",
      "Use the [[technique_spherical_press|spherical press tool]] on the crease.",
      "Use the [[technique_roller|roller]] to flatten out the dent.",
      "Use the [[technique_heat_pen|heat pen]] along the crease while the card is still humid.",
      "[[technique_heat_press|Heat press]] for 30 minutes at 165°.",
      "Repeat the previous steps until the crease is smooth. Not all creases can be fully removed — scars will remain. Run your fingers along the crease and feel if it is smooth; if smooth, it is fine.",
    ],
    next: "cool_press",
  },

  bubble_creases_start: {
    type: "action",
    id: "bubble_creases_start",
    title: "Bubble crease removal",
    steps: [
      "Same workflow as regular creases, but [[technique_hydropump|hydropump]] for 4 hours (regular creases are 2 hours).",
      "Only work the crease while the card is moisturized and soft from hydropump — do not work creases on a dry card.",
      "Do not press out creases too hard — especially while the card is very wet from hydropump, which can fold the holo layer.",
      "Use the [[technique_spherical_press|spherical press tool]] on the crease.",
      "Use the [[technique_roller|roller]] to flatten out the dent.",
      "Use the [[technique_heat_pen|heat pen]] along the crease while the card is still humid.",
      "[[technique_heat_press|Heat press]] — 2 cycles of 30 minutes at 165°.",
      "Repeat the previous steps until the crease is smooth. Not all creases can be fully removed — scars will remain. Run your fingers along the crease and feel if it is smooth; if smooth, it is fine.",
    ],
    next: "cool_press",
  },

  water_start: {
    type: "action",
    id: "water_start",
    title: "Water damage removal",
    steps: [
      "[[technique_hydropump|Hydropump]] for 2 hours.",
      "Use the [[technique_roller|roller]] on the affected area.",
      "Use the [[technique_heat_pen|heat pen]] on the damaged area.",
      "Repeat the roller and heat pen steps until the water damage is gone.",
    ],
    next: "cool_press",
  },

  dents_start: {
    type: "action",
    id: "dents_start",
    title: "Dent removal",
    steps: [
      "Use a dropper to apply card spray directly on the dent — the water drop will locally lift the dent.",
      "Press between foam pads and acrylic plates for 6 hours. Clean the acrylic plates before pressing — dirt particles can cause indents.",
    ],
    next: "cool_press",
  },

  warping_start: {
    type: "action",
    id: "warping_start",
    title: "Warping removal",
    steps: [
      "[[technique_hydropump|Hydropump]] the card.",
      "[[technique_heat_press|Heat press]] for 30 minutes at 165°.",
    ],
    next: "cool_press",
  },

  edge_lift_start: {
    type: "action",
    id: "edge_lift_start",
    title: "Edge lift",
    steps: [
      "Same approach as creases, but less extreme — typically one round is enough.",
      "[[technique_hydropump|Hydropump]] the card.",
      "Only work the lifted edge while the card is moisturized and soft — do not work edge lifts on a dry card.",
      "Use the [[technique_roller|roller]] on the lifted edge.",
      "Use the [[technique_heat_pen|heat pen]] along the edge while the card is still humid.",
    ],
    next: "cool_press",
  },

  cool_press: {
    type: "action",
    id: "cool_press",
    title: "Cool press",
    steps: [
      "Required after any crease, bubble crease, water damage, dent, warping, or edge lift work.",
      "Not needed for dirt- or scratch-only cards.",
      COOL_PRESS_STEP,
    ],
    next: "all_done",
  },

  all_done: {
    type: "action",
    id: "all_done",
    title: "Card ready",
    steps: [
      "Sleeve the card and update order photos if you took new before/after shots.",
      "Note any remaining defects for the customer before marking work complete.",
    ],
  },
};

/** Reference techniques — linked from workflow steps. */
export const RESTORATION_GUIDE_TECHNIQUES = [
  { id: "technique_hydropump", label: "Hydropump" },
  { id: "technique_spherical_press", label: "Spherical press" },
  { id: "technique_roller", label: "Roller" },
  { id: "technique_heat_pen", label: "Heat pen" },
  { id: "technique_heat_press", label: "Heat press" },
];

/** Parallel damage branches. */
export const RESTORATION_GUIDE_DAMAGE_BRANCHES = [
  { id: "creases_start", label: "Creases" },
  { id: "bubble_creases_start", label: "Bubble creases" },
  { id: "water_start", label: "Water damage" },
  { id: "dents_start", label: "Dents" },
  { id: "warping_start", label: "Warping" },
  { id: "edge_lift_start", label: "Edge lift" },
];

/** All nodes for labels and popover metadata. */
export const RESTORATION_GUIDE_STEPS = [
  { id: "core_concepts", label: "Core concepts" },
  { id: "dirt_start", label: "Dirt" },
  { id: "scratches_start", label: "Scratches" },
  { id: "other_damage", label: "Other damage" },
  ...RESTORATION_GUIDE_DAMAGE_BRANCHES,
  { id: "cool_press", label: "Cool press" },
  { id: "all_done", label: "Wrap up" },
];

export const RESTORATION_GUIDE_START_ID = "core_concepts";

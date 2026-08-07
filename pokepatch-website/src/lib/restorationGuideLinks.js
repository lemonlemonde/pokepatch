/** @typedef {{ type: 'text', value: string } | { type: 'link', nodeId: string, label: string }} GuideStepPart */

const GUIDE_STEP_LINK_PATTERN = /\[\[([a-z0-9_]+)\|([^\]]+)\]\]/g;

/** Parse step text with optional [[node_id|label]] internal links. */
export function parseGuideStepText(text) {
  /** @type {GuideStepPart[]} */
  const parts = [];
  let lastIndex = 0;

  for (const match of text.matchAll(GUIDE_STEP_LINK_PATTERN)) {
    const [fullMatch, nodeId, label] = match;
    const index = match.index ?? 0;

    if (index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, index) });
    }

    parts.push({ type: "link", nodeId, label });
    lastIndex = index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }

  if (parts.length === 0) {
    parts.push({ type: "text", value: text });
  }

  return parts;
}

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  PRIORITY_FEE_PER_CARD,
  billableQuoteCards,
} from "@/lib/servicePricing";

export const ORDER_CONTRACTS_BUCKET = "order-contracts";
export const POKEPATCH_REPRESENTATIVE_NAME = "Ray Li";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 50;
const MARGIN_TOP = 46;
const MARGIN_BOTTOM = 46;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const FONT_SIZE = 9.5;
const TITLE_SIZE = 18;
const SUBTITLE_SIZE = 10.5;
const SECTION_SIZE = 10;
const LINE_HEIGHT = 12.5;
const TABLE_ROW_HEIGHT = 16;
const TABLE_HEADER_SIZE = 7.5;

const INK = rgb(0.12, 0.12, 0.14);
const INK_MUTED = rgb(0.32, 0.32, 0.35);
const RULE = rgb(0.72, 0.72, 0.74);
const RULE_SOFT = rgb(0.86, 0.86, 0.87);
const HEADER_BAND = rgb(0.95, 0.95, 0.96);

const AGREEMENT_PARAS = [
  "Customer agrees to pay PokéPatch the Restoration Fee listed for each card for the restoration services described or agreed upon. Restoration Fees are separate from the Near Mint Raw Market Values.",
  "Customer provides the card(s) to PokéPatch for restoration. Customer retains ownership of the card(s) while they are in PokéPatch's possession.",
  "Before restoration, PokéPatch will photograph each card. These photographs will document the card's condition when received and may be used to determine whether damage occurred while in PokéPatch's possession. PokéPatch will also photograph each card after restoration and before returning it to Customer.",
  "PokéPatch will use reasonable care when handling and restoring the card(s).",
  "If a card is lost, stolen, misplaced, destroyed, or otherwise cannot be returned to Customer, PokéPatch will pay Customer the Near Mint Raw Market Value listed for that card.",
  "If PokéPatch damages a card so that its condition is materially worse than shown in the photographs taken before restoration, Customer may choose either:",
];

const DAMAGES = [
  "New creases",
  "Deep scratches",
  "Whitening or edge damage",
  "Discoloration",
  "Staining",
  "Tears",
  "Dents",
];

const AGREEMENT_TAIL = [
  "The Near Mint Raw Market Value is the mutually agreed market value of each card in raw Near Mint condition at the time this Agreement is signed. The parties may use recent eBay sold listings or another mutually agreed source to determine this amount. Once agreed upon and entered above, the Near Mint Raw Market Value will control regardless of future changes in market value.",
  "Once a card has been handed directly back to Customer, PokéPatch's responsibility and coverage for that card under this Agreement ends. After a card has been returned to Customer, it is no longer covered or insured by PokéPatch.",
];

/** Parse a money field without rounding. Empty → null. */
export function parseExactMoney(value) {
  if (value === "" || value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/^\$/, "");
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Format a money amount for display/PDF with exactly two decimal places.
 */
export function formatExactMoneyAmount(value) {
  const n = parseExactMoney(value);
  if (n == null) return "";
  return n.toFixed(2);
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const next = `${current} ${words[i]}`;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function truncateToWidth(text, font, size, maxWidth) {
  const raw = String(text ?? "");
  if (font.widthOfTextAtSize(raw, size) <= maxWidth) return raw;
  let out = raw;
  while (out.length > 0 && font.widthOfTextAtSize(`${out}…`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out ? `${out}…` : "";
}

/** Exact per-card restoration fee: coded services + HV + priority (if on). */
export function contractRestorationFeeForCard(card, draft) {
  const cardId = String(card?.id ?? "");
  let fee = 0;
  for (const item of draft?.quote_items ?? []) {
    if (String(item?.card_pick ?? "") !== cardId) continue;
    const amount = parseExactMoney(item.quote_base_amount);
    if (amount != null) fee += amount;
  }
  const hvEntry = draft?.quote_card_hv?.[cardId];
  const hv = parseExactMoney(hvEntry?.amount_dollars);
  if (hv != null && hv > 0) fee += hv;
  if (draft?.is_priority) fee += PRIORITY_FEE_PER_CARD;
  return fee;
}

/** Build contract PDF payload from the live order draft (read-only source). */
export function buildContractPrefillFromDraft(draft) {
  const cards = billableQuoteCards(draft?.cards ?? []);
  const rows = [];

  for (const card of cards) {
    const name = String(card.card_name ?? "").trim();
    const set = String(card.set_name ?? "").trim();
    const restorationFee = contractRestorationFeeForCard(card, draft);
    const nm = parseExactMoney(card.market_value_raw_nm);
    rows.push({
      id: String(card.id),
      card_name: name,
      set_name: set,
      restoration_fee: restorationFee,
      market_value_raw_nm: nm == null ? "" : nm,
    });
  }

  return {
    // Customer signs offline — leave Name blank for them to fill in.
    customer_name: "",
    representative_name: POKEPATCH_REPRESENTATIVE_NAME,
    agreement_date: formatContractDate(),
    cards: rows,
  };
}

/** Normalize money for equality checks (two-decimal currency). */
function normalizeMoneyForCompare(value) {
  const n = parseExactMoney(value);
  if (n == null) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Snapshot of order fields that affect the unsigned PDF (excludes date/name).
 * Used to tell whether a prepared contract still matches the live order.
 */
export function contractOrderSnapshot(payload) {
  const cards = Array.isArray(payload?.cards) ? payload.cards : [];
  return {
    representative_name: String(payload?.representative_name ?? "").trim(),
    cards: cards
      .map((row) => ({
        id: String(row?.id ?? ""),
        card_name: String(row?.card_name ?? "").trim(),
        set_name: String(row?.set_name ?? "").trim(),
        restoration_fee: normalizeMoneyForCompare(row?.restoration_fee),
        market_value_raw_nm: normalizeMoneyForCompare(row?.market_value_raw_nm),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** True when stored prepared payload matches the live order draft snapshot. */
export function isContractPayloadUpToDate(storedPayload, livePayload) {
  return (
    JSON.stringify(contractOrderSnapshot(storedPayload)) ===
    JSON.stringify(contractOrderSnapshot(livePayload))
  );
}

export function formatContractDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export const REP_SIGNATURE_PUBLIC_PATH =
  "/contracts/pokepatch-rep-signature.png";

/** Load the PokéPatch rep signature PNG (transparent bg) for stamping. */
export async function loadRepSignaturePngBytes() {
  if (typeof fetch !== "function") return null;
  try {
    const response = await fetch(REP_SIGNATURE_PUBLIC_PATH);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function ensureSpace(ctx, needed) {
  if (ctx.y - needed >= MARGIN_BOTTOM) return;
  ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.y = PAGE_HEIGHT - MARGIN_TOP;
}

function drawRule(ctx, { soft = false } = {}) {
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN_X, y: ctx.y },
    thickness: soft ? 0.5 : 1,
    color: soft ? RULE_SOFT : RULE,
  });
}

function drawHeader(ctx) {
  ensureSpace(ctx, 72);
  ctx.page.drawText("POKÉPATCH", {
    x: MARGIN_X,
    y: ctx.y,
    size: TITLE_SIZE,
    font: ctx.bold,
    color: INK,
  });
  ctx.y -= 16;
  ctx.page.drawText(
    "Pokémon Card Restoration — Customer Property & Liability Agreement",
    {
      x: MARGIN_X,
      y: ctx.y,
      size: SUBTITLE_SIZE,
      font: ctx.bold,
      color: INK_MUTED,
    }
  );
  ctx.y -= 8;
  drawRule(ctx);
  ctx.y -= 14;

  const intro =
    'This Agreement is between PokéPatch ("Restorer") and the undersigned customer ("Customer") regarding the Pokémon card(s) submitted for restoration under this Agreement.';
  for (const line of wrapText(intro, ctx.font, FONT_SIZE, CONTENT_WIDTH)) {
    ensureSpace(ctx, LINE_HEIGHT + 2);
    ctx.page.drawText(line, {
      x: MARGIN_X,
      y: ctx.y,
      size: FONT_SIZE,
      font: ctx.font,
      color: INK,
    });
    ctx.y -= LINE_HEIGHT;
  }
  ctx.y -= 10;
}

function drawSectionTitle(ctx, title) {
  ensureSpace(ctx, 28);
  ctx.page.drawText(title, {
    x: MARGIN_X,
    y: ctx.y,
    size: SECTION_SIZE,
    font: ctx.bold,
    color: INK,
  });
  ctx.y -= 5;
  drawRule(ctx);
  ctx.y -= 12;
}

function drawWrappedParagraph(ctx, text, { indent = 0, bullet = false } = {}) {
  const bulletGap = bullet ? 12 : 0;
  const maxWidth = CONTENT_WIDTH - indent - bulletGap;
  const lines = wrapText(text, ctx.font, FONT_SIZE, maxWidth);
  for (let i = 0; i < lines.length; i += 1) {
    ensureSpace(ctx, LINE_HEIGHT + 2);
    if (bullet && i === 0) {
      ctx.page.drawText("•", {
        x: MARGIN_X + indent,
        y: ctx.y,
        size: FONT_SIZE,
        font: ctx.font,
        color: INK,
      });
    }
    ctx.page.drawText(lines[i], {
      x: MARGIN_X + indent + bulletGap,
      y: ctx.y,
      size: FONT_SIZE,
      font: ctx.font,
      color: INK,
    });
    ctx.y -= LINE_HEIGHT;
  }
  ctx.y -= 5;
}

function drawTable(ctx, cards) {
  // Widths must sum to CONTENT_WIDTH.
  const cols = [
    { label: "Card Name", width: 170, align: "left" },
    { label: "Set / Expansion", width: 140, align: "left" },
    {
      label: "Restoration Fee",
      lines: ["Restoration", "Fee"],
      width: 96,
      align: "right",
    },
    {
      label: "Near Mint Raw Market Value",
      lines: ["Near Mint Raw", "Market Value"],
      width: 106,
      align: "right",
    },
  ];

  const headerLines = cols.map((col) =>
    Array.isArray(col.lines)
      ? col.lines
      : wrapText(col.label, ctx.bold, TABLE_HEADER_SIZE, col.width - 8)
  );
  const headerLineCount = Math.max(
    1,
    ...headerLines.map((lines) => lines.length)
  );
  const headerPadY = 5;
  const headerBlockHeight = headerLineCount * 9 + headerPadY * 2;

  ensureSpace(ctx, headerBlockHeight + TABLE_ROW_HEIGHT * 2);

  // Header band
  ctx.page.drawRectangle({
    x: MARGIN_X,
    y: ctx.y - headerBlockHeight + 4,
    width: CONTENT_WIDTH,
    height: headerBlockHeight,
    color: HEADER_BAND,
  });

  let x = MARGIN_X;
  for (let i = 0; i < cols.length; i += 1) {
    const col = cols[i];
    const lines = headerLines[i];
    let lineY = ctx.y - headerPadY;
    for (const line of lines) {
      const textWidth = ctx.bold.widthOfTextAtSize(line, TABLE_HEADER_SIZE);
      const textX =
        col.align === "right"
          ? x + col.width - 6 - textWidth
          : x + 6;
      ctx.page.drawText(line, {
        x: textX,
        y: lineY,
        size: TABLE_HEADER_SIZE,
        font: ctx.bold,
        color: INK_MUTED,
      });
      lineY -= 9;
    }
    x += col.width;
  }

  ctx.y -= headerBlockHeight;
  drawRule(ctx);
  ctx.y -= TABLE_ROW_HEIGHT;

  const rows =
    cards.length > 0
      ? cards
      : [
          {
            card_name: "",
            set_name: "",
            restoration_fee: "",
            market_value_raw_nm: "",
          },
        ];

  rows.forEach((row, rowIndex) => {
    ensureSpace(ctx, TABLE_ROW_HEIGHT + 4);
    if (rowIndex % 2 === 1) {
      ctx.page.drawRectangle({
        x: MARGIN_X,
        y: ctx.y - 4,
        width: CONTENT_WIDTH,
        height: TABLE_ROW_HEIGHT,
        color: rgb(0.985, 0.985, 0.988),
      });
    }

    const values = [
      truncateToWidth(row.card_name, ctx.font, FONT_SIZE, cols[0].width - 12),
      truncateToWidth(row.set_name, ctx.font, FONT_SIZE, cols[1].width - 12),
      truncateToWidth(
        row.restoration_fee === "" || row.restoration_fee == null
          ? ""
          : `$${formatExactMoneyAmount(row.restoration_fee)}`,
        ctx.font,
        FONT_SIZE,
        cols[2].width - 12
      ),
      truncateToWidth(
        row.market_value_raw_nm === "" || row.market_value_raw_nm == null
          ? ""
          : `$${formatExactMoneyAmount(row.market_value_raw_nm)}`,
        ctx.font,
        FONT_SIZE,
        cols[3].width - 12
      ),
    ];

    let cx = MARGIN_X;
    for (let i = 0; i < cols.length; i += 1) {
      const col = cols[i];
      const value = values[i];
      const textWidth = ctx.font.widthOfTextAtSize(value, FONT_SIZE);
      const textX =
        col.align === "right" ? cx + col.width - 6 - textWidth : cx + 6;
      ctx.page.drawText(value, {
        x: textX,
        y: ctx.y,
        size: FONT_SIZE,
        font: ctx.font,
        color: INK,
      });
      cx += col.width;
    }

    ctx.y -= 4;
    drawRule(ctx, { soft: true });
    ctx.y -= TABLE_ROW_HEIGHT - 4;
  });

  ctx.y -= 8;
}

function drawLabeledLine(ctx, label, value = "", { lineWidth = 280 } = {}) {
  ensureSpace(ctx, 22);
  ctx.page.drawText(label, {
    x: MARGIN_X,
    y: ctx.y,
    size: FONT_SIZE,
    font: ctx.font,
    color: INK,
  });
  const labelWidth = ctx.font.widthOfTextAtSize(label, FONT_SIZE);
  const startX = MARGIN_X + labelWidth + 6;
  if (value) {
    ctx.page.drawText(value, {
      x: startX,
      y: ctx.y,
      size: FONT_SIZE,
      font: ctx.font,
      color: INK,
    });
  } else {
    ctx.page.drawLine({
      start: { x: startX, y: ctx.y - 1 },
      end: { x: Math.min(startX + lineWidth, PAGE_WIDTH - MARGIN_X), y: ctx.y - 1 },
      thickness: 0.7,
      color: RULE,
    });
  }
  ctx.y -= 20;
}

function drawSignatureBlock(ctx, payload, signatureImage = null) {
  drawSectionTitle(ctx, "ACKNOWLEDGMENT & SIGNATURES");
  drawWrappedParagraph(
    ctx,
    "By signing below, Customer confirms that the card information is accurate, each card has been photographed before restoration, and all Restoration Fees and Near Mint Raw Market Values have been reviewed and mutually accepted."
  );
  drawWrappedParagraph(
    ctx,
    "Customer confirms that they have read and understood this Agreement and agree to all of its terms."
  );

  const customerName = String(payload.customer_name ?? "").trim();
  const repName =
    String(payload.representative_name ?? "").trim() ||
    POKEPATCH_REPRESENTATIVE_NAME;
  const agreementDate =
    String(payload.agreement_date ?? "").trim() || formatContractDate();

  ensureSpace(ctx, 200);
  ctx.y -= 4;

  ctx.page.drawText("Customer", {
    x: MARGIN_X,
    y: ctx.y,
    size: 8,
    font: ctx.bold,
    color: INK_MUTED,
  });
  ctx.y -= 14;
  drawLabeledLine(ctx, "Name:", customerName, { lineWidth: 320 });
  drawLabeledLine(ctx, "Signature:", "", { lineWidth: 300 });
  drawLabeledLine(ctx, "Date:", "", { lineWidth: 160 });

  ctx.y -= 8;
  ctx.page.drawText("PokéPatch", {
    x: MARGIN_X,
    y: ctx.y,
    size: 8,
    font: ctx.bold,
    color: INK_MUTED,
  });
  ctx.y -= 14;
  drawLabeledLine(ctx, "Representative:", repName, { lineWidth: 260 });

  // Signature row — image sits fully below the label baseline.
  ensureSpace(ctx, 70);
  const sigLabel = "Signature:";
  ctx.page.drawText(sigLabel, {
    x: MARGIN_X,
    y: ctx.y,
    size: FONT_SIZE,
    font: ctx.font,
    color: INK,
  });
  const labelWidth = ctx.font.widthOfTextAtSize(sigLabel, FONT_SIZE);
  const sigX = MARGIN_X + labelWidth + 8;

  if (signatureImage) {
    const maxWidth = 150;
    const maxHeight = 42;
    const scale = Math.min(
      maxWidth / signatureImage.width,
      maxHeight / signatureImage.height
    );
    const drawWidth = signatureImage.width * scale;
    const drawHeight = signatureImage.height * scale;
    // Drop below the label so the image never intersects "Representative".
    ctx.y -= 8;
    ctx.page.drawImage(signatureImage, {
      x: sigX,
      y: ctx.y - drawHeight,
      width: drawWidth,
      height: drawHeight,
    });
    ctx.y -= drawHeight + 14;
  } else {
    ctx.page.drawLine({
      start: { x: sigX, y: ctx.y - 1 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: ctx.y - 1 },
      thickness: 0.7,
      color: RULE,
    });
    ctx.y -= 22;
  }

  drawLabeledLine(ctx, "Date:", agreementDate, { lineWidth: 160 });
}

function drawPageNumbers(doc, font) {
  const pages = doc.getPages();
  const total = pages.length;
  if (total <= 1) return;
  for (let i = 0; i < total; i += 1) {
    const page = pages[i];
    const label = `${i + 1} / ${total}`;
    const width = font.widthOfTextAtSize(label, 8);
    page.drawText(label, {
      x: PAGE_WIDTH - MARGIN_X - width,
      y: 24,
      size: 8,
      font,
      color: INK_MUTED,
    });
  }
}

/**
 * Build a filled liability-agreement PDF for the given payload.
 * Table grows with card count (no 6-row cap).
 * @returns {Promise<Uint8Array>}
 */
export async function buildOrderContractPdf(payload) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const ctx = {
    doc,
    page,
    font,
    bold,
    y: PAGE_HEIGHT - MARGIN_TOP,
  };

  let signatureImage = null;
  const signatureBytes = await loadRepSignaturePngBytes();
  if (signatureBytes?.length) {
    try {
      signatureImage = await doc.embedPng(signatureBytes);
    } catch {
      signatureImage = null;
    }
  }

  drawHeader(ctx);

  drawSectionTitle(ctx, "RESTORATION ORDER");
  drawTable(ctx, Array.isArray(payload?.cards) ? payload.cards : []);

  drawSectionTitle(ctx, "AGREEMENT");
  for (const para of AGREEMENT_PARAS) {
    drawWrappedParagraph(ctx, para);
  }
  drawWrappedParagraph(
    ctx,
    "1. Receive the damaged card back, with no payment from PokéPatch;",
    { indent: 10 }
  );
  drawWrappedParagraph(
    ctx,
    "2. Receive the Near Mint Raw Market Value, in which case PokéPatch will retain the damaged card.",
    { indent: 10 }
  );
  drawWrappedParagraph(ctx, "Covered damage includes:");
  for (const item of DAMAGES) {
    drawWrappedParagraph(ctx, item, { bullet: true, indent: 10 });
  }
  for (const para of AGREEMENT_TAIL) {
    drawWrappedParagraph(ctx, para);
  }

  drawSignatureBlock(ctx, payload ?? {}, signatureImage);
  drawPageNumbers(doc, font);

  return doc.save();
}

export function signedContractPath(orderId) {
  return `${orderId}/signed.pdf`;
}

export const DEFAULT_CONTRACT_NOTIFY_SUBJECT =
  "Your PokéPatch restoration agreement is ready";

export function defaultContractNotifyBody(displayId) {
  const orderLine =
    displayId != null && String(displayId).trim() !== ""
      ? ` for order #${displayId}`
      : "";
  return [
    `Your property & liability agreement${orderLine} is ready on My Orders.`,
    "",
    "Please download the PDF, sign it, and upload the signed copy back on that order page.",
    "",
    "Thanks,",
    "PokéPatch",
  ].join("\n");
}

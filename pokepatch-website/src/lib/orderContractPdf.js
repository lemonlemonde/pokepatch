import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  PRIORITY_FEE_PER_CARD,
  billableQuoteCards,
} from "@/lib/servicePricing";

export const ORDER_CONTRACTS_BUCKET = "order-contracts";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 54;
const MARGIN_TOP = 48;
const MARGIN_BOTTOM = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const FONT_SIZE = 10;
const TITLE_SIZE = 16;
const SECTION_SIZE = 11;
const LINE_HEIGHT = 13;
const TABLE_ROW_HEIGHT = 18;

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
 * Format a money amount for the PDF without rounding currency.
 * Strips only binary float noise (not business rounding).
 */
export function formatExactMoneyAmount(value) {
  if (value === "" || value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/^\$/, "");
    if (trimmed !== "" && Number.isFinite(Number(trimmed))) return trimmed;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const cleaned = n.toFixed(12).replace(/\.?0+$/, "");
  return cleaned === "-0" ? "0" : cleaned;
}

function moneyDisplay(value) {
  return formatExactMoneyAmount(value);
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

function customerDisplayName(draft) {
  const first = String(draft?.first_name ?? "").trim();
  const last = String(draft?.last_name ?? "").trim();
  const combined = [first, last].filter(Boolean).join(" ");
  if (combined) return combined;
  return String(draft?.customer_name ?? "").trim();
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
    customer_name: customerDisplayName(draft),
    representative_name: "",
    agreement_date: formatContractDate(),
    cards: rows,
  };
}

function drawHeader(page, font, bold, y) {
  let cursor = y;
  page.drawText("POKÉPATCH", {
    x: MARGIN_X,
    y: cursor,
    size: TITLE_SIZE,
    font: bold,
    color: rgb(0.1, 0.1, 0.12),
  });
  cursor -= 18;
  page.drawText("Pokémon Card Restoration — Customer Property & Liability Agreement", {
    x: MARGIN_X,
    y: cursor,
    size: 11,
    font: bold,
    color: rgb(0.15, 0.15, 0.18),
  });
  cursor -= 16;
  const intro =
    'This Agreement is between PokéPatch ("Restorer") and the undersigned customer ("Customer") regarding the Pokémon card(s) submitted for restoration under this Agreement.';
  for (const line of wrapText(intro, font, FONT_SIZE, CONTENT_WIDTH)) {
    page.drawText(line, {
      x: MARGIN_X,
      y: cursor,
      size: FONT_SIZE,
      font,
      color: rgb(0.2, 0.2, 0.22),
    });
    cursor -= LINE_HEIGHT;
  }
  return cursor - 8;
}

function ensureSpace(ctx, needed) {
  if (ctx.y - needed >= MARGIN_BOTTOM) return;
  ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.y = PAGE_HEIGHT - MARGIN_TOP;
}

function drawSectionTitle(ctx, title) {
  ensureSpace(ctx, 24);
  ctx.page.drawText(title, {
    x: MARGIN_X,
    y: ctx.y,
    size: SECTION_SIZE,
    font: ctx.bold,
    color: rgb(0.1, 0.1, 0.12),
  });
  ctx.y -= 4;
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN_X, y: ctx.y },
    thickness: 1,
    color: rgb(0.75, 0.75, 0.78),
  });
  ctx.y -= 16;
}

function drawWrappedParagraph(ctx, text, { indent = 0, bullet = false } = {}) {
  const maxWidth = CONTENT_WIDTH - indent - (bullet ? 14 : 0);
  const lines = wrapText(text, ctx.font, FONT_SIZE, maxWidth);
  for (let i = 0; i < lines.length; i += 1) {
    ensureSpace(ctx, LINE_HEIGHT + 2);
    const x = MARGIN_X + indent + (bullet ? 14 : 0);
    if (bullet && i === 0) {
      ctx.page.drawText("•", {
        x: MARGIN_X + indent,
        y: ctx.y,
        size: FONT_SIZE,
        font: ctx.font,
        color: rgb(0.2, 0.2, 0.22),
      });
    }
    ctx.page.drawText(lines[i], {
      x,
      y: ctx.y,
      size: FONT_SIZE,
      font: ctx.font,
      color: rgb(0.2, 0.2, 0.22),
    });
    ctx.y -= LINE_HEIGHT;
  }
  ctx.y -= 4;
}

function drawTable(ctx, cards) {
  const cols = [
    { label: "Card Name", width: 180 },
    { label: "Set / Expansion", width: 150 },
    { label: "Restoration Fee", width: 100 },
    { label: "Near Mint Raw Market Value", width: 104 },
  ];

  ensureSpace(ctx, TABLE_ROW_HEIGHT + 8);
  let x = MARGIN_X;
  for (const col of cols) {
    ctx.page.drawText(col.label, {
      x,
      y: ctx.y,
      size: 8,
      font: ctx.bold,
      color: rgb(0.25, 0.25, 0.28),
    });
    x += col.width;
  }
  ctx.y -= 4;
  ctx.page.drawLine({
    start: { x: MARGIN_X, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN_X, y: ctx.y },
    thickness: 0.75,
    color: rgb(0.7, 0.7, 0.72),
  });
  ctx.y -= TABLE_ROW_HEIGHT;

  const rows =
    cards.length > 0
      ? cards
      : [{ card_name: "", set_name: "", restoration_fee: "", market_value_raw_nm: "" }];

  for (const row of rows) {
    ensureSpace(ctx, TABLE_ROW_HEIGHT);
    const values = [
      truncateToWidth(row.card_name, ctx.font, FONT_SIZE, cols[0].width - 6),
      truncateToWidth(row.set_name, ctx.font, FONT_SIZE, cols[1].width - 6),
      row.restoration_fee === "" || row.restoration_fee == null
        ? ""
        : `$${moneyDisplay(row.restoration_fee)}`,
      row.market_value_raw_nm === "" || row.market_value_raw_nm == null
        ? ""
        : `$${moneyDisplay(row.market_value_raw_nm)}`,
    ];
    let cx = MARGIN_X;
    for (let i = 0; i < cols.length; i += 1) {
      ctx.page.drawText(values[i], {
        x: cx,
        y: ctx.y,
        size: FONT_SIZE,
        font: ctx.font,
        color: rgb(0.12, 0.12, 0.14),
      });
      cx += cols[i].width;
    }
    ctx.y -= 3;
    ctx.page.drawLine({
      start: { x: MARGIN_X, y: ctx.y },
      end: { x: PAGE_WIDTH - MARGIN_X, y: ctx.y },
      thickness: 0.4,
      color: rgb(0.82, 0.82, 0.84),
    });
    ctx.y -= TABLE_ROW_HEIGHT - 3;
  }
  ctx.y -= 6;
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

  ensureSpace(ctx, 140);
  const customerName = String(payload.customer_name ?? "").trim();
  const repName = String(payload.representative_name ?? "").trim();
  const agreementDate =
    String(payload.agreement_date ?? "").trim() || formatContractDate();

  ctx.page.drawText(`Customer Name: ${customerName}`, {
    x: MARGIN_X,
    y: ctx.y,
    size: FONT_SIZE,
    font: ctx.font,
    color: rgb(0.12, 0.12, 0.14),
  });
  ctx.y -= 22;
  ctx.page.drawText("Customer Signature: ___________________________________________", {
    x: MARGIN_X,
    y: ctx.y,
    size: FONT_SIZE,
    font: ctx.font,
    color: rgb(0.12, 0.12, 0.14),
  });
  ctx.y -= 22;
  // Left blank — customer fills when they sign offline.
  ctx.page.drawText("Date: ______________________", {
    x: MARGIN_X,
    y: ctx.y,
    size: FONT_SIZE,
    font: ctx.font,
    color: rgb(0.12, 0.12, 0.14),
  });
  ctx.y -= 28;
  ctx.page.drawText(`PokéPatch Representative: ${repName}`, {
    x: MARGIN_X,
    y: ctx.y,
    size: FONT_SIZE,
    font: ctx.font,
    color: rgb(0.12, 0.12, 0.14),
  });
  ctx.y -= 22;

  const sigLabel = "Signature: ";
  ctx.page.drawText(sigLabel, {
    x: MARGIN_X,
    y: ctx.y,
    size: FONT_SIZE,
    font: ctx.font,
    color: rgb(0.12, 0.12, 0.14),
  });

  const labelWidth = ctx.font.widthOfTextAtSize(sigLabel, FONT_SIZE);
  if (signatureImage) {
    const maxWidth = 160;
    const maxHeight = 36;
    const scale = Math.min(
      maxWidth / signatureImage.width,
      maxHeight / signatureImage.height
    );
    const drawWidth = signatureImage.width * scale;
    const drawHeight = signatureImage.height * scale;
    ctx.page.drawImage(signatureImage, {
      x: MARGIN_X + labelWidth + 4,
      y: ctx.y - 6,
      width: drawWidth,
      height: drawHeight,
    });
  } else {
    ctx.page.drawText("_________________________________________________", {
      x: MARGIN_X + labelWidth,
      y: ctx.y,
      size: FONT_SIZE,
      font: ctx.font,
      color: rgb(0.12, 0.12, 0.14),
    });
  }
  ctx.y -= 28;
  ctx.page.drawText(`Date: ${agreementDate}`, {
    x: MARGIN_X,
    y: ctx.y,
    size: FONT_SIZE,
    font: ctx.font,
    color: rgb(0.12, 0.12, 0.14),
  });
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

  ctx.y = drawHeader(ctx.page, font, bold, ctx.y);

  drawSectionTitle(ctx, "RESTORATION ORDER");
  drawTable(ctx, Array.isArray(payload?.cards) ? payload.cards : []);

  drawSectionTitle(ctx, "AGREEMENT");
  for (const para of AGREEMENT_PARAS) {
    drawWrappedParagraph(ctx, para);
  }
  drawWrappedParagraph(ctx, "1. Receive the damaged card back, with no payment from PokéPatch;", {
    indent: 12,
  });
  drawWrappedParagraph(
    ctx,
    "2. Receive the Near Mint Raw Market Value, in which case PokéPatch will retain the damaged card.",
    { indent: 12 }
  );
  drawWrappedParagraph(ctx, "Covered damage includes:");
  for (const item of DAMAGES) {
    drawWrappedParagraph(ctx, item, { bullet: true, indent: 8 });
  }
  for (const para of AGREEMENT_TAIL) {
    drawWrappedParagraph(ctx, para);
  }

  drawSignatureBlock(ctx, payload ?? {}, signatureImage);

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

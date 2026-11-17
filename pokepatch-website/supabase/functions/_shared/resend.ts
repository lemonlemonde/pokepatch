import { formatMoney } from "./servicePricing.ts";

export type ResendSendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

export type QuoteReceiptLine = {
  label?: string;
  amount?: number;
};

export type QuoteReceiptCard = {
  cardId?: string | null;
  label?: string;
  subtotal?: number;
  lines?: QuoteReceiptLine[];
  note?: string;
};

export type QuoteReceiptAdjustment = {
  description?: string;
  amount?: number;
  amountPercent?: number | null;
};

export type QuoteReceiptQueueFee = {
  speed?: string;
  description?: string;
  amount?: number;
};

export type QuoteReceiptPayload = {
  cards?: QuoteReceiptCard[];
  adjustments?: QuoteReceiptAdjustment[];
  queueFees?: QuoteReceiptQueueFee[];
  total?: number;
};

export type ChangelogPayload = {
  cardGroups?: Array<{
    cardId?: string;
    label?: string;
    status?: "added" | "removed" | "modified" | string;
    changes?: string[];
  }>;
  orderChanges?: string[];
  quoteSummary?: string | null;
  quoteReceipt?: QuoteReceiptPayload | null;
};

const SITE_URL = "https://pokepatch.cards";
const MY_ORDERS_URL = "https://pokepatch.cards/my-orders/";
const INSTAGRAM_URL = "https://www.instagram.com/pokepatch.cards/";
const INSTAGRAM_HANDLE = "@pokepatch.cards";
const DEFAULT_LOGO_URL = "https://pokepatch.cards/email/pokepatch-icon.png";

function getLogoUrl(): string {
  return Deno.env.get("RESEND_LOGO_URL")?.trim() || DEFAULT_LOGO_URL;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatOrderLine(orderDisplayId: number | string | null | undefined): string | null {
  if (orderDisplayId === null || orderDisplayId === undefined || orderDisplayId === "") {
    return null;
  }
  return `Regarding Order #${orderDisplayId}`;
}

/** Plain-text body stored in-app / history (order line + message, no email chrome). */
export function buildStoredMessageBody(
  body: string,
  orderDisplayId?: number | string | null
): string {
  const regarding = formatOrderLine(orderDisplayId);
  const trimmed = body.trim();
  if (!regarding) return trimmed;
  return `${regarding}\n\n${trimmed}`;
}

function splitArrowDiff(text: string): {
  prefix: string;
  from: string;
  to: string;
} | null {
  const raw = String(text ?? "");
  const idx = raw.indexOf("→");
  if (idx === -1) return null;
  const left = raw.slice(0, idx).trim();
  const to = raw.slice(idx + 1).trim();
  if (!left || !to) return null;
  const colon = left.indexOf(":");
  if (colon !== -1) {
    return {
      prefix: `${left.slice(0, colon + 1)} `,
      from: left.slice(colon + 1).trim(),
      to,
    };
  }
  return { prefix: "", from: left, to };
}

function statusChipHtml(label: string): string {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:rgba(243,233,242,0.12);color:#F3E9F2;font-size:11px;font-weight:700;">${escapeHtml(label)}</span>`;
}

function formatDiffLineHtml(text: string): string {
  const parts = splitArrowDiff(text);
  if (parts && /^status:\s*/i.test(parts.prefix || text)) {
    return `<span style="color:#C9B8C8;">Status:</span> ` +
      statusChipHtml(parts.from) +
      `<span style="color:#8A7A89;margin:0 0.35em;">→</span>` +
      statusChipHtml(parts.to);
  }
  if (parts) {
    const label = parts.prefix.trim();
    return (label
      ? `<span style="color:#C9B8C8;">${escapeHtml(label)}</span> `
      : "") +
      `<span style="color:#F87171;text-decoration:line-through;font-weight:600;">${escapeHtml(parts.from)}</span>` +
      `<span style="color:#8A7A89;margin:0 0.35em;">→</span>` +
      `<span style="color:#5EC8A7;font-weight:600;">${escapeHtml(parts.to)}</span>`;
  }
  const photoFolder = String(text).match(
    /^(Photo album added|Photo album updated):\s+(.+)$/i
  );
  if (photoFolder) {
    const href = escapeHtml(photoFolder[2].trim());
    return `<span style="color:#C9B8C8;">${escapeHtml(`${photoFolder[1]}:`)}</span> ` +
      `<a href="${href}" style="color:#5EC8A7;font-weight:600;word-break:break-all;" target="_blank" rel="noopener noreferrer">${href}</a>`;
  }
  if (/^Photo album removed$/i.test(String(text))) {
    return `<span style="color:#F87171;font-weight:600;">${escapeHtml(text)}</span>`;
  }
  const labeled = text.match(
    /^(Added|Removed|Applied discount|Removed discount|Applied|Updated|High-value fee|Quote total):\s+(.+)$/i
  );
  if (labeled) {
    const removed = /^removed/i.test(labeled[1]);
    const valueColor = removed ? "#F87171" : "#5EC8A7";
    return `<span style="color:#C9B8C8;">${escapeHtml(`${labeled[1]}:`)}</span> ` +
      `<span style="color:${valueColor};font-weight:600;">${escapeHtml(labeled[2])}</span>`;
  }
  const unchanged = text.match(/^(Quote total unchanged at)\s+(.+)$/i);
  if (unchanged) {
    return `<span style="color:#C9B8C8;">${escapeHtml(unchanged[1])}</span> ` +
      `<span style="color:#F3E9F2;font-weight:600;">${escapeHtml(unchanged[2])}</span>`;
  }
  return `<span style="color:#C9B8C8;">${escapeHtml(text)}</span>`;
}

export function quoteReceiptHasContent(
  receipt?: QuoteReceiptPayload | null
): boolean {
  if (!receipt || typeof receipt !== "object") return false;
  if ((receipt.cards?.length ?? 0) > 0) return true;
  if ((receipt.adjustments?.length ?? 0) > 0) return true;
  if ((receipt.queueFees ?? []).some((row) => Number(row?.amount) > 0)) return true;
  return false;
}

function receiptQueueFeeRows(
  receipt?: QuoteReceiptPayload | null
): QuoteReceiptQueueFee[] {
  return (receipt?.queueFees ?? []).filter((row) => Number(row?.amount) > 0);
}

export function hasChangelogContent(changelog?: ChangelogPayload | null): boolean {
  if (!changelog || typeof changelog !== "object") return false;
  return (
    (changelog.cardGroups?.length ?? 0) > 0 ||
    (changelog.orderChanges?.length ?? 0) > 0 ||
    Boolean(changelog.quoteSummary) ||
    quoteReceiptHasContent(changelog.quoteReceipt)
  );
}

function formatReceiptPercent(percent: unknown): string | null {
  const n = Number(percent);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function padReceiptLine(label: string, amount: unknown, indent = 0): string {
  const left = `${" ".repeat(indent)}${label}`;
  const right = formatMoney(amount);
  const gap = Math.max(2, 46 - left.length - right.length);
  return `${left}${" ".repeat(gap)}${right}`;
}

export function formatQuoteReceiptPlainText(
  receipt?: QuoteReceiptPayload | null
): string {
  if (!quoteReceiptHasContent(receipt)) return "";
  const lines: string[] = [];
  (receipt?.cards ?? []).forEach((card, index) => {
    const prefix = index > 0 ? "+ " : "";
    lines.push(padReceiptLine(`${prefix}${String(card.label ?? "Card")}`, card.subtotal));
    for (const line of card.lines ?? []) {
      lines.push(
        padReceiptLine(String(line.label ?? "Service"), line.amount, 2)
      );
    }
    if (card.note) lines.push(`  Note: ${card.note}`);
  });
  for (const adj of receipt?.adjustments ?? []) {
    const sign = Number(adj.amount) >= 0 ? "+ " : "− ";
    const pct = formatReceiptPercent(adj.amountPercent);
    const pctText = pct ? ` (${pct}%)` : "";
    lines.push(
      padReceiptLine(
        `${sign}${String(adj.description ?? "Adjustment")}${pctText}`,
        adj.amount
      )
    );
  }
  for (const row of receiptQueueFeeRows(receipt)) {
    lines.push(
      padReceiptLine(
        `+ ${String(row.description ?? "Queue fee")}`,
        row.amount
      )
    );
  }
  lines.push(padReceiptLine("= Total", receipt?.total));
  return lines.join("\n");
}

function formatQuoteReceiptHtml(receipt?: QuoteReceiptPayload | null): string {
  if (!quoteReceiptHasContent(receipt)) return "";
  const cards = receipt?.cards ?? [];
  const adjustments = receipt?.adjustments ?? [];
  const queueFees = receiptQueueFeeRows(receipt);

  const cardBlocks = cards.map((card, index) => {
    const prefix =
      index > 0
        ? `<span style="color:#8A7A89;font-weight:400;">+ </span>`
        : "";
    const lineRows = (card.lines ?? [])
      .map(
        (line) =>
          `<tr>` +
          `<td style="padding:5px 0 0 10px;font-size:13px;line-height:1.45;color:#C9B8C8;">${escapeHtml(String(line.label ?? "Service"))}</td>` +
          `<td style="padding:5px 0 0;font-size:13px;line-height:1.45;font-weight:700;color:#F3E9F2;text-align:right;white-space:nowrap;">${escapeHtml(formatMoney(line.amount))}</td>` +
          `</tr>`
      )
      .join("");
    const noteRow = card.note
      ? `<tr><td colspan="2" style="padding:8px 0 0 10px;font-size:12px;line-height:1.5;color:#8A7A89;">${escapeHtml(String(card.note))}</td></tr>`
      : "";
    const breakdown =
      lineRows || noteRow
        ? `<tr><td colspan="2" style="padding:8px 12px 10px;">` +
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid rgba(243,233,242,0.12);">` +
          `${lineRows}${noteRow}</table></td></tr>`
        : "";
    const headerPad = breakdown ? "10px 12px 4px" : "10px 12px";
    return (
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;border:1px solid rgba(243,233,242,0.14);border-radius:8px;background:rgba(243,233,242,0.05);">` +
      `<tr>` +
      `<td style="padding:${headerPad};font-size:14px;font-weight:700;color:#F3E9F2;line-height:1.4;">${prefix}${escapeHtml(String(card.label ?? "Card"))}</td>` +
      `<td style="padding:${headerPad};font-size:14px;font-weight:700;color:#F3E9F2;text-align:right;white-space:nowrap;">${escapeHtml(formatMoney(card.subtotal))}</td>` +
      `</tr>` +
      breakdown +
      `</table>`
    );
  }).join("");

  const extraRows: string[] = [];
  for (const adj of adjustments) {
    const sign = Number(adj.amount) >= 0 ? "+ " : "− ";
    const pct = formatReceiptPercent(adj.amountPercent);
    const pctHtml = pct
      ? `<span style="color:#8A7A89;"> (${escapeHtml(pct)}%)</span>`
      : "";
    extraRows.push(
      `<tr>` +
        `<td style="padding:6px 2px;font-size:13px;line-height:1.45;color:#C9B8C8;">` +
        `<span style="color:#8A7A89;">${sign}</span>${escapeHtml(String(adj.description ?? "Adjustment"))}${pctHtml}</td>` +
        `<td style="padding:6px 2px;font-size:13px;line-height:1.45;color:#F3E9F2;text-align:right;white-space:nowrap;">${escapeHtml(formatMoney(adj.amount))}</td>` +
      `</tr>`
    );
  }
  for (const row of queueFees) {
    extraRows.push(
      `<tr>` +
        `<td style="padding:6px 2px;font-size:13px;line-height:1.45;color:#C9B8C8;">` +
        `<span style="color:#8A7A89;">+ </span>${escapeHtml(String(row.description ?? "Queue fee"))}</td>` +
        `<td style="padding:6px 2px;font-size:13px;line-height:1.45;color:#F3E9F2;text-align:right;white-space:nowrap;">${escapeHtml(formatMoney(row.amount))}</td>` +
      `</tr>`
    );
  }

  return (
    `<div style="margin:0 0 1.25rem;border:1px solid rgba(243,233,242,0.2);border-radius:12px;background:rgba(243,233,242,0.06);overflow:hidden;">` +
      `<div style="padding:10px 14px 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8A7A89;">Your quote</div>` +
      `<div style="padding:4px 12px 12px;">` +
        cardBlocks +
        (extraRows.length > 0
          ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${extraRows.join("")}</table>`
          : "") +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;border-top:1px dashed rgba(243,233,242,0.25);">` +
          `<tr>` +
            `<td style="padding:10px 2px 2px;font-size:15px;font-weight:700;color:#F3E9F2;">= Total</td>` +
            `<td style="padding:10px 2px 2px;font-size:16px;font-weight:800;color:#F3E9F2;text-align:right;white-space:nowrap;">${escapeHtml(formatMoney(receipt?.total))}</td>` +
          `</tr>` +
        `</table>` +
      `</div>` +
    `</div>`
  );
}

export function formatChangelogPlainText(changelog?: ChangelogPayload | null): string {
  if (!hasChangelogContent(changelog)) return "";
  const lines: string[] = [];
  const hasReceipt = quoteReceiptHasContent(changelog?.quoteReceipt);
  const quoteInOrderText = (changelog?.orderChanges ?? []).some((line) =>
    String(line).startsWith("Quote total")
  );
  if (changelog?.quoteSummary && !quoteInOrderText && !hasReceipt) {
    lines.push(String(changelog.quoteSummary), "");
  }
  if ((changelog?.orderChanges?.length ?? 0) > 0) {
    lines.push("Order");
    for (const change of changelog?.orderChanges ?? []) {
      lines.push(`  - ${change}`);
    }
    lines.push("");
  }
  for (const group of changelog?.cardGroups ?? []) {
    lines.push(String(group.label ?? "Card"));
    if (group.status === "added") lines.push("  (New card)");
    if (group.status === "removed") lines.push("  (Removed)");
    if (group.status === "modified") lines.push("  (Updated)");
    for (const change of group.changes ?? []) {
      lines.push(`  - ${change}`);
    }
    lines.push("");
  }
  const receiptText = formatQuoteReceiptPlainText(changelog?.quoteReceipt);
  if (receiptText) {
    lines.push("Your quote", receiptText, "");
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function formatChangelogHtml(changelog?: ChangelogPayload | null): string {
  if (!hasChangelogContent(changelog)) return "";
  const blocks: string[] = [];
  const hasReceipt = quoteReceiptHasContent(changelog?.quoteReceipt);
  const quoteInOrder = (changelog?.orderChanges ?? []).some((line) =>
    String(line).startsWith("Quote total")
  );
  if (changelog?.quoteSummary && !quoteInOrder && !hasReceipt) {
    blocks.push(
      `<p style="margin:0 0 0.75rem;font-size:13px;line-height:1.5;">${formatDiffLineHtml(String(changelog.quoteSummary))}</p>`
    );
  }
  if ((changelog?.orderChanges?.length ?? 0) > 0) {
    const lines = (changelog?.orderChanges ?? [])
      .map(
        (line) =>
          `<li style="margin:0 0 0.35rem;font-size:13px;line-height:1.5;">${formatDiffLineHtml(String(line))}</li>`
      )
      .join("");
    blocks.push(
      `<div style="margin:0 0 0.6rem;border:1px solid rgba(243,233,242,0.15);border-radius:10px;background:rgba(243,233,242,0.04);overflow:hidden;">` +
        `<div style="padding:8px 12px;border-bottom:1px solid rgba(243,233,242,0.08);"><span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#8A7A89;">Order</span></div>` +
        `<div style="padding:10px 12px;"><ul style="margin:0;padding-left:1.1rem;">${lines}</ul></div></div>`
    );
  }
  for (const group of changelog?.cardGroups ?? []) {
    const status = group.status;
    const border =
      status === "added"
        ? "rgba(94,200,167,0.45)"
        : status === "removed"
          ? "rgba(248,113,113,0.4)"
          : "rgba(110,168,220,0.4)";
    const bg =
      status === "added"
        ? "rgba(94,200,167,0.12)"
        : status === "removed"
          ? "rgba(248,113,113,0.12)"
          : "rgba(110,168,220,0.12)";
    const badge =
      status === "added"
        ? '<span style="color:#5EC8A7;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">New</span>'
        : status === "removed"
          ? '<span style="color:#F87171;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Removed</span>'
          : '<span style="color:#6EA8DC;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Updated</span>';
    const changeLines = (group.changes ?? [])
      .map(
        (line) =>
          `<li style="margin:0 0 0.35rem;font-size:13px;line-height:1.5;">${formatDiffLineHtml(String(line))}</li>`
      )
      .join("");
    const fallback =
      status === "added"
        ? '<p style="margin:0;font-size:12px;color:#8A7A89;">Added to order</p>'
        : status === "removed"
          ? '<p style="margin:0;font-size:12px;color:#8A7A89;">Removed from order</p>'
          : "";
    blocks.push(
      `<div style="margin:0 0 0.6rem;border:1px solid ${border};border-radius:10px;background:${bg};overflow:hidden;">` +
        `<div style="padding:8px 12px;border-bottom:1px solid rgba(243,233,242,0.08);">` +
        `${badge}` +
        `<span style="margin-left:8px;font-size:14px;font-weight:600;color:#F3E9F2;vertical-align:middle;">${escapeHtml(String(group.label ?? "Card"))}</span>` +
        `</div>` +
        `<div style="padding:10px 12px;">${
          changeLines
            ? `<ul style="margin:0;padding-left:1.1rem;">${changeLines}</ul>`
            : fallback
        }</div></div>`
    );
  }
  const receiptHtml = formatQuoteReceiptHtml(changelog?.quoteReceipt);
  const changelogBlocks = blocks.length
    ? `<div style="margin:0 0 1.25rem;">${blocks.join("")}</div>`
    : "";
  return `${changelogBlocks}${receiptHtml}`;
}

function buildPlainTextEmail(options: {
  subject: string;
  body: string;
  orderDisplayId?: number | string | null;
  changelog?: ChangelogPayload | null;
}): string {
  const regarding = formatOrderLine(options.orderDisplayId);
  const parts = [options.subject.trim(), ""];
  if (regarding) {
    parts.push(regarding, MY_ORDERS_URL, "");
  }
  const note = options.body.trim();
  if (note) {
    parts.push(note, "");
  }
  const changelogText = formatChangelogPlainText(options.changelog);
  if (changelogText) {
    parts.push(changelogText, "");
  }
  parts.push(
    "—",
    "The PokePatch Team",
    SITE_URL,
    INSTAGRAM_HANDLE
  );
  return parts.join("\n");
}

function buildHtmlEmail(options: {
  subject: string;
  body: string;
  orderDisplayId?: number | string | null;
  changelog?: ChangelogPayload | null;
}): string {
  const safeSubject = escapeHtml(options.subject.trim());
  const regarding = formatOrderLine(options.orderDisplayId);
  const note = options.body.trim();
  const safeBody = note
    ? `<p style="margin:0 0 1.25rem;font-size:15px;line-height:1.65;color:#F3E9F2;">${escapeHtml(note).replace(/\r\n|\r|\n/g, "<br />")}</p>`
    : "";
  const changelogHtml = formatChangelogHtml(options.changelog);
  const regardingHtml = regarding
    ? `<p style="margin:0 0 1.25rem;font-size:15px;font-weight:700;">
         <a href="${escapeHtml(MY_ORDERS_URL)}" style="color:#F3E9F2;text-decoration:underline;">${escapeHtml(regarding)}</a>
       </p>`
    : "";
  const logoUrl = escapeHtml(getLogoUrl());
  const siteUrl = escapeHtml(SITE_URL);
  const instagramUrl = escapeHtml(INSTAGRAM_URL);
  const instagramHandle = escapeHtml(INSTAGRAM_HANDLE);

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0B1020;font-family:Nunito,Segoe UI,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B1020;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#1A1230;border:2px solid rgba(243,233,242,0.15);border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:24px 28px 20px;background:linear-gradient(135deg,#221A36 0%,#1A1230 100%);">
              <a href="${siteUrl}" style="text-decoration:none;">
                <img
                  src="${logoUrl}"
                  alt="PokePatch"
                  width="72"
                  style="display:block;width:72px;max-width:24%;height:auto;border:0;outline:none;"
                />
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;">
              <p style="margin:0 0 1.25rem;font-size:18px;line-height:1.4;color:#F3E9F2;font-weight:700;">${safeSubject}</p>
              ${regardingHtml}
              ${safeBody}
              ${changelogHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;">
              <div style="border-top:1px solid rgba(243,233,242,0.15);padding-top:1.25rem;font-size:13px;line-height:1.5;">
                <p style="margin:0 0 0.35rem;font-weight:700;color:#F3E9F2;">The PokePatch Team</p>
                <p style="margin:0 0 0.2rem;">
                  <a href="${siteUrl}" style="color:#F3E9F2;text-decoration:underline;">${siteUrl}</a>
                </p>
                <p style="margin:0;">
                  <a href="${instagramUrl}" style="color:#F3E9F2;text-decoration:underline;">${instagramHandle}</a>
                </p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendResendEmail(options: {
  to: string;
  subject: string;
  body: string;
  orderDisplayId?: number | string | null;
  changelog?: ChangelogPayload | null;
}): Promise<ResendSendResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  const from = Deno.env.get("RESEND_FROM_EMAIL")?.trim();

  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }
  if (!from) {
    return { ok: false, error: "RESEND_FROM_EMAIL is not configured" };
  }

  const to = options.to.trim().toLowerCase();
  const subject = options.subject.trim();
  const body = options.body;

  if (!to || !subject) {
    return { ok: false, error: "to and subject are required" };
  }

  const text = buildPlainTextEmail({
    subject,
    body,
    orderDisplayId: options.orderDisplayId,
    changelog: options.changelog,
  });
  const html = buildHtmlEmail({
    subject,
    body,
    orderDisplayId: options.orderDisplayId,
    changelog: options.changelog,
  });

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html,
      }),
    });

    let payload: Record<string, unknown> | null = null;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message =
        (typeof payload?.message === "string" && payload.message) ||
        (typeof payload?.error === "string" && payload.error) ||
        `Resend request failed (${response.status})`;
      return { ok: false, error: message };
    }

    const id = typeof payload?.id === "string" ? payload.id : null;
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export type ResendSendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

export type ChangelogPayload = {
  cardGroups?: Array<{
    cardId?: string;
    label?: string;
    status?: "added" | "removed" | "modified" | string;
    changes?: string[];
    /** Optional email-only thumb URL (not persisted on messages). */
    thumbUrl?: string;
  }>;
  orderChanges?: string[];
  quoteSummary?: string | null;
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
      `<span style="color:#E0518A;text-decoration:line-through;font-weight:600;">${escapeHtml(parts.from)}</span>` +
      `<span style="color:#8A7A89;margin:0 0.35em;">→</span>` +
      `<span style="color:#5EC8A7;font-weight:600;">${escapeHtml(parts.to)}</span>`;
  }
  const labeled = text.match(
    /^(Added|Removed|Applied discount|Removed discount|Updated|High-value fee|Quote total):\s+(.+)$/i
  );
  if (labeled) {
    const removed = /^removed/i.test(labeled[1]);
    const valueColor = removed ? "#E0518A" : "#5EC8A7";
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

function hasChangelogContent(changelog?: ChangelogPayload | null): boolean {
  if (!changelog || typeof changelog !== "object") return false;
  return (
    (changelog.cardGroups?.length ?? 0) > 0 ||
    (changelog.orderChanges?.length ?? 0) > 0 ||
    Boolean(changelog.quoteSummary)
  );
}

export function formatChangelogPlainText(changelog?: ChangelogPayload | null): string {
  if (!hasChangelogContent(changelog)) return "";
  const lines: string[] = [];
  const quoteInOrderText = (changelog?.orderChanges ?? []).some((line) =>
    String(line).startsWith("Quote total")
  );
  if (changelog?.quoteSummary && !quoteInOrderText) {
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
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function formatChangelogHtml(
  changelog?: ChangelogPayload | null,
  thumbByCardId?: Record<string, string> | null
): string {
  if (!hasChangelogContent(changelog)) return "";
  const blocks: string[] = [];
  const quoteInOrder = (changelog?.orderChanges ?? []).some((line) =>
    String(line).startsWith("Quote total")
  );
  if (changelog?.quoteSummary && !quoteInOrder) {
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
          ? "rgba(224,81,138,0.4)"
          : "rgba(110,168,220,0.4)";
    const bg =
      status === "added"
        ? "rgba(94,200,167,0.12)"
        : status === "removed"
          ? "rgba(224,81,138,0.12)"
          : "rgba(110,168,220,0.12)";
    const badge =
      status === "added"
        ? '<span style="color:#5EC8A7;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">New</span>'
        : status === "removed"
          ? '<span style="color:#E0518A;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Removed</span>'
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
    const cardId = group.cardId != null ? String(group.cardId) : "";
    const thumbUrl =
      (cardId && thumbByCardId?.[cardId]) ||
      (typeof group.thumbUrl === "string" ? group.thumbUrl : "") ||
      "";
    const thumbCell = thumbUrl
      ? `<img src="${escapeHtml(thumbUrl)}" alt="" width="32" height="43" style="display:inline-block;width:32px;height:43px;object-fit:cover;border:0;border-radius:4px;vertical-align:middle;margin-left:6px;" />`
      : "";
    blocks.push(
      `<div style="margin:0 0 0.6rem;border:1px solid ${border};border-radius:10px;background:${bg};overflow:hidden;">` +
        `<div style="padding:8px 12px;border-bottom:1px solid rgba(243,233,242,0.08);">` +
        `${badge}` +
        `<span style="margin-left:8px;font-size:14px;font-weight:600;color:#F3E9F2;vertical-align:middle;">${escapeHtml(String(group.label ?? "Card"))}</span>` +
        thumbCell +
        `</div>` +
        `<div style="padding:10px 12px;">${
          changeLines
            ? `<ul style="margin:0;padding-left:1.1rem;">${changeLines}</ul>`
            : fallback
        }</div></div>`
    );
  }
  return `<div style="margin:0 0 1.25rem;">${blocks.join("")}</div>`;
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
  thumbByCardId?: Record<string, string> | null;
}): string {
  const safeSubject = escapeHtml(options.subject.trim());
  const regarding = formatOrderLine(options.orderDisplayId);
  const note = options.body.trim();
  const safeBody = note
    ? `<p style="margin:0 0 1.25rem;font-size:15px;line-height:1.65;color:#F3E9F2;">${escapeHtml(note).replace(/\r\n|\r|\n/g, "<br />")}</p>`
    : "";
  const changelogHtml = formatChangelogHtml(
    options.changelog,
    options.thumbByCardId
  );
  const regardingHtml = regarding
    ? `<p style="margin:0 0 1.25rem;font-size:15px;font-weight:700;">
         <a href="${escapeHtml(MY_ORDERS_URL)}" style="color:#E0518A;text-decoration:underline;">${escapeHtml(regarding)}</a>
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
                  <a href="${siteUrl}" style="color:#F9C5D5;text-decoration:underline;">${siteUrl}</a>
                </p>
                <p style="margin:0;">
                  <a href="${instagramUrl}" style="color:#F9C5D5;text-decoration:underline;">${instagramHandle}</a>
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
  thumbByCardId?: Record<string, string> | null;
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
    thumbByCardId: options.thumbByCardId,
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

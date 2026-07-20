export type ResendSendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

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

function buildPlainTextEmail(options: {
  subject: string;
  body: string;
  orderDisplayId?: number | string | null;
}): string {
  const regarding = formatOrderLine(options.orderDisplayId);
  const parts = [options.subject.trim(), ""];
  if (regarding) {
    parts.push(regarding, MY_ORDERS_URL, "");
  }
  parts.push(
    options.body.trim(),
    "",
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
}): string {
  const safeSubject = escapeHtml(options.subject.trim());
  const regarding = formatOrderLine(options.orderDisplayId);
  const safeBody = escapeHtml(options.body.trim()).replace(/\r\n|\r|\n/g, "<br />");
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
              <p style="margin:0;font-size:15px;line-height:1.65;color:#F3E9F2;">${safeBody}</p>
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
  });
  const html = buildHtmlEmail({
    subject,
    body,
    orderDisplayId: options.orderDisplayId,
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

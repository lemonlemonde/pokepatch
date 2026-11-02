/**
 * Wrap-up message actions: "Save & notify" (email the customer the stored
 * quote, same `customer_messages` + Resend path as the admin editor).
 *
 * custom_ids:
 * - `notify:<orderId>` button → modal `notify:<orderId>:<channelId>:<messageId>`
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceClient } from "../_shared/adminSession.ts";
import { isValidEmail, sendCustomerEmail } from "../_shared/customerMessages.ts";
import {
  CallbackType,
  EPHEMERAL,
  TextInputStyle,
  collectModalFields,
  editChannelMessage,
  editOriginal,
  ephemeralReply,
  fieldValue,
  json,
  labeled,
  textDisplay,
  textInput,
  type Interaction,
  type Json,
} from "../_shared/discord.ts";
import {
  DEFAULT_NOTIFY_SUBJECT,
  NOTIFY_BUTTON_PREFIX,
  buildQuoteChangelog,
  buildWrapupMessage,
  cardQuotes,
  loadOrderContext,
  parsePrefixedCustomId,
  type OrderContext,
} from "../_shared/discordOrderMessages.ts";
import { formatChangelogPlainText } from "../_shared/resend.ts";

const FIELD = { SUBJECT: "subject", MESSAGE: "message" } as const;
const MAX_SUBJECT_CHARS = 120;
const MAX_MESSAGE_CHARS = 2000;
const MAX_PREVIEW_CHARS = 1500;

/** Unquoted active cards, for the modal warning. */
function unquotedLabels(context: OrderContext): string[] {
  return cardQuotes(context)
    .filter((entry) => !entry.canceled && !entry.quoted)
    .map((entry) => `${entry.index + 1}`);
}

function notifyModal(params: {
  customId: string;
  context: OrderContext;
}): Json {
  const { customId, context } = params;
  const email = String(context.order.customer_email ?? "").trim();
  const changelog = buildQuoteChangelog(context);
  const preview = formatChangelogPlainText(changelog) || "(no quote lines yet)";
  const unquoted = unquotedLabels(context);

  const previewLines = [
    `**To:** ${email}`,
    "**Quote summary that will be emailed:**",
    "```",
    preview.length > MAX_PREVIEW_CHARS ? `${preview.slice(0, MAX_PREVIEW_CHARS)}…` : preview,
    "```",
  ];
  if (unquoted.length > 0) {
    previewLines.push(
      `⚠️ Card${unquoted.length === 1 ? "" : "s"} ${unquoted.join(", ")} not quoted yet — still send?`
    );
  }

  return {
    type: CallbackType.MODAL,
    data: {
      custom_id: customId,
      title: `Notify · Order #${context.order.display_id}`.slice(0, 45),
      components: [
        textDisplay(previewLines.join("\n")),
        labeled(
          "Subject",
          textInput({
            customId: FIELD.SUBJECT,
            style: TextInputStyle.SHORT,
            required: true,
            value: DEFAULT_NOTIFY_SUBJECT,
            maxLength: MAX_SUBJECT_CHARS,
          })
        ),
        labeled(
          "Message (optional)",
          textInput({
            customId: FIELD.MESSAGE,
            style: TextInputStyle.PARAGRAPH,
            required: false,
            placeholder: "Shown above the quote summary in the email. Leave blank to send just the summary.",
            maxLength: MAX_MESSAGE_CHARS,
          }),
          "Same as the admin editor's Save & notify"
        ),
      ],
    },
  };
}

/** "Save & notify" click → preview modal. */
export async function handleNotifyButton(interaction: Interaction): Promise<Response> {
  const data = (interaction.data ?? {}) as Json;
  const parsed = parsePrefixedCustomId(NOTIFY_BUTTON_PREFIX, String(data.custom_id ?? ""));
  if (!parsed) return ephemeralReply("Unknown button.");

  let context: OrderContext | null;
  try {
    context = await loadOrderContext(getServiceClient(), parsed.id);
  } catch (err) {
    console.error("notify button load failed", err);
    return ephemeralReply("Couldn't load this order. Try again.");
  }
  if (!context) return ephemeralReply("This order no longer exists.");

  const email = String(context.order.customer_email ?? "").trim();
  if (!email || !isValidEmail(email)) {
    return ephemeralReply("This order has no valid customer email — reach out via a contact method instead.");
  }

  const channelId = String(interaction.channel_id ?? "");
  const message = (interaction.message ?? {}) as Json;
  const messageId = String(message.id ?? "");
  return json(
    notifyModal({
      customId: `${NOTIFY_BUTTON_PREFIX}${parsed.id}:${channelId}:${messageId}`,
      context,
    })
  );
}

/** Email the stored quote (as a changelog) and log it like the admin editor does. */
export function sendQuoteNotification(params: {
  supabase: SupabaseClient;
  context: OrderContext;
  subject: string;
  message: string;
}): ReturnType<typeof sendCustomerEmail> {
  const { supabase, context, subject, message } = params;
  const changelog = buildQuoteChangelog(context);
  const hasChangelog =
    (changelog.cardGroups?.length ?? 0) > 0 || (changelog.orderChanges?.length ?? 0) > 0;
  return sendCustomerEmail({
    supabase,
    orderId: context.order.id,
    orderDisplayId: context.order.display_id,
    to: String(context.order.customer_email ?? ""),
    userId: context.order.user_id ?? null,
    subject,
    body: message,
    changelog: hasChangelog ? changelog : null,
  });
}

async function processNotifyModal(interaction: Interaction): Promise<void> {
  const applicationId = String(interaction.application_id ?? "");
  const token = String(interaction.token ?? "");
  const data = (interaction.data ?? {}) as Json;
  const parsed = parsePrefixedCustomId(NOTIFY_BUTTON_PREFIX, String(data.custom_id ?? ""));

  try {
    if (!parsed) {
      await editOriginal(applicationId, token, "Invalid notify form.");
      return;
    }
    const fields = collectModalFields(data.components);
    const subject =
      fieldValue(fields, FIELD.SUBJECT).trim().slice(0, MAX_SUBJECT_CHARS) ||
      DEFAULT_NOTIFY_SUBJECT;
    const message = fieldValue(fields, FIELD.MESSAGE).trim().slice(0, MAX_MESSAGE_CHARS);

    const supabase = getServiceClient();
    const context = await loadOrderContext(supabase, parsed.id);
    if (!context) {
      await editOriginal(applicationId, token, "This order no longer exists — nothing sent.");
      return;
    }

    const result = await sendQuoteNotification({ supabase, context, subject, message });
    if (!result.ok) {
      await editOriginal(applicationId, token, `❌ Email not sent: ${result.error}`);
      return;
    }

    let refreshed = false;
    if (parsed.channelId && parsed.messageId) {
      const fresh = (await loadOrderContext(supabase, parsed.id)) ?? context;
      refreshed = await editChannelMessage(
        parsed.channelId,
        parsed.messageId,
        buildWrapupMessage({ context: fresh, interactive: true })
      );
    }
    const out = [
      `📨 Emailed **${result.email}** — “${subject}”`,
      "-# Logged in the order's message history (admin → Messages).",
    ];
    if (!refreshed) out.push("-# Couldn't update the wrap-up message automatically.");
    await editOriginal(applicationId, token, out.join("\n"));
  } catch (err) {
    console.error("notify modal failed", err);
    const text = err instanceof Error ? err.message : String(err);
    await editOriginal(applicationId, token, `Email not sent: ${text}`);
  }
}

/** Modal submit: ACK now, send in the background. */
export function handleNotifyModal(
  interaction: Interaction,
  waitUntil: (promise: Promise<unknown>) => void
): Response {
  waitUntil(
    processNotifyModal(interaction).catch((err) => {
      console.error("notify modal background failed", err);
    })
  );
  return json({
    type: CallbackType.DEFERRED_CHANNEL_MESSAGE,
    data: { flags: EPHEMERAL },
  });
}

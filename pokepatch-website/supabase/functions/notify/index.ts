import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceClient } from "../_shared/adminSession.ts";
import { isValidEmail, sendCustomerEmail } from "../_shared/customerMessages.ts";
import { CONTACT_TYPE_LABELS } from "../_shared/outreach.ts";
import {
  createThreadFromMessage,
  hasBotToken,
  postChannelMessage,
} from "../_shared/discord.ts";
import {
  BUCKET,
  QUOTE_CONFIRMATION_SUBJECT,
  buildCardMessage,
  buildOrderHeaderMessage,
  buildWrapupMessage,
  customerPhotoPaths,
  deliveryLabels,
  loadContacts,
  loadOrder,
  loadOrderCards,
  signPhotoUrls,
  threadName,
  type CardRow,
  type ContactRow,
  type OrderRow,
} from "../_shared/discordOrderMessages.ts";

const CONTACT_EMAIL = "pokepatch.cards@gmail.com";
const CONTACT_INSTAGRAM = "@pokepatch.cards";
const CONTACT_DISCORD = "pokepatch.cards";
const MY_ORDERS_TRACK_URL =
  "https://pokepatch.cards/login?redirect=/my-orders";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

function extractFolderId(paths: string[]): string {
  if (paths.length === 0) return "";
  const first = paths[0];
  const slash = first.indexOf("/");
  return slash > 0 ? first.slice(0, slash) : "";
}

function isOrdersRecord(record: Record<string, unknown>): boolean {
  if (record.restoration_details != null) return false;
  return (
    record.customer_name != null ||
    record.display_id != null ||
    (typeof record.id === "string" && record.id.includes("-"))
  );
}

function isLegacyRecord(record: Record<string, unknown>): boolean {
  return record.restoration_details != null;
}

/** Channel the bot posts quote requests into. Empty → legacy webhook fallback. */
function quotesChannelId(): string {
  return (Deno.env.get("DISCORD_QUOTES_CHANNEL_ID") ?? "").trim();
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const record = (body.record ?? body) as Record<string, unknown>;

    if (isOrdersRecord(record)) {
      // Discord posts one message per card plus the email — longer than
      // the DB webhook waits. ACK now and finish in the background.
      EdgeRuntime.waitUntil(
        handleOrdersInsert(record).catch((err) => {
          console.error("notify: orders insert failed", err);
        })
      );
    } else if (isLegacyRecord(record)) {
      await handleLegacyInsert(record);
    } else {
      console.log("notify: unrecognized payload, skipping", record);
    }

    return new Response("ok");
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
});

async function handleLegacyInsert(record: Record<string, unknown>) {
  const id = (record.id as number | string | null) ?? "?";
  const delivery =
    deliveryLabels[String(record.delivery_method)] ??
    String(record.delivery_method ?? "unknown");
  const contact = String(record.contact ?? "").trim();
  const details = String(record.restoration_details ?? "").trim();
  const paths: string[] = Array.isArray(record.image_paths)
    ? (record.image_paths as string[])
    : [];

  await notifyDiscordLegacy({
    id,
    delivery,
    contact,
    details,
    photoCount: paths.length,
    folderId: extractFolderId(paths),
  });
}

async function handleOrdersInsert(record: Record<string, unknown>) {
  const orderUuid = String(record.id ?? "");
  const displayId = (record.display_id as number | string | null) ?? "?";
  const customerName = String(record.customer_name ?? "").trim();

  const supabase = getServiceClient();
  const contactsList = await loadContacts(supabase, orderUuid);

  const cards = await loadOrderCards(supabase, orderUuid);
  if (cards.length < 1) {
    console.log("notify: skipping order with no cards", orderUuid);
    return;
  }

  const cardIds = cards.map((card) => String(card.id));
  const photoPathsByCard = await customerPhotoPaths(supabase, cardIds);
  const paths = cardIds.flatMap((id) => photoPathsByCard.get(id) ?? []);

  // Admin "create order" seeds a blank card with no photos/contacts — don't
  // treat that like a customer submission.
  if (paths.length < 1 && contactsList.length < 1) {
    console.log("notify: skipping admin shell order", orderUuid);
    return;
  }

  // Discord: header → thread → one message per card → wrap-up.
  const order: OrderRow = (await loadOrder(supabase, orderUuid)) ?? {
    id: orderUuid,
    display_id: displayId,
    customer_name: customerName,
    customer_email: String(record.customer_email ?? "").trim() || null,
    user_id: (record.user_id as string | null) ?? null,
    delivery_method: String(record.delivery_method ?? ""),
    status: String(record.status ?? "pending"),
    pending_kind: (record.pending_kind as string | null) ?? null,
    quote_bulk_counts: null,
  };
  await notifyDiscordOrder({
    supabase,
    order,
    cards,
    photoPathsByCard,
    contacts: contactsList,
    contactsText: formatContacts(contactsList, "; "),
  });

  await sendQuoteConfirmationEmail({
    supabase,
    orderUuid,
    displayId,
    customerEmail: String(record.customer_email ?? "").trim(),
    userId: (record.user_id as string | null) ?? null,
    customerName,
  });
}

/**
 * Header in the quotes channel, then a thread off it holding one message per
 * card and a wrap-up last. Without a bot token (webhook only) threads can't be
 * created, so everything posts flat into the channel without buttons.
 */
async function notifyDiscordOrder(params: {
  supabase: SupabaseClient;
  order: OrderRow;
  cards: CardRow[];
  photoPathsByCard: Map<string, string[]>;
  contacts: ContactRow[];
  contactsText: string;
}) {
  const { supabase, order, cards, photoPathsByCard, contacts, contactsText } = params;
  const channelId = quotesChannelId();
  if (!channelId && !Deno.env.get("DISCORD_WEBHOOK_URL")) return;

  const photoCount = [...photoPathsByCard.values()].reduce(
    (sum, list) => sum + list.length,
    0
  );

  const header = await postChannelMessage(
    channelId,
    buildOrderHeaderMessage({
      order,
      cardCount: cards.length,
      photoCount,
      contactsText,
    })
  );
  if (!header) {
    console.error("notify: discord header post failed; skipping card messages");
    return;
  }

  const interactive = Boolean(channelId) && hasBotToken();
  const threadId = interactive
    ? await createThreadFromMessage(header.channel_id, header.id, threadName(order))
    : null;
  if (interactive && !threadId) {
    console.error("notify: thread create failed; posting cards in channel", order.id);
  }
  const target = threadId ?? header.channel_id;

  for (const [index, card] of cards.entries()) {
    const imageUrls = await signPhotoUrls(
      supabase,
      photoPathsByCard.get(String(card.id)) ?? []
    );
    const posted = await postChannelMessage(
      target,
      buildCardMessage({
        order,
        card,
        cardIndex: index,
        cardCount: cards.length,
        imageUrls,
        cardQuoteItems: [],
        hvAmount: 0,
        interactive,
      })
    );
    if (!posted) {
      console.error("notify: discord card post failed", order.id, card.id);
    }
  }

  const wrapup = await postChannelMessage(
    target,
    buildWrapupMessage({
      context: { order, cards, quoteItems: [], contacts, lastNotification: null },
      interactive,
    })
  );
  if (!wrapup) console.error("notify: discord wrap-up post failed", order.id);
}

function buildQuoteConfirmationBody(customerName: string): string {
  const greeting = customerName ? `Hi ${customerName},\n\n` : "";
  return (
    `${greeting}Thanks for submitting your restoration quote request to PokePatch! ` +
    `We've received your form successfully and will review your cards shortly.\n\n` +
    `We'll reach out to you soon with a quote, usually within 1 day.\n\n` +
    `Track your order online — create a free account or log in with this email ` +
    `to see updates and photos:\n` +
    `${MY_ORDERS_TRACK_URL}\n\n` +
    `In the meantime, contact us at:\n` +
    `- Email: ${CONTACT_EMAIL}\n` +
    `- Instagram: ${CONTACT_INSTAGRAM}\n` +
    `- Discord: ${CONTACT_DISCORD}`
  );
}

async function sendQuoteConfirmationEmail({
  supabase,
  orderUuid,
  displayId,
  customerEmail,
  userId,
  customerName,
}: {
  supabase: SupabaseClient;
  orderUuid: string;
  displayId: number | string;
  customerEmail: string;
  userId: string | null;
  customerName: string;
}): Promise<void> {
  const email = customerEmail.trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    console.log("quote confirmation: skipping — no valid customer_email");
    return;
  }

  const { data: existing, error: existingError } = await supabase
    .from("customer_messages")
    .select("id")
    .eq("order_id", orderUuid)
    .eq("subject", QUOTE_CONFIRMATION_SUBJECT)
    .in("email_status", ["pending", "sent"])
    .limit(1);
  if (existingError) {
    console.error("quote confirmation: idempotency check failed", existingError);
    return;
  }
  if ((existing?.length ?? 0) > 0) {
    console.log("quote confirmation: already sent for order", orderUuid);
    return;
  }

  const result = await sendCustomerEmail({
    supabase,
    orderId: orderUuid,
    orderDisplayId: displayId,
    to: email,
    userId,
    subject: QUOTE_CONFIRMATION_SUBJECT,
    body: buildQuoteConfirmationBody(customerName),
  });
  if (!result.ok) console.error("quote confirmation: send failed", result.error);
}

function formatContacts(
  contacts: { contact_type?: string | null; value?: string | null }[],
  separator: string
): string {
  return contacts
    .map((c) => {
      const label =
        CONTACT_TYPE_LABELS[String(c.contact_type ?? "")] ??
        String(c.contact_type ?? "Contact");
      const value = String(c.value ?? "").trim();
      return value ? `${label}: ${value}` : null;
    })
    .filter(Boolean)
    .join(separator);
}

async function notifyDiscordLegacy({
  id,
  delivery,
  contact,
  details,
  photoCount,
  folderId,
}: {
  id: number | string;
  delivery: string;
  contact: string;
  details: string;
  photoCount: number;
  folderId: string;
}) {
  const channelId = quotesChannelId();
  if (!channelId && !Deno.env.get("DISCORD_WEBHOOK_URL")) return;

  const safeDetails = details
    ? details.length > 1200
      ? `${details.slice(0, 1200)}… (see admin)`
      : details
    : "—";

  const lines = [
    `<<--<<-- **New Quote Request #${id}:** -->>-->>`,
    `- **Delivery Method:** ${delivery}`,
    `- **Photo Count:** ${photoCount} image${photoCount === 1 ? "" : "s"}`,
    `- **Contact:** ${contact || "—"}`,
    `- **Details:** ${safeDetails}`,
  ];
  if (folderId) {
    lines.push(`- **Storage folder:** \`${BUCKET}/${folderId}\``);
  }
  await postChannelMessage(channelId, {
    content: lines.join("\n").slice(0, 2000),
    allowed_mentions: { parse: [] },
  });
}

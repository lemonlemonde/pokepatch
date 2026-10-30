/**
 * Discord Interactions endpoint for "wooper" — upload before/after
 * restoration photos onto an order card in Supabase Storage.
 *
 * Flow: post images in chat → right-click message → Apps → wooper → modal
 * (order / card / side).
 *
 * Secrets: DISCORD_PUBLIC_KEY, DISCORD_ADMIN_USER_IDS
 * Injected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "card-photos";
const PENDING_PREFIX = "wooper-pending/";
const MAX_IMAGE_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Match admin MAX_ADMIN_PHOTOS_PER_CARD — per side (before or after). */
const MAX_PHOTOS_PER_SIDE = 20;
const IMMUTABLE_CACHE_CONTROL = "604800";
const EPHEMERAL = 1 << 6;

const SIDE_TYPES = new Set(["before", "after"]);

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

type DiscordAttachment = {
  id: string;
  filename: string;
  url: string;
  content_type?: string | null;
  contentType?: string | null;
  size?: number;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("invalid hex");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function verifyDiscordRequest(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  body: string
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["verify"]
    );
    const message = new TextEncoder().encode(timestamp + body);
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      hexToBytes(signatureHex),
      message
    );
  } catch {
    return false;
  }
}

function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("missing Supabase env");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function adminUserIds(): Set<string> {
  const raw = Deno.env.get("DISCORD_ADMIN_USER_IDS") ?? "";
  return new Set(
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  );
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function interactionUserId(interaction: Record<string, unknown>): string {
  const member = interaction.member as Record<string, unknown> | undefined;
  const user =
    (member?.user as Record<string, unknown> | undefined) ??
    (interaction.user as Record<string, unknown> | undefined);
  return String(user?.id ?? "");
}

function isAllowedUser(userId: string): boolean {
  const allowed = adminUserIds();
  return Boolean(userId) && allowed.size > 0 && allowed.has(userId);
}

function deniedResponse(): Response {
  return json({
    type: 4,
    data: {
      content: "You are not allowed to use this command.",
      flags: EPHEMERAL,
    },
  });
}

async function editOriginal(
  applicationId: string,
  token: string,
  content: string
): Promise<void> {
  const url =
    `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("discord edit failed", res.status, text);
  }
}

function modalFieldValue(
  components: Array<Record<string, unknown>> | undefined,
  customId: string
): string {
  for (const row of components ?? []) {
    const inner = (row.components ?? []) as Array<Record<string, unknown>>;
    for (const field of inner) {
      if (String(field.custom_id ?? "") === customId) {
        return String(field.value ?? "").trim();
      }
    }
  }
  return "";
}

function imageAttachmentsFromMessage(
  message: Record<string, unknown> | undefined
): DiscordAttachment[] {
  const raw = (message?.attachments ?? []) as DiscordAttachment[];
  return raw.filter((attachment) => {
    const type = String(
      attachment.content_type ?? attachment.contentType ?? ""
    ).toLowerCase();
    const name = String(attachment.filename ?? "").toLowerCase();
    if (type.startsWith("image/")) return true;
    if (!type && /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(name)) return true;
    return false;
  });
}

function wooperModal(pendingId: string, imageCount: number) {
  return {
    type: 9,
    data: {
      custom_id: `wooper:${pendingId}`,
      title: `Upload ${imageCount} photo(s)`,
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "order",
              label: "Order number",
              style: 1,
              placeholder: "e.g. 42",
              required: true,
              min_length: 1,
              max_length: 10,
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "card",
              label: "Card number in order",
              style: 1,
              placeholder: "1 = first card",
              required: true,
              min_length: 1,
              max_length: 4,
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: "side",
              label: "Side (before or after)",
              style: 1,
              placeholder: "before",
              required: true,
              min_length: 5,
              max_length: 6,
            },
          ],
        },
      ],
    },
  };
}

async function savePendingAttachments(
  files: DiscordAttachment[]
): Promise<string> {
  const pendingId = crypto.randomUUID();
  const supabase = getServiceClient();
  const path = `${PENDING_PREFIX}${pendingId}.json`;
  const payload = JSON.stringify({
    attachments: files.map((file) => ({
      id: file.id,
      filename: file.filename,
      url: file.url,
      content_type: file.content_type ?? file.contentType ?? null,
      size: file.size ?? null,
    })),
  });
  const { error } = await supabase.storage.from(BUCKET).upload(
    path,
    new TextEncoder().encode(payload),
    {
      upsert: false,
      contentType: "application/json",
      cacheControl: "60",
    }
  );
  if (error) throw error;
  return pendingId;
}

async function loadPendingAttachments(
  pendingId: string
): Promise<DiscordAttachment[]> {
  const supabase = getServiceClient();
  const path = `${PENDING_PREFIX}${pendingId}.json`;
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new Error("Upload session expired. Right-click the photos again.");
  }
  const text = await data.text();
  const parsed = JSON.parse(text) as { attachments?: DiscordAttachment[] };
  return parsed.attachments ?? [];
}

async function clearPending(pendingId: string): Promise<void> {
  const supabase = getServiceClient();
  await supabase.storage
    .from(BUCKET)
    .remove([`${PENDING_PREFIX}${pendingId}.json`])
    .catch(() => {});
}

async function uploadAttachments(params: {
  applicationId: string;
  token: string;
  orderDisplayId: number;
  cardIndex: number;
  side: string;
  files: DiscordAttachment[];
}): Promise<void> {
  const {
    applicationId,
    token,
    orderDisplayId,
    cardIndex,
    side,
    files,
  } = params;

  try {
    if (!Number.isFinite(orderDisplayId) || orderDisplayId <= 0) {
      await editOriginal(applicationId, token, "Invalid order number.");
      return;
    }
    if (
      !Number.isFinite(cardIndex) ||
      cardIndex < 1 ||
      !Number.isInteger(cardIndex)
    ) {
      await editOriginal(
        applicationId,
        token,
        "Card must be a 1-based index within the order (1, 2, 3…)."
      );
      return;
    }
    if (!SIDE_TYPES.has(side)) {
      await editOriginal(
        applicationId,
        token,
        "Side must be `before` or `after`."
      );
      return;
    }
    if (files.length === 0) {
      await editOriginal(applicationId, token, "No images found on that message.");
      return;
    }

    const supabase = getServiceClient();

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, display_id")
      .eq("display_id", orderDisplayId)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) {
      await editOriginal(
        applicationId,
        token,
        `Order #${orderDisplayId} not found.`
      );
      return;
    }

    const { data: cards, error: cardsError } = await supabase
      .from("cards")
      .select("id, card_name, sort_order")
      .eq("order_id", order.id)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (cardsError) throw cardsError;

    const card = (cards ?? [])[cardIndex - 1];
    if (!card) {
      await editOriginal(
        applicationId,
        token,
        `Order #${orderDisplayId} has ${cards?.length ?? 0} card(s); card ${cardIndex} is out of range.`
      );
      return;
    }

    const { count: existingCount, error: countError } = await supabase
      .from("card_images")
      .select("id", { count: "exact", head: true })
      .eq("card_id", card.id)
      .eq("image_type", side);
    if (countError) throw countError;

    let nextIndex = (existingCount ?? 0) + 1;
    if (nextIndex > MAX_PHOTOS_PER_SIDE) {
      await editOriginal(
        applicationId,
        token,
        `This card already has ${MAX_PHOTOS_PER_SIDE} ${side} photos (max).`
      );
      return;
    }

    let uploaded = 0;
    const errors: string[] = [];
    const slotsLeft = MAX_PHOTOS_PER_SIDE - (existingCount ?? 0);
    const toUpload = files.slice(0, slotsLeft);
    if (files.length > toUpload.length) {
      errors.push(
        `only ${slotsLeft} more ${side} slot(s) available (max ${MAX_PHOTOS_PER_SIDE}); skipped ${files.length - toUpload.length}`
      );
    }

    for (const attachment of toUpload) {
      const filename = attachment.filename || `photo-${nextIndex}.jpg`;
      try {
        const declaredType = String(
          attachment.content_type ?? attachment.contentType ?? ""
        );
        if (declaredType && !declaredType.startsWith("image/")) {
          errors.push(`${filename}: not an image`);
          continue;
        }
        if (
          typeof attachment.size === "number" &&
          attachment.size > MAX_IMAGE_UPLOAD_BYTES
        ) {
          errors.push(`${filename}: too large (max 15MB)`);
          continue;
        }

        const download = await fetch(attachment.url);
        if (!download.ok) {
          errors.push(`${filename}: download failed (${download.status})`);
          continue;
        }
        const bytes = new Uint8Array(await download.arrayBuffer());
        if (bytes.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
          errors.push(`${filename}: too large (max 15MB)`);
          continue;
        }

        const path =
          `order-${order.id}/card-${card.id}/${side}-${nextIndex}-${sanitizeFilename(filename)}`;
        const contentType =
          declaredType ||
          download.headers.get("content-type") ||
          "application/octet-stream";

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, bytes, {
            upsert: false,
            contentType,
            cacheControl: IMMUTABLE_CACHE_CONTROL,
          });
        if (uploadError) throw uploadError;

        const { error: insertError } = await supabase.from("card_images").insert({
          card_id: card.id,
          image_type: side,
          storage_path: path,
        });
        if (insertError) {
          await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
          throw insertError;
        }

        uploaded += 1;
        nextIndex += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${filename}: ${message}`);
      }
    }

    const cardLabel = (card.card_name || `Card ${cardIndex}`).trim();
    const lines = [
      uploaded > 0
        ? `Uploaded **${uploaded}** ${side} photo(s) → Order **#${orderDisplayId}** · ${cardLabel} (card ${cardIndex}).`
        : `No photos uploaded for Order **#${orderDisplayId}** · ${cardLabel}.`,
    ];
    if (errors.length > 0) {
      lines.push(`Issues: ${errors.join("; ")}`);
    }
    await editOriginal(applicationId, token, lines.join("\n"));
  } catch (err) {
    console.error("wooper failed", err);
    const message = err instanceof Error ? err.message : String(err);
    await editOriginal(applicationId, token, `Upload failed: ${message}`);
  }
}

async function handleModalSubmit(interaction: Record<string, unknown>) {
  const applicationId = String(interaction.application_id ?? "");
  const token = String(interaction.token ?? "");
  const data = (interaction.data ?? {}) as Record<string, unknown>;
  const customId = String(data.custom_id ?? "");
  const pendingId = customId.startsWith("wooper:")
    ? customId.slice("wooper:".length)
    : "";

  try {
    if (!pendingId) {
      await editOriginal(applicationId, token, "Invalid upload session.");
      return;
    }

    const orderDisplayId = Number(modalFieldValue(
      data.components as Array<Record<string, unknown>>,
      "order"
    ));
    const cardIndex = Number(modalFieldValue(
      data.components as Array<Record<string, unknown>>,
      "card"
    ));
    const side = modalFieldValue(
      data.components as Array<Record<string, unknown>>,
      "side"
    ).toLowerCase();

    const files = await loadPendingAttachments(pendingId);
    await clearPending(pendingId);

    await uploadAttachments({
      applicationId,
      token,
      orderDisplayId,
      cardIndex,
      side,
      files,
    });
  } catch (err) {
    console.error("wooper modal failed", err);
    const message = err instanceof Error ? err.message : String(err);
    await editOriginal(applicationId, token, `Upload failed: ${message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const publicKey = Deno.env.get("DISCORD_PUBLIC_KEY") ?? "";
  if (!publicKey) {
    console.error("DISCORD_PUBLIC_KEY not set");
    return new Response("Server misconfigured", { status: 500 });
  }

  const signature = req.headers.get("X-Signature-Ed25519") ?? "";
  const timestamp = req.headers.get("X-Signature-Timestamp") ?? "";
  const body = await req.text();

  const valid = await verifyDiscordRequest(
    publicKey,
    signature,
    timestamp,
    body
  );
  if (!valid) {
    return new Response("Invalid request signature", { status: 401 });
  }

  let interaction: Record<string, unknown>;
  try {
    interaction = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // PING
  if (interaction.type === 1) {
    return json({ type: 1 });
  }

  // APPLICATION_COMMAND
  if (interaction.type === 2) {
    if (!isAllowedUser(interactionUserId(interaction))) {
      return deniedResponse();
    }

    const data = (interaction.data ?? {}) as Record<string, unknown>;
    const commandName = String(data.name ?? "");
    const commandType = Number(data.type ?? 1);

    if (commandName !== "wooper") {
      return json({
        type: 4,
        data: {
          content: `Unknown command \`${commandName}\`.`,
          flags: EPHEMERAL,
        },
      });
    }

    // Message command (right-click message → Apps → wooper)
    if (commandType === 3) {
      const targetId = String(data.target_id ?? "");
      const resolved = (data.resolved ?? {}) as Record<string, unknown>;
      const messages = (resolved.messages ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const message = messages[targetId];
      const files = imageAttachmentsFromMessage(message);

      if (files.length === 0) {
        return json({
          type: 4,
          data: {
            content:
              "That message has no images. Attach photos in chat first, then right-click → Apps → wooper.",
            flags: EPHEMERAL,
          },
        });
      }

      try {
        const pendingId = await savePendingAttachments(files);
        return json(wooperModal(pendingId, files.length));
      } catch (err) {
        console.error("wooper pending save failed", err);
        return json({
          type: 4,
          data: {
            content: "Couldn't start upload. Try again.",
            flags: EPHEMERAL,
          },
        });
      }
    }

    // Legacy chat slash command — point people at the message flow.
    return json({
      type: 4,
      data: {
        content:
          "Post your photos in chat, then **right-click the message → Apps → wooper** and enter order / card / side.",
        flags: EPHEMERAL,
      },
    });
  }

  // MODAL_SUBMIT
  if (interaction.type === 5) {
    if (!isAllowedUser(interactionUserId(interaction))) {
      return deniedResponse();
    }

    const data = (interaction.data ?? {}) as Record<string, unknown>;
    if (!String(data.custom_id ?? "").startsWith("wooper:")) {
      return json({
        type: 4,
        data: { content: "Unknown form.", flags: EPHEMERAL },
      });
    }

    EdgeRuntime.waitUntil(
      handleModalSubmit(interaction).catch((err) => {
        console.error("wooper modal background failed", err);
      })
    );

    return json({
      type: 5,
      data: { flags: EPHEMERAL },
    });
  }

  return json({
    type: 4,
    data: { content: "Unsupported interaction.", flags: EPHEMERAL },
  });
});

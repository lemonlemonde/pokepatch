/**
 * Discord helpers shared by `notify` (posts quote-request messages),
 * `discord-interactions` (quotes app buttons/modals), `discord-photos`
 * (wooper app command/modals), and `discord-clamperl` (carousel PNG slash command).
 *
 * Quote posts use `DISCORD_QUOTES_BOT_TOKEN`, with `DISCORD_WEBHOOK_URL` as a
 * non-interactive fallback. Wooper / clamperl verify with their own public keys
 * and do not need the quotes bot token for interaction replies.
 */

const DISCORD_API = "https://discord.com/api/v10";

export const EPHEMERAL = 1 << 6;
export const IS_COMPONENTS_V2 = 1 << 15;

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  MODAL_SUBMIT: 5,
} as const;

export const CallbackType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  UPDATE_MESSAGE: 7,
  MODAL: 9,
} as const;

export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  TEXT_INPUT: 4,
  TEXT_DISPLAY: 10,
  MEDIA_GALLERY: 12,
  SEPARATOR: 14,
  CONTAINER: 17,
  LABEL: 18,
  CHECKBOX_GROUP: 22,
} as const;

export const ButtonStyle = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
} as const;

export const TextInputStyle = { SHORT: 1, PARAGRAPH: 2 } as const;

export type Interaction = Record<string, unknown>;
export type Json = Record<string, unknown>;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function ephemeralReply(content: string): Response {
  return json({
    type: CallbackType.CHANNEL_MESSAGE,
    data: { content, flags: EPHEMERAL },
  });
}

// ---------------------------------------------------------------------------
// Request verification + user gating

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

export async function verifyDiscordRequest(
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

export function interactionUserId(interaction: Interaction): string {
  const member = interaction.member as Json | undefined;
  const user =
    (member?.user as Json | undefined) ?? (interaction.user as Json | undefined);
  return String(user?.id ?? "");
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

export function isAllowedUser(userId: string): boolean {
  const allowed = adminUserIds();
  return Boolean(userId) && allowed.size > 0 && allowed.has(userId);
}

export function deniedResponse(): Response {
  return ephemeralReply("You are not allowed to use this command.");
}

/**
 * Shared Interactions entry: method check, Ed25519 verify, JSON parse, PING,
 * and admin allow-list. Callers handle the remaining interaction types.
 */
export async function openDiscordInteraction(
  req: Request,
  publicKeyEnv: string
): Promise<{ interaction: Interaction } | { response: Response }> {
  if (req.method !== "POST") {
    return { response: new Response("Method not allowed", { status: 405 }) };
  }

  const publicKey = Deno.env.get(publicKeyEnv) ?? "";
  if (!publicKey) {
    console.error(`${publicKeyEnv} not set`);
    return { response: new Response("Server misconfigured", { status: 500 }) };
  }

  const signature = req.headers.get("X-Signature-Ed25519") ?? "";
  const timestamp = req.headers.get("X-Signature-Timestamp") ?? "";
  const body = await req.text();

  if (!(await verifyDiscordRequest(publicKey, signature, timestamp, body))) {
    return { response: new Response("Invalid request signature", { status: 401 }) };
  }

  let interaction: Interaction;
  try {
    interaction = JSON.parse(body) as Interaction;
  } catch {
    return { response: new Response("Bad JSON", { status: 400 }) };
  }

  if (Number(interaction.type) === InteractionType.PING) {
    return { response: json({ type: CallbackType.PONG }) };
  }

  if (!isAllowedUser(interactionUserId(interaction))) {
    return { response: deniedResponse() };
  }

  return { interaction };
}

// ---------------------------------------------------------------------------
// REST

function botToken(): string {
  return (Deno.env.get("DISCORD_QUOTES_BOT_TOKEN") ?? "").trim();
}

export function hasBotToken(): boolean {
  return botToken().length > 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch against the Discord API with bot auth and 429 retry. Posting one
 * message per card trips the per-channel limit (~5 / 5s), so honour
 * `retry_after` instead of dropping cards.
 */
export async function discordRequest(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
  retries = 5
): Promise<Response> {
  const { auth = true, ...rest } = init;
  const headers = new Headers(rest.headers ?? {});
  // Let the runtime set multipart boundaries for FormData; only force JSON
  // when the body is an already-serialized string.
  if (
    !headers.has("Content-Type") &&
    rest.body &&
    typeof rest.body === "string"
  ) {
    headers.set("Content-Type", "application/json");
  }
  if (typeof FormData !== "undefined" && rest.body instanceof FormData) {
    headers.delete("Content-Type");
  }
  if (auth) {
    const token = botToken();
    if (!token) throw new Error("DISCORD_QUOTES_BOT_TOKEN not set");
    headers.set("Authorization", `Bot ${token}`);
  }
  const url = path.startsWith("http") ? path : `${DISCORD_API}${path}`;

  let attempt = 0;
  while (true) {
    const res = await fetch(url, { ...rest, headers });
    if (res.status !== 429 || attempt >= retries) return res;
    attempt += 1;
    let waitMs = 1000;
    try {
      const body = (await res.clone().json()) as { retry_after?: number };
      if (typeof body.retry_after === "number") {
        waitMs = Math.ceil(body.retry_after * 1000);
      }
    } catch {
      const header = Number(res.headers.get("Retry-After"));
      if (Number.isFinite(header) && header > 0) waitMs = Math.ceil(header * 1000);
    }
    await res.body?.cancel().catch(() => {});
    await sleep(Math.min(waitMs + 100, 15_000));
  }
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `${res.status} ${text.slice(0, 500)}`;
}

/** Strip interactive rows — webhooks may only send non-interactive components. */
function withoutInteractiveComponents(payload: Json): Json {
  const strip = (components: unknown): unknown => {
    if (!Array.isArray(components)) return components;
    return components
      .filter((component) => {
        const type = (component as Json)?.type;
        return type !== ComponentType.ACTION_ROW;
      })
      .map((component) => {
        const node = component as Json;
        if (Array.isArray(node.components)) {
          return { ...node, components: strip(node.components) };
        }
        return node;
      });
  };
  return { ...payload, components: strip(payload.components) };
}

/**
 * Post a message to the configured channel. Prefers the bot (`channelId`);
 * falls back to `DISCORD_WEBHOOK_URL`. Returns `{ id, channel_id }` or null.
 */
export async function postChannelMessage(
  channelId: string,
  payload: Json
): Promise<{ id: string; channel_id: string } | null> {
  if (channelId && hasBotToken()) {
    const res = await discordRequest(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("discord post failed", await readError(res));
      return null;
    }
    const data = (await res.json()) as { id: string; channel_id: string };
    return { id: data.id, channel_id: data.channel_id };
  }

  const webhook = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!webhook) return null;
  const url = new URL(webhook);
  url.searchParams.set("wait", "true");
  url.searchParams.set("with_components", "true");
  const res = await discordRequest(
    url.toString(),
    {
      method: "POST",
      auth: false,
      body: JSON.stringify(withoutInteractiveComponents(payload)),
    }
  );
  if (!res.ok) {
    console.error("discord webhook failed", await readError(res));
    return null;
  }
  const data = (await res.json()) as { id: string; channel_id: string };
  return { id: data.id, channel_id: data.channel_id };
}

export async function editChannelMessage(
  channelId: string,
  messageId: string,
  payload: Json
): Promise<boolean> {
  if (!hasBotToken()) return false;
  const res = await discordRequest(
    `/channels/${channelId}/messages/${messageId}`,
    { method: "PATCH", body: JSON.stringify(payload) }
  );
  if (!res.ok) {
    console.error("discord edit failed", await readError(res));
    return false;
  }
  return true;
}

/**
 * Start a public thread on a message. The thread id equals the message id.
 * Returns null without a bot (webhooks can't create threads here).
 */
export async function createThreadFromMessage(
  channelId: string,
  messageId: string,
  name: string
): Promise<string | null> {
  if (!hasBotToken()) return null;
  const res = await discordRequest(
    `/channels/${channelId}/messages/${messageId}/threads`,
    {
      method: "POST",
      body: JSON.stringify({
        name: name.slice(0, 100) || "Order",
        // 7 days of inactivity before it collapses from the channel list.
        auto_archive_duration: 10080,
      }),
    }
  );
  if (!res.ok) {
    console.error("discord thread create failed", await readError(res));
    return null;
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

/** Newest-first messages in a channel/thread (bot only). */
export async function listChannelMessages(
  channelId: string,
  limit = 25
): Promise<Json[]> {
  if (!hasBotToken()) return [];
  const res = await discordRequest(
    `/channels/${channelId}/messages?limit=${Math.min(Math.max(limit, 1), 100)}`
  );
  if (!res.ok) {
    console.error("discord list messages failed", await readError(res));
    return [];
  }
  return (await res.json()) as Json[];
}

/** Depth-first search for a button custom_id anywhere in a message's components. */
export function messageHasCustomId(message: Json, customId: string): boolean {
  const visit = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.some(visit);
    if (!node || typeof node !== "object") return false;
    const record = node as Json;
    if (record.custom_id === customId) return true;
    return visit(record.components) || visit(record.component) || visit(record.accessory);
  };
  return visit(message.components);
}

/** Edit the deferred interaction reply (`@original`). */
export async function editOriginal(
  applicationId: string,
  token: string,
  payload: Json | string
): Promise<void> {
  const body = typeof payload === "string" ? { content: payload } : payload;
  const res = await discordRequest(
    `/webhooks/${applicationId}/${token}/messages/@original`,
    { method: "PATCH", auth: false, body: JSON.stringify(body) }
  );
  if (!res.ok) {
    console.error("discord edit original failed", await readError(res));
  }
}

export type DiscordUploadFile = {
  filename: string;
  bytes: Uint8Array;
  contentType?: string;
};

function multipartWithFiles(payload: Json, files: DiscordUploadFile[]): FormData {
  const form = new FormData();
  const attachments = files.map((file, index) => ({
    id: index,
    filename: file.filename,
  }));
  form.append(
    "payload_json",
    JSON.stringify({
      ...payload,
      ...(files.length > 0 ? { attachments } : {}),
    })
  );
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    form.append(
      `files[${index}]`,
      new Blob([file.bytes], {
        type: file.contentType ?? "application/octet-stream",
      }),
      file.filename
    );
  }
  return form;
}

/**
 * Edit `@original` with file attachments (multipart). Discord serves the
 * uploaded bytes as-is on download — no recompression of the file itself.
 */
export async function editOriginalWithFiles(
  applicationId: string,
  token: string,
  payload: Json,
  files: DiscordUploadFile[]
): Promise<void> {
  if (files.length === 0) {
    await editOriginal(applicationId, token, payload);
    return;
  }

  const res = await discordRequest(
    `/webhooks/${applicationId}/${token}/messages/@original`,
    {
      method: "PATCH",
      auth: false,
      body: multipartWithFiles(payload, files),
    }
  );
  if (!res.ok) {
    console.error("discord edit original (files) failed", await readError(res));
  }
}

/** Post a follow-up message on an interaction webhook (with optional files). */
export async function followupWithFiles(
  applicationId: string,
  token: string,
  payload: Json,
  files: DiscordUploadFile[] = []
): Promise<void> {
  const res = await discordRequest(
    `/webhooks/${applicationId}/${token}`,
    {
      method: "POST",
      auth: false,
      body: multipartWithFiles(payload, files),
    }
  );
  if (!res.ok) {
    const detail = await readError(res);
    console.error("discord followup (files) failed", detail);
    throw new Error(`Discord follow-up failed: ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Modal submit parsing

export type ModalField = { value: string; values: string[] };

/**
 * Flatten modal submit components into custom_id → field. Handles both the
 * Label shape (`{ type: 18, component: {...} }`) and legacy Action Rows.
 */
export function collectModalFields(components: unknown): Map<string, ModalField> {
  const out = new Map<string, ModalField>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Json;
    if (typeof record.custom_id === "string" && ("value" in record || "values" in record)) {
      out.set(record.custom_id, {
        value: typeof record.value === "string" ? record.value.trim() : "",
        values: Array.isArray(record.values) ? record.values.map(String) : [],
      });
    }
    if (record.component) visit(record.component);
    if (record.components) visit(record.components);
  };
  visit(components);
  return out;
}

export function fieldValue(fields: Map<string, ModalField>, id: string): string {
  return fields.get(id)?.value ?? "";
}

export function fieldValues(fields: Map<string, ModalField>, id: string): string[] {
  return fields.get(id)?.values ?? [];
}

// ---------------------------------------------------------------------------
// Component builders (Components V2)

export function textDisplay(content: string): Json {
  return { type: ComponentType.TEXT_DISPLAY, content };
}

export function separator(spacing: 1 | 2 = 1, divider = true): Json {
  return { type: ComponentType.SEPARATOR, divider, spacing };
}

export function mediaGallery(urls: string[], descriptions: string[] = []): Json {
  return {
    type: ComponentType.MEDIA_GALLERY,
    items: urls.slice(0, 10).map((url, index) => ({
      media: { url },
      ...(descriptions[index] ? { description: descriptions[index] } : {}),
    })),
  };
}

export function container(components: Json[], accentColor?: number): Json {
  return {
    type: ComponentType.CONTAINER,
    ...(accentColor != null ? { accent_color: accentColor } : {}),
    components,
  };
}

export function actionRow(components: Json[]): Json {
  return { type: ComponentType.ACTION_ROW, components };
}

export function button(params: {
  customId?: string;
  label: string;
  style?: number;
  url?: string;
  emoji?: string;
  disabled?: boolean;
}): Json {
  const { customId, label, style = ButtonStyle.PRIMARY, url, emoji, disabled } = params;
  return {
    type: ComponentType.BUTTON,
    style: url ? ButtonStyle.LINK : style,
    label,
    ...(url ? { url } : { custom_id: customId }),
    ...(emoji ? { emoji: { name: emoji } } : {}),
    ...(disabled ? { disabled: true } : {}),
  };
}

export function labeled(label: string, component: Json, description?: string): Json {
  return {
    type: ComponentType.LABEL,
    label: label.slice(0, 45),
    ...(description ? { description: description.slice(0, 100) } : {}),
    component,
  };
}

export function textInput(params: {
  customId: string;
  style?: number;
  required?: boolean;
  placeholder?: string;
  value?: string;
  maxLength?: number;
}): Json {
  const {
    customId,
    style = TextInputStyle.SHORT,
    required = false,
    placeholder,
    value,
    maxLength,
  } = params;
  return {
    type: ComponentType.TEXT_INPUT,
    custom_id: customId,
    style,
    required,
    ...(placeholder ? { placeholder: placeholder.slice(0, 100) } : {}),
    ...(value ? { value: value.slice(0, maxLength ?? 4000) } : {}),
    ...(maxLength ? { max_length: maxLength } : {}),
  };
}

export function checkboxGroup(params: {
  customId: string;
  options: { value: string; label: string; description?: string; default?: boolean }[];
  required?: boolean;
}): Json {
  const { customId, options, required = false } = params;
  return {
    type: ComponentType.CHECKBOX_GROUP,
    custom_id: customId,
    required,
    min_values: 0,
    max_values: options.length,
    options: options.slice(0, 10).map((option) => ({
      value: option.value,
      label: option.label.slice(0, 100),
      ...(option.description ? { description: option.description.slice(0, 100) } : {}),
      ...(option.default ? { default: true } : {}),
    })),
  };
}

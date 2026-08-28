import {
  adminDeletePhoto,
  adminGetOrder,
  adminSaveOrder,
  adminSendMessages,
  adminUploadPhoto,
} from "@/lib/adminApi";
import { compressImageForUpload, makeThumbForUpload } from "@/lib/imageCompression";
import { buildCardThumbById } from "@/lib/orderChangelog";
import { draftPayload } from "@/lib/adminOrderDraft";

/**
 * Save a full order draft (pending photo uploads + staged photo deletes) and
 * return the refreshed order from the server.
 */
export async function saveAdminOrderDraft(orderId, draft, { notify = false, subject = "", body = "", changelog = null } = {}) {
  const pendingUploads = (draft.cards ?? [])
    .map((card) => ({
      cardId: card.id,
      files: card.pending_files ?? [],
    }))
    .filter((entry) => entry.files.length > 0);

  const pendingDeletes = [];
  const seenDeleteIds = new Set();
  for (const card of draft.cards ?? []) {
    for (const imageId of card.pending_image_deletes ?? []) {
      const key = String(imageId);
      if (seenDeleteIds.has(key)) continue;
      seenDeleteIds.add(key);
      pendingDeletes.push(imageId);
    }
  }

  const emailThumbs = buildCardThumbById(draft.cards);
  const payload = draftPayload(draft);
  let refreshed = await adminSaveOrder(orderId, payload);

  for (const imageId of pendingDeletes) {
    try {
      await adminDeletePhoto(orderId, imageId);
    } catch (err) {
      // Idempotent: already gone after a prior partial save retry.
      if (!/photo not found/i.test(String(err?.message ?? ""))) throw err;
    }
  }

  for (const { cardId, files } of pendingUploads) {
    for (const entry of files) {
      const { file: uploadFile, error: compressError } =
        await compressImageForUpload(entry.file);
      if (compressError || !uploadFile) {
        throw new Error(compressError || "Couldn't process this image.");
      }
      const { file: thumb } = await makeThumbForUpload(uploadFile);
      await adminUploadPhoto(orderId, cardId, "customer", uploadFile, { thumb });
    }
  }

  if (pendingUploads.length > 0 || pendingDeletes.length > 0) {
    refreshed = await adminGetOrder(orderId);
  }

  let notifyError = null;
  if (notify && subject.trim() && (body.trim() || changelog)) {
    try {
      const result = await adminSendMessages({
        order_ids: [orderId],
        subject: subject.trim(),
        body,
        changelog,
        thumb_by_card_id: emailThumbs,
      });
      if ((result.failed ?? 0) > 0) {
        const firstError = Array.isArray(result.results)
          ? result.results.find((row) => row.email_status === "failed")
              ?.email_error
          : null;
        notifyError =
          firstError ||
          "Order saved, but the customer notification failed to send.";
      }
    } catch (err) {
      notifyError =
        err.message ||
        "Order saved, but the customer notification failed to send.";
    }
  }

  return { order: refreshed, notifyError };
}

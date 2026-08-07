import {
  adminGetOrder,
  adminSaveOrder,
  adminSendMessages,
  adminUploadPhoto,
} from "@/lib/adminApi";
import { compressImageForUpload, makeThumbForUpload } from "@/lib/imageCompression";
import { buildCardThumbById } from "@/lib/orderChangelog";
import { draftPayload } from "@/lib/adminOrderDraft";

/**
 * Save a full order draft (including pending photo uploads) and return the
 * refreshed order from the server.
 */
export async function saveAdminOrderDraft(orderId, draft, { notify = false, subject = "", body = "", changelog = null } = {}) {
  const pendingUploads = (draft.cards ?? [])
    .map((card) => ({
      cardId: card.id,
      files: card.pending_files ?? [],
    }))
    .filter((entry) => entry.files.length > 0);

  const emailThumbs = buildCardThumbById(draft.cards);
  const payload = draftPayload(draft);
  let refreshed = await adminSaveOrder(orderId, payload);

  for (const { cardId, files } of pendingUploads) {
    for (const entry of files) {
      const { file: uploadFile, error: compressError } =
        await compressImageForUpload(entry.file);
      if (compressError || !uploadFile) {
        throw new Error(compressError || "Couldn't process this image.");
      }
      const { file: thumb } = await makeThumbForUpload(uploadFile);
      await adminUploadPhoto(orderId, cardId, "admin", uploadFile, { thumb });
    }
  }

  if (pendingUploads.length > 0) {
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

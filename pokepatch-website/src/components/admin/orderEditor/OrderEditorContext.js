"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { buildOrderChangelog } from "@/lib/orderChangelog";
import {
  applyAutoOrderStatusFromCards,
  applyAutoPendingDropoff,
  draftPayload,
  draftPayloadForSavePreview,
  orderToDraft,
  validateDraftForSave,
} from "@/lib/adminOrderDraft";
import { saveAdminOrderDraft } from "@/lib/adminOrderSave";
import { normalizeOrderStatus, normalizePendingKind } from "@/lib/orderStatus";

const OrderEditorContext = createContext(null);

/** Convert once so draft and baseline share any client-minted ids. */
function seedEditorDrafts(order) {
  const draft = orderToDraft(order);
  return {
    draft,
    savedDraft: JSON.parse(JSON.stringify(draft)),
  };
}

/**
 * One shared draft for the whole order editor. The provider is keyed by
 * orderId in the shell, so switching orders remounts and re-seeds the draft;
 * saves re-seed explicitly from the refreshed server order.
 */
export function OrderEditorProvider({
  order,
  orderId,
  onOrderUpdated,
  onDirtyChange,
  children,
}) {
  const [seed] = useState(() => seedEditorDrafts(order));
  const [draft, setDraft] = useState(seed.draft);
  const [savedDraft, setSavedDraft] = useState(seed.savedDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savePromptOpen, setSavePromptOpen] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedDraft),
    [draft, savedDraft]
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const updateDraft = useCallback((patchOrFn) => {
    setDraft((current) => {
      const next =
        typeof patchOrFn === "function"
          ? patchOrFn(current)
          : { ...current, ...patchOrFn };
      const pendingKindOnly =
        typeof patchOrFn !== "function" &&
        Object.keys(patchOrFn).length === 1 &&
        Object.prototype.hasOwnProperty.call(patchOrFn, "pending_kind");
      if (pendingKindOnly) return next;

      // If the admin changed order status this edit, skip card→status auto-advance
      // (same rule as update_order's v_order_status_manually_set).
      const statusTouched =
        normalizeOrderStatus(current.status) !==
          normalizeOrderStatus(next.status) ||
        (normalizeOrderStatus(next.status) === "pending" &&
          normalizePendingKind(current.pending_kind) !==
            normalizePendingKind(next.pending_kind));

      let result = applyAutoPendingDropoff(next);
      if (!statusTouched) {
        result = applyAutoOrderStatusFromCards(result);
      }
      return result;
    });
  }, []);

  /**
   * Apply a server-confirmed change (e.g. a photo delete that already hit the
   * API) to both the draft and the saved baseline, preserving unsaved edits
   * without marking the order dirty.
   */
  const applyServerPatch = useCallback((updater) => {
    setDraft((current) => updater(current));
    setSavedDraft((current) => updater(current));
  }, []);

  const discardChanges = useCallback(() => {
    setDraft(JSON.parse(JSON.stringify(savedDraft)));
    setError("");
  }, [savedDraft]);

  const beforePayload = useMemo(() => draftPayload(savedDraft), [savedDraft]);
  const afterPayload = useMemo(
    () => draftPayloadForSavePreview(draft, savedDraft),
    [draft, savedDraft]
  );

  const performSave = useCallback(
    async ({ notify = false, subject = "", body = "", changelog = null } = {}) => {
      const validationError = validateDraftForSave(draft);
      if (validationError) {
        setError(validationError);
        setSavePromptOpen(false);
        return { ok: false, notifyError: null };
      }

      setSaving(true);
      setError("");
      setSavePromptOpen(false);
      try {
        const { order: refreshed, notifyError } = await saveAdminOrderDraft(
          orderId,
          draft,
          { notify, subject, body, changelog }
        );
        onOrderUpdated(refreshed);
        const next = orderToDraft(refreshed);
        setDraft(next);
        setSavedDraft(next);
        return { ok: true, notifyError };
      } catch (err) {
        setError(err.message || "Save failed.");
        return { ok: false, notifyError: null };
      } finally {
        setSaving(false);
      }
    },
    [draft, orderId, onOrderUpdated]
  );

  const requestSave = useCallback(() => {
    const validationError = validateDraftForSave(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    const { hasChangelog } = buildOrderChangelog({
      beforePayload,
      afterPayload,
    });
    if (!hasChangelog) {
      void performSave({ notify: false });
      return;
    }
    setSavePromptOpen(true);
  }, [afterPayload, beforePayload, draft, performSave]);

  const value = {
    draft,
    updateDraft,
    applyServerPatch,
    dirty,
    saving,
    error,
    setError,
    discardChanges,
    requestSave,
    performSave,
    savePromptOpen,
    setSavePromptOpen,
    beforePayload,
    afterPayload,
    orderId,
    order,
    onOrderUpdated,
  };

  return (
    <OrderEditorContext.Provider value={value}>
      {children}
    </OrderEditorContext.Provider>
  );
}

export function useOrderEditor() {
  const context = useContext(OrderEditorContext);
  if (!context) {
    throw new Error("useOrderEditor must be used within OrderEditorProvider");
  }
  return context;
}

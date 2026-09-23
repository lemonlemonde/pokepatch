"use client";

import { useEffect, useMemo, useState } from "react";
import { useOrderEditor } from "@/components/admin/orderEditor/OrderEditorContext";
import { EditorLabel, Panel } from "@/components/admin/orderEditor/editorUi";
import {
  adminGetOrderContract,
  adminPrepareOrderContract,
  adminSendMessages,
} from "@/lib/adminApi";
import {
  buildContractPrefillFromDraft,
  buildOrderContractPdf,
  defaultContractNotifyBody,
  formatContractDate,
  formatExactMoneyAmount,
  DEFAULT_CONTRACT_NOTIFY_SUBJECT,
} from "@/lib/orderContractPdf";

function moneyLabel(value) {
  const formatted = formatExactMoneyAmount(value);
  return formatted ? `$${formatted}` : "—";
}

export default function ContractPanel({ orderId, displayId }) {
  const { draft } = useOrderEditor();
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Always mirrors the live order draft — no local edits.
  const preview = useMemo(
    () => buildContractPrefillFromDraft(draft),
    [draft]
  );

  useEffect(() => {
    if (!orderId) return undefined;
    let cancelled = false;
    adminGetOrderContract(orderId)
      .then((result) => {
        if (cancelled) return;
        setContract(result.contract);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Failed to load contract");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const statusLabel = useMemo(() => {
    if (!contract) return "Not prepared";
    if (contract.status === "signed") return "Signed";
    return "Ready for customer";
  }, [contract]);

  async function handleDownload() {
    setBusy(true);
    setError("");
    // Open synchronously so the browser allows the tab after awaits.
    const popup = window.open("about:blank", "_blank");
    try {
      const payload = buildContractPrefillFromDraft(draft);
      const bytes = await buildOrderContractPdf(payload);
      const file = new File([bytes], "agreement.pdf", {
        type: "application/pdf",
      });
      const result = await adminPrepareOrderContract(orderId, payload, file);
      setContract(result.contract);
      const url = result.unsigned_url;
      if (!url) {
        popup?.close();
        setError("Prepared PDF but no download URL was returned.");
        return;
      }
      if (popup) {
        popup.location.href = url;
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      popup?.close();
      setError(err.message || "Failed to prepare contract");
    } finally {
      setBusy(false);
    }
  }

  async function handleNotify() {
    if (!draft.customer_email?.trim()) {
      setError("Order has no customer email.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await adminSendMessages({
        order_ids: [orderId],
        subject: DEFAULT_CONTRACT_NOTIFY_SUBJECT,
        body: defaultContractNotifyBody(displayId),
      });
    } catch (err) {
      setError(err.message || "Failed to notify customer");
    } finally {
      setBusy(false);
    }
  }

  const cards = preview.cards ?? [];

  return (
    <Panel
      title="Contract"
      tone="internal"
      action={
        <span className="rounded-full border border-ink/15 bg-night/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/70">
          {loading ? "…" : statusLabel}
        </span>
      }
    >
      <div className="space-y-2.5">
        {error ? (
          <p className="rounded-md border border-error/35 bg-error/10 px-2.5 py-1.5 text-xs text-error">
            {error}
          </p>
        ) : null}

        <div className="space-y-1 text-sm text-ink/80">
          <div className="flex justify-between gap-2">
            <EditorLabel className="mb-0">Date</EditorLabel>
            <span className="text-right font-medium text-ink">
              {formatContractDate()}
            </span>
          </div>
        </div>

        <div>
          <EditorLabel>Cards</EditorLabel>
          {cards.length === 0 ? (
            <p className="text-xs text-ink/45">No active cards on this order.</p>
          ) : (
            <ul className="divide-y divide-ink/10 overflow-hidden rounded-md border border-ink/10">
              {cards.map((row) => (
                <li key={row.id} className="bg-night/25 px-2 py-1.5">
                  <p className="text-sm font-medium text-ink">
                    {row.card_name || "Untitled card"}
                  </p>
                  {row.set_name ? (
                    <p className="text-[11px] text-ink/50">{row.set_name}</p>
                  ) : null}
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink/65">
                    <span>Fee {moneyLabel(row.restoration_fee)}</span>
                    <span>NM {moneyLabel(row.market_value_raw_nm)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 border-t border-ink/10 pt-2.5">
          <button
            type="button"
            disabled={busy || loading || cards.length === 0}
            onClick={handleDownload}
            className="rounded-md bg-ink px-2.5 py-1 text-xs font-bold text-night transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Working…" : "Download PDF"}
          </button>
          <button
            type="button"
            disabled={
              busy || loading || !contract || !draft.customer_email?.trim()
            }
            onClick={handleNotify}
            className="rounded-md border border-ink/15 px-2.5 py-1 text-xs font-semibold text-ink/80 transition hover:border-ink/30 hover:text-ink disabled:opacity-40"
          >
            Notify customer
          </button>
        </div>
      </div>
    </Panel>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useOrderEditor } from "@/components/admin/orderEditor/OrderEditorContext";
import {
  EditorLabel,
  GhostButton,
  Panel,
  RemoveButton,
  editorFieldClass,
} from "@/components/admin/orderEditor/editorUi";
import {
  adminGetOrderContract,
  adminPrepareOrderContract,
  adminSendMessages,
} from "@/lib/adminApi";
import {
  buildContractPrefillFromDraft,
  buildOrderContractPdf,
  defaultContractNotifyBody,
  DEFAULT_CONTRACT_NOTIFY_SUBJECT,
} from "@/lib/orderContractPdf";

function emptyCardRow() {
  return {
    id: `new-${crypto.randomUUID()}`,
    card_name: "",
    set_name: "",
    restoration_fee: "",
    market_value_raw_nm: "",
  };
}

function moneyInputValue(value) {
  if (value === "" || value == null) return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : "";
}

function parseMoneyInput(raw) {
  const trimmed = String(raw ?? "").trim().replace(/^\$/, "");
  if (!trimmed) return "";
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : "";
}

export default function ContractPanel({ orderId, displayId }) {
  const { draft } = useOrderEditor();
  const [payload, setPayload] = useState(() =>
    buildContractPrefillFromDraft(draft)
  );
  const [contract, setContract] = useState(null);
  const [unsignedUrl, setUnsignedUrl] = useState(null);
  const [signedUrl, setSignedUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!orderId) return undefined;
    let cancelled = false;
    adminGetOrderContract(orderId)
      .then((result) => {
        if (cancelled) return;
        setContract(result.contract);
        setUnsignedUrl(result.unsigned_url ?? null);
        setSignedUrl(result.signed_url ?? null);
        if (result.contract?.payload) {
          setPayload({
            customer_name: result.contract.payload.customer_name ?? "",
            representative_name:
              result.contract.payload.representative_name ?? "",
            cards: Array.isArray(result.contract.payload.cards)
              ? result.contract.payload.cards.map((row) => ({
                  id: row.id || `row-${crypto.randomUUID()}`,
                  card_name: row.card_name ?? "",
                  set_name: row.set_name ?? "",
                  restoration_fee: row.restoration_fee ?? "",
                  market_value_raw_nm: row.market_value_raw_nm ?? "",
                }))
              : [],
          });
        }
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

  function handlePrefill() {
    setPayload(buildContractPrefillFromDraft(draft));
    setError("");
  }

  function updateCard(id, patch) {
    setPayload((prev) => ({
      ...prev,
      cards: (prev.cards ?? []).map((row) =>
        row.id === id ? { ...row, ...patch } : row
      ),
    }));
  }

  async function handlePrepare() {
    setBusy(true);
    setError("");
    try {
      const cleanPayload = {
        customer_name: String(payload.customer_name ?? "").trim(),
        representative_name: String(payload.representative_name ?? "").trim(),
        cards: (payload.cards ?? []).map((row) => ({
          id: row.id,
          card_name: String(row.card_name ?? "").trim(),
          set_name: String(row.set_name ?? "").trim(),
          restoration_fee: parseMoneyInput(row.restoration_fee),
          market_value_raw_nm: parseMoneyInput(row.market_value_raw_nm),
        })),
      };
      const bytes = await buildOrderContractPdf(cleanPayload);
      const file = new File([bytes], "agreement.pdf", {
        type: "application/pdf",
      });
      const result = await adminPrepareOrderContract(orderId, cleanPayload, file);
      setContract(result.contract);
      setUnsignedUrl(result.unsigned_url ?? null);
      setSignedUrl(result.signed_url ?? null);
    } catch (err) {
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

  return (
    <Panel title="Contract" tone="internal">
      <div className="space-y-3 px-4 pb-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink/55">
            Optional liability agreement. Prefill from the order, edit, then
            prepare a PDF for the customer to download, sign, and upload.
          </p>
          <span className="rounded-full border border-ink/15 bg-night/40 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/70">
            {loading ? "…" : statusLabel}
          </span>
        </div>

        {error ? (
          <p className="rounded-lg border border-error/35 bg-error/10 px-3 py-2 text-xs text-error">
            {error}
          </p>
        ) : null}

        <label className="block">
          <EditorLabel>Customer name</EditorLabel>
          <input
            className={editorFieldClass()}
            value={payload.customer_name}
            disabled={busy || loading}
            onChange={(event) =>
              setPayload((prev) => ({
                ...prev,
                customer_name: event.target.value,
              }))
            }
          />
        </label>

        <label className="block">
          <EditorLabel>PokéPatch representative</EditorLabel>
          <input
            className={editorFieldClass()}
            value={payload.representative_name}
            disabled={busy || loading}
            placeholder="Your name"
            onChange={(event) =>
              setPayload((prev) => ({
                ...prev,
                representative_name: event.target.value,
              }))
            }
          />
        </label>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <EditorLabel className="mb-0">Cards</EditorLabel>
            <GhostButton
              disabled={busy || loading}
              onClick={() =>
                setPayload((prev) => ({
                  ...prev,
                  cards: [...(prev.cards ?? []), emptyCardRow()],
                }))
              }
            >
              + Row
            </GhostButton>
          </div>

          {(payload.cards ?? []).length === 0 ? (
            <p className="text-xs text-ink/45">No cards. Prefill or add a row.</p>
          ) : (
            <div className="space-y-2">
              {(payload.cards ?? []).map((row) => (
                <div
                  key={row.id}
                  className="space-y-1.5 rounded-lg border border-ink/10 bg-night/25 p-2"
                >
                  <div className="flex items-start gap-1.5">
                    <input
                      className={editorFieldClass()}
                      placeholder="Card name"
                      value={row.card_name}
                      disabled={busy || loading}
                      onChange={(event) =>
                        updateCard(row.id, { card_name: event.target.value })
                      }
                    />
                    <RemoveButton
                      disabled={busy || loading}
                      onClick={() =>
                        setPayload((prev) => ({
                          ...prev,
                          cards: (prev.cards ?? []).filter(
                            (c) => c.id !== row.id
                          ),
                        }))
                      }
                    />
                  </div>
                  <input
                    className={editorFieldClass()}
                    placeholder="Set / expansion"
                    value={row.set_name}
                    disabled={busy || loading}
                    onChange={(event) =>
                      updateCard(row.id, { set_name: event.target.value })
                    }
                  />
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="block">
                      <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink/40">
                        Fee
                      </span>
                      <input
                        className={editorFieldClass()}
                        inputMode="decimal"
                        placeholder="0"
                        value={moneyInputValue(row.restoration_fee)}
                        disabled={busy || loading}
                        onChange={(event) =>
                          updateCard(row.id, {
                            restoration_fee: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink/40">
                        NM raw
                      </span>
                      <input
                        className={editorFieldClass()}
                        inputMode="decimal"
                        placeholder="0"
                        value={moneyInputValue(row.market_value_raw_nm)}
                        disabled={busy || loading}
                        onChange={(event) =>
                          updateCard(row.id, {
                            market_value_raw_nm: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-ink/10 pt-3">
          <button
            type="button"
            disabled={busy || loading}
            onClick={handlePrefill}
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/80 transition hover:border-ink/30 hover:text-ink disabled:opacity-40"
          >
            Prefill from order
          </button>
          <button
            type="button"
            disabled={busy || loading}
            onClick={handlePrepare}
            className="rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-night transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Working…" : contract ? "Update PDF" : "Prepare PDF"}
          </button>
          {unsignedUrl ? (
            <a
              href={unsignedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/80 transition hover:border-ink/30 hover:text-ink"
            >
              Download PDF
            </a>
          ) : null}
          {signedUrl ? (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-status-green/30 bg-status-green/10 px-3 py-1.5 text-xs font-semibold text-status-green transition hover:brightness-110"
            >
              Signed PDF
            </a>
          ) : null}
          <button
            type="button"
            disabled={
              busy || loading || !contract || !draft.customer_email?.trim()
            }
            onClick={handleNotify}
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/80 transition hover:border-ink/30 hover:text-ink disabled:opacity-40"
          >
            Notify customer
          </button>
        </div>
      </div>
    </Panel>
  );
}

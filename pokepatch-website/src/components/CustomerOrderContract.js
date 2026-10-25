"use client";

import { useEffect, useRef, useState } from "react";
import SignaturePad from "@/components/SignaturePad";
import {
  ACKNOWLEDGMENT_PARAS,
  AGREEMENT_DAMAGE_CHOICES,
  AGREEMENT_PARAS,
  AGREEMENT_TAIL,
  CONTRACT_AGREEMENT_INTRO,
  DAMAGES,
  ORDER_CONTRACTS_BUCKET,
  POKEPATCH_REPRESENTATIVE_NAME,
  RESULTS_AND_ALTERATION_PARAS,
  buildOrderContractPdf,
  formatContractDate,
  formatExactMoneyAmount,
  signedContractPath,
} from "@/lib/orderContractPdf";
import { supabase } from "@/lib/supabaseClient";

const SIGNED_URL_EXPIRES_IN = 60 * 60;

const PARA_CLS = "text-[13px] leading-relaxed sm:text-sm";
const SECTION_TITLE_CLS =
  "border-b border-night/15 pb-1 text-[11px] font-bold uppercase tracking-wide text-night/80";

function moneyLabel(value) {
  if (value === "" || value == null) return "—";
  const formatted = formatExactMoneyAmount(value);
  return formatted ? `$${formatted}` : "—";
}

function CardRows({ cards }) {
  if (cards.length === 0) {
    return <p className={`mt-2 ${PARA_CLS} text-night/55`}>No cards listed.</p>;
  }
  return (
    <ul className="mt-2 divide-y divide-night/10 rounded-md border border-night/10">
      {cards.map((row, index) => (
        <li
          key={row?.id ?? `card-${index}`}
          className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-3 py-2 text-[13px]"
        >
          <p className="font-medium text-night">
            {String(row?.card_name ?? "").trim() || "Untitled card"}
          </p>
          <p className="text-right tabular-nums text-night">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-night/50">
              Fee
            </span>{" "}
            {moneyLabel(row?.restoration_fee)}
          </p>
          <p className="text-night/60">
            {String(row?.set_name ?? "").trim() || "—"}
          </p>
          <p className="text-right tabular-nums text-night">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-night/50">
              NM value
            </span>{" "}
            {moneyLabel(row?.market_value_raw_nm)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Paragraphs({ items, prefix }) {
  return items.map((text, i) => (
    <p key={`${prefix}-${i}`} className={PARA_CLS}>
      {text}
    </p>
  ));
}

function AgreementBody({ payload }) {
  const cards = Array.isArray(payload?.cards) ? payload.cards : [];
  const repName =
    String(payload?.representative_name ?? "").trim() ||
    POKEPATCH_REPRESENTATIVE_NAME;
  const agreementDate =
    String(payload?.agreement_date ?? "").trim() || formatContractDate();

  return (
    <div className="space-y-5 text-night">
      <div>
        <p className="text-lg font-bold tracking-wide">POKÉPATCH</p>
        <p className="mt-0.5 text-xs font-semibold text-night/65 sm:text-sm">
          Pokémon Card Restoration — Customer Property &amp; Liability
          Agreement
        </p>
        <p className={`mt-3 ${PARA_CLS}`}>{CONTRACT_AGREEMENT_INTRO}</p>
      </div>

      <section>
        <h3 className={SECTION_TITLE_CLS}>Restoration order</h3>
        <CardRows cards={cards} />
      </section>

      <section className="space-y-2.5">
        <h3 className={SECTION_TITLE_CLS}>Agreement</h3>
        <Paragraphs items={AGREEMENT_PARAS} prefix="agreement" />
        <ul className={`space-y-1.5 pl-3 ${PARA_CLS}`}>
          {AGREEMENT_DAMAGE_CHOICES.map((choice, i) => (
            <li key={`damage-choice-${i}`}>{choice}</li>
          ))}
        </ul>
        <p className={PARA_CLS}>Covered damage includes:</p>
        <ul className={`list-disc space-y-0.5 pl-6 ${PARA_CLS}`}>
          {DAMAGES.map((item, i) => (
            <li key={`damage-${i}`}>{item}</li>
          ))}
        </ul>
        <Paragraphs items={AGREEMENT_TAIL} prefix="agreement-tail" />
      </section>

      <section className="space-y-2.5">
        <h3 className={SECTION_TITLE_CLS}>
          Restoration results &amp; alteration risk
        </h3>
        <Paragraphs items={RESULTS_AND_ALTERATION_PARAS} prefix="results" />
      </section>

      <section className="space-y-2.5">
        <h3 className={SECTION_TITLE_CLS}>Acknowledgment &amp; signatures</h3>
        <Paragraphs items={ACKNOWLEDGMENT_PARAS} prefix="ack" />
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1 text-[13px]">
          <span className="text-night/55">PokéPatch</span>
          <span className="font-medium">{repName}</span>
          <span className="text-night/55">Date</span>
          <span className="font-medium">{agreementDate}</span>
        </div>
      </section>
    </div>
  );
}

export default function CustomerOrderContract({ orderId }) {
  const [contract, setContract] = useState(null);
  const [signedUrl, setSignedUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const padRef = useRef(null);

  useEffect(() => {
    if (!orderId || !supabase) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const { data, error: loadError } = await supabase
          .from("order_contracts")
          .select(
            "order_id, status, payload, unsigned_path, signed_path, signed_at, notified_at"
          )
          .eq("order_id", orderId)
          .maybeSingle();
        if (cancelled) return;
        if (loadError) throw loadError;
        setContract(data);

        let nextSigned = null;
        if (data?.signed_path) {
          const { data: signed, error: signError } = await supabase.storage
            .from(ORDER_CONTRACTS_BUCKET)
            .createSignedUrl(data.signed_path, SIGNED_URL_EXPIRES_IN);
          if (signError) throw signError;
          nextSigned = signed?.signedUrl ?? null;
        }
        if (cancelled) return;
        setSignedUrl(nextSigned);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setContract(null);
        setSignedUrl(null);
        setError(err.message || "Failed to load agreement");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId, reloadToken]);

  async function handleSignSubmit(event) {
    event.preventDefault();
    if (!supabase || !orderId || !contract?.payload) return;

    const name = customerName.trim();
    if (!name) {
      setError("Type your full name.");
      return;
    }
    if (padRef.current?.isEmpty()) {
      setError("Draw your signature in the box.");
      return;
    }

    setSigning(true);
    setError("");
    try {
      const signatureBytes = await padRef.current.toPngBytes();
      if (!signatureBytes?.length) {
        throw new Error("Could not capture signature. Please try again.");
      }

      const pdfBytes = await buildOrderContractPdf(
        {
          ...contract.payload,
          customer_name: name,
          customer_signed_date: formatContractDate(),
        },
        { customerSignaturePngBytes: signatureBytes }
      );

      const path = signedContractPath(orderId);
      const { error: uploadError } = await supabase.storage
        .from(ORDER_CONTRACTS_BUCKET)
        .upload(path, new Blob([pdfBytes], { type: "application/pdf" }), {
          contentType: "application/pdf",
          upsert: true,
          cacheControl: "3600",
        });
      if (uploadError) throw uploadError;

      const { error: rpcError } = await supabase.rpc(
        "submit_signed_order_contract",
        { p_order_id: orderId, p_signed_path: path }
      );
      if (rpcError) throw rpcError;

      padRef.current?.clear();
      setCustomerName("");
      setReloadToken((n) => n + 1);
    } catch (err) {
      setError(err.message || "Failed to submit signed agreement");
    } finally {
      setSigning(false);
    }
  }

  if (loading || !contract?.notified_at) return null;

  const isSigned = contract.status === "signed" && Boolean(contract.signed_path);
  const hasPayload =
    contract.payload != null && typeof contract.payload === "object";
  if (!hasPayload) return null;

  return (
    <section className="rounded-xl border border-ink/10 bg-night/25 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-ink">
            Property &amp; liability agreement
          </h2>
          <p className="mt-1 text-xs text-ink/55">
            {isSigned
              ? `Signed ${formatContractDate(contract.signed_at)}.`
              : "Read the agreement, then sign at the bottom."}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            isSigned
              ? "bg-status-green/15 text-status-green"
              : "bg-ink/10 text-ink/70"
          }`}
        >
          {isSigned ? "Signed" : "Needs signature"}
        </span>
      </div>

      <form
        onSubmit={handleSignSubmit}
        className="mt-4 rounded-lg border border-ink/15 bg-white px-4 py-5 sm:px-6"
      >
        <AgreementBody payload={contract.payload} />

        {isSigned ? (
          signedUrl ? (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex w-full items-center justify-center rounded-lg border border-night/20 px-4 py-2.5 text-sm font-semibold text-night transition hover:border-night/40 sm:w-auto"
            >
              View signed copy (PDF)
            </a>
          ) : null
        ) : (
          <div className="mt-6 space-y-4 border-t border-night/15 pt-5 text-night">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-night/55">
                Your full name
              </span>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                disabled={signing}
                autoComplete="name"
                placeholder="Type your legal name"
                className="mt-1 w-full rounded-lg border border-night/20 bg-white px-3 py-2.5 text-base text-night placeholder:text-night/40 outline-none transition focus:border-night/50 disabled:opacity-50 sm:text-sm"
              />
            </label>

            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-night/55">
                  Your signature
                </span>
                <button
                  type="button"
                  disabled={signing}
                  onClick={() => padRef.current?.clear()}
                  className="text-[11px] font-semibold text-night/55 transition hover:text-night disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
              <div className="mt-1 overflow-hidden rounded-lg border border-dashed border-night/30">
                <SignaturePad ref={padRef} disabled={signing} />
              </div>
              <p className="mt-1 text-[11px] text-night/50">
                Draw with your finger or mouse. Date: {formatContractDate()}
              </p>
            </div>

            {error ? (
              <p className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={signing}
              className="w-full rounded-lg bg-night px-4 py-3 text-sm font-bold text-ink transition hover:brightness-125 disabled:opacity-40 sm:w-auto sm:px-6"
            >
              {signing ? "Submitting…" : "Sign agreement"}
            </button>
          </div>
        )}
      </form>

      {isSigned && error ? (
        <p className="mt-3 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

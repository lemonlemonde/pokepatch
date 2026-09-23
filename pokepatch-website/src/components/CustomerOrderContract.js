"use client";

import { useEffect, useRef, useState } from "react";
import {
  ORDER_CONTRACTS_BUCKET,
  signedContractPath,
} from "@/lib/orderContractPdf";
import { supabase } from "@/lib/supabaseClient";

const SIGNED_URL_EXPIRES_IN = 60 * 60;

export default function CustomerOrderContract({ orderId }) {
  const [contract, setContract] = useState(null);
  const [unsignedUrl, setUnsignedUrl] = useState(null);
  const [signedUrl, setSignedUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!orderId || !supabase) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const { data, error: loadError } = await supabase
          .from("order_contracts")
          .select(
            "order_id, status, unsigned_path, signed_path, prepared_at, signed_at, notified_at"
          )
          .eq("order_id", orderId)
          .maybeSingle();
        if (cancelled) return;
        if (loadError) throw loadError;
        setContract(data);

        let nextUnsigned = null;
        let nextSigned = null;
        if (data?.unsigned_path) {
          const { data: signed, error: signError } = await supabase.storage
            .from(ORDER_CONTRACTS_BUCKET)
            .createSignedUrl(data.unsigned_path, SIGNED_URL_EXPIRES_IN);
          if (signError) throw signError;
          nextUnsigned = signed?.signedUrl ?? null;
        }
        if (data?.signed_path) {
          const { data: signed, error: signError } = await supabase.storage
            .from(ORDER_CONTRACTS_BUCKET)
            .createSignedUrl(data.signed_path, SIGNED_URL_EXPIRES_IN);
          if (signError) throw signError;
          nextSigned = signed?.signedUrl ?? null;
        }
        if (cancelled) return;
        setUnsignedUrl(nextUnsigned);
        setSignedUrl(nextSigned);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setContract(null);
        setUnsignedUrl(null);
        setSignedUrl(null);
        setError(err.message || "Failed to load contract");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId, reloadToken]);

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !supabase || !orderId) return;

    if (file.type && file.type !== "application/pdf") {
      setError("Please upload a PDF file.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("PDF is too large (max 15MB).");
      return;
    }

    setUploading(true);
    setError("");
    setInfo("");
    try {
      const path = signedContractPath(orderId);
      const { error: uploadError } = await supabase.storage
        .from(ORDER_CONTRACTS_BUCKET)
        .upload(path, file, {
          contentType: "application/pdf",
          upsert: true,
          cacheControl: "3600",
        });
      if (uploadError) throw uploadError;

      const { error: rpcError } = await supabase.rpc(
        "submit_signed_order_contract",
        {
          p_order_id: orderId,
          p_signed_path: path,
        }
      );
      if (rpcError) throw rpcError;

      setInfo("Signed contract uploaded. Thank you!");
      setReloadToken((n) => n + 1);
    } catch (err) {
      setError(err.message || "Failed to upload signed contract");
    } finally {
      setUploading(false);
    }
  }

  if (loading || !contract?.unsigned_path || !contract?.notified_at) {
    return null;
  }

  const isSigned = contract.status === "signed" && Boolean(contract.signed_path);

  return (
    <section className="rounded-xl border border-ink/10 bg-night/25 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-ink">
            Property &amp; liability agreement
          </h2>
          <p className="mt-1 text-xs text-ink/55">
            Download the filled agreement, sign it, then upload the signed PDF
            here.
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            isSigned
              ? "bg-status-green/15 text-status-green"
              : "bg-ink/10 text-ink/70"
          }`}
        >
          {isSigned ? "Signed" : "Ready to sign"}
        </span>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="mt-3 rounded-lg border border-ink/15 bg-night/40 px-3 py-2 text-xs text-ink/70">
          {info}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {unsignedUrl ? (
          <a
            href={unsignedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-ink px-3 py-2 text-xs font-bold text-night transition hover:brightness-110"
          >
            Download agreement
          </a>
        ) : null}
        {signedUrl ? (
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-ink/15 px-3 py-2 text-xs font-semibold text-ink/80 transition hover:border-ink/30 hover:text-ink"
          >
            View uploaded signed PDF
          </a>
        ) : null}
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-ink/15 px-3 py-2 text-xs font-semibold text-ink/80 transition hover:border-ink/30 hover:text-ink disabled:opacity-40"
        >
          {uploading
            ? "Uploading…"
            : isSigned
              ? "Replace signed PDF"
              : "Upload signed PDF"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={handleUpload}
        />
      </div>
    </section>
  );
}

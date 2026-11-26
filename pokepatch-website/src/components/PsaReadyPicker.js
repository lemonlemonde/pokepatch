"use client";

import { PsaReadyMark } from "@/components/PsaReadyBadge";
import {
  HOLDER_STANDARD_HINT,
  HOLDER_STANDARD_LABEL,
  PSA_READY_FEE,
  PSA_READY_HINT,
  PSA_READY_LABEL,
  cardIsPsaReady,
  psaReadyControlClass,
} from "@/lib/psaReady";

function HolderOption({
  name,
  value,
  selected,
  disabled,
  onChange,
  title,
  price,
  hint,
  tone,
}) {
  const checked = selected === value;
  const inputId = `${name}-${value}`;
  return (
    <label
      htmlFor={inputId}
      className={`flex cursor-pointer flex-col rounded-lg border px-3 py-2.5 transition-colors ${
        disabled ? "cursor-not-allowed opacity-60" : ""
      } ${checked ? tone.selected : tone.idle}`.trim()}
    >
      <input
        id={inputId}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange?.(value === "psa")}
        className="sr-only"
      />
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {value === "psa" ? (
            <span
              className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${psaReadyControlClass(checked)}`}
              aria-hidden="true"
            >
              <PsaReadyMark className="h-2.5 w-2.5" />
            </span>
          ) : null}
          <span className="text-sm font-bold text-ink">{title}</span>
        </span>
        {price ? (
          <span className="font-mono text-[11px] tabular-nums text-ink/55">
            ${price}
          </span>
        ) : (
          <span className="font-mono text-[11px] uppercase tracking-wide text-ink/40">
            Included
          </span>
        )}
      </span>
      <span className="mt-1 text-xs leading-snug text-ink/60">{hint}</span>
    </label>
  );
}

/**
 * Per-card sleeve control: included hard top loader vs PSA ready upgrade.
 */
export default function PsaReadyPicker({
  name,
  value,
  disabled = false,
  onChange,
  cardNumber = null,
}) {
  const selected = cardIsPsaReady({ isPsaReady: value }) ? "psa" : "standard";
  const cardLabel =
    cardNumber != null ? `card ${cardNumber}` : "this card";
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1 text-sm font-bold text-ink">
        Sleeve for {cardLabel}
      </legend>
      <p className="mb-3 text-xs leading-snug text-ink/55">
        Applies to {cardLabel} only. Default is a regular hard top loader at
        no extra charge.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <HolderOption
          name={name}
          value="standard"
          selected={selected}
          disabled={disabled}
          onChange={onChange}
          title={HOLDER_STANDARD_LABEL}
          price={0}
          hint={HOLDER_STANDARD_HINT}
          tone={{
            selected: "border-ink/25 bg-ink/[0.06] ring-1 ring-ink/15",
            idle: "border-ink/10 bg-ink/[0.03] hover:border-ink/20",
          }}
        />
        <HolderOption
          name={name}
          value="psa"
          selected={selected}
          disabled={disabled}
          onChange={onChange}
          title={PSA_READY_LABEL}
          price={PSA_READY_FEE}
          hint={PSA_READY_HINT}
          tone={{
            selected: "border-sky/50 bg-sky/10 ring-1 ring-sky/30",
            idle: "border-ink/10 bg-ink/[0.03] hover:border-sky/35",
          }}
        />
      </div>
    </fieldset>
  );
}

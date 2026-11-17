"use client";

import Link from "next/link";
import { optionClassName } from "@/lib/formStyles";
import { inlineFieldErrorMessage } from "@/lib/quoteDraftHelpers";
import { WHITENING_FAQ_HREF } from "@/lib/servicePricing";

export default function WhiteningFaqAcknowledgment({
  checked,
  onChange,
  invalid = false,
  disabled = false,
  actionWord = "submitting",
}) {
  return (
    <div id="whitening_faq_ack" className="scroll-mt-24 space-y-2">
      <p className="text-sm leading-relaxed text-ink/70">
        This request includes whitening. Please read the{" "}
        <Link
          href={WHITENING_FAQ_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
        >
          whitening FAQ
        </Link>{" "}
        before {actionWord}.
      </p>
      <label className={optionClassName(invalid)}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-ink"
        />
        <span className="text-sm leading-relaxed text-ink/80">
          <span className="font-bold text-ink">I have read the whitening FAQ.</span>{" "}
          I understand that results are not guaranteed, every restored card
          carries an alteration risk, and the whitening fee is due even if the
          fix is unsuccessful.
        </span>
      </label>
      {invalid ? (
        <p className="text-sm text-error" role="alert">
          {inlineFieldErrorMessage("whiteningFaqAck")}
        </p>
      ) : null}
    </div>
  );
}

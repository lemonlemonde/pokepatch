"use client";

/**
 * Shared primitives for the admin order editor.
 * One visual language: quiet panels, small-caps labels, dark inset fields,
 * berry reserved for primary actions and money.
 */

export function Chevron({ open = false, className = "h-4 w-4" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className} shrink-0 transition-transform duration-200 ${
        open ? "rotate-180" : ""
      }`}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

const EDITOR_FIELD_BASE =
  "rounded-lg border border-ink/15 bg-night/40 px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink/30 focus:border-ink/40 focus:ring-2 focus:ring-ink/10 disabled:opacity-50";

/** @param {{ fullWidth?: boolean }} [options] */
export function editorFieldClass({ fullWidth = true } = {}) {
  return fullWidth ? `w-full ${EDITOR_FIELD_BASE}` : EDITOR_FIELD_BASE;
}

export function adminNoteFieldClass() {
  return "w-full rounded-lg border border-mint/30 bg-night/40 px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink/30 focus:border-mint/60 focus:ring-2 focus:ring-mint/15 disabled:opacity-50";
}

export function EditorLabel({ children, className = "" }) {
  return (
    <span
      className={`mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45 ${className}`}
    >
      {children}
    </span>
  );
}

export function EditorDivider({ label }) {
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-ink/40">
        {label}
      </span>
      <div className="h-px flex-1 bg-ink/10" />
    </div>
  );
}

export function FieldGrid({ children }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function GhostButton({ children, className = "", danger = false, ...props }) {
  return (
    <button
      type="button"
      className={`text-sm font-semibold transition disabled:opacity-40 ${
        danger ? "text-ink/40 hover:text-berry" : "text-berry hover:text-blush"
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function RemoveButton({ label = "Remove", className = "", ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base leading-none text-ink/35 transition hover:bg-berry/10 hover:text-berry disabled:opacity-40 ${className}`}
      {...props}
    >
      ×
    </button>
  );
}

/** Standard panel: small-caps title row + body. */
export function Panel({ title, action, children, className = "" }) {
  return (
    <section className={`marketing-panel rounded-2xl ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45">
            {title}
          </h3>
          {action ?? null}
        </div>
      ) : null}
      <div className={`px-4 pb-4 sm:px-5 ${title ? "pt-3" : "pt-4"}`}>
        {children}
      </div>
    </section>
  );
}

/** Mint-tinted note field for customer-visible notes. */
export function AdminNoteField({
  label,
  hint,
  value,
  onChange,
  onFocus,
  placeholder,
  minHeightClass = "min-h-[72px]",
  disabled = false,
}) {
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mint">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-mint"
            aria-hidden="true"
          />
          {label}
        </span>
        {hint ? (
          <span className="text-[11px] normal-case tracking-normal text-ink/40">
            {hint}
          </span>
        ) : null}
      </div>
      <textarea
        className={`${adminNoteFieldClass()} ${minHeightClass}`}
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  );
}

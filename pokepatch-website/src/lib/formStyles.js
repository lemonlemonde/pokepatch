/** Shared public-site form field classes (dark editorial). */
export function fieldClassName(invalid = false, locked = false) {
  // text-base (16px) avoids iOS zoom-on-focus from smaller inputs.
  if (locked) {
    return "w-full scroll-mt-24 cursor-not-allowed rounded-lg border border-ink/10 bg-ink/5 px-4 py-3 text-base text-ink/50 outline-none";
  }
  return invalid
    ? "w-full scroll-mt-24 rounded-lg border border-error bg-ink/[0.03] px-4 py-3 text-base text-ink outline-none focus:border-error"
    : "w-full scroll-mt-24 rounded-lg border border-ink/15 bg-ink/[0.03] px-4 py-3 text-base text-ink outline-none transition-colors focus:border-ink/40 disabled:cursor-not-allowed disabled:opacity-60";
}

export function optionClassName(invalid = false) {
  return invalid
    ? "flex cursor-pointer items-start gap-3 rounded-lg border border-error bg-ink/[0.03] px-4 py-3"
    : "flex cursor-pointer items-start gap-3 rounded-lg border border-ink/10 bg-ink/[0.03] px-4 py-3 transition-colors hover:border-ink/20";
}

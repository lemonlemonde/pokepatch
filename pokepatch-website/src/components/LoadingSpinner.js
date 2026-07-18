/** Shared loading indicator so every page waits the same way. */
export default function LoadingSpinner({ label = "Loading…", className = "" }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 py-16 ${className}`}
    >
      <div
        aria-hidden="true"
        className="h-10 w-10 animate-spin rounded-full border-4 border-ink/15 border-t-berry border-r-blush"
      />
      <p className="text-sm font-semibold text-ink/70">{label}</p>
    </div>
  );
}

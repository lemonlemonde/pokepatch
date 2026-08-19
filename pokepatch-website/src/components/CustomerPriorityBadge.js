/**
 * Shared customer-facing “Priority” chip (My Orders list + detail).
 */
export default function CustomerPriorityBadge({ className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-ink/35 bg-ink/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink ${className}`.trim()}
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-ink shadow-[0_0_10px_rgba(243, 233, 242,0.8)]"
        aria-hidden="true"
      />
      Priority
    </span>
  );
}

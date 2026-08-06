"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CARD_CHECKLIST_GROUPS, normalizeCardChecklist } from "@/lib/orderStatus";

function ChecklistCheckbox({ checked, onChange, label }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-xs text-ink/70 select-none hover:bg-ink/5 hover:text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-mint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/50"
      />
      {label}
    </label>
  );
}

export default function ChecklistGroupChip({ group, checklist, onChange }) {
  const normalized = normalizeCardChecklist(checklist);
  const done = group.items.filter((item) => normalized[item.id]).length;
  const total = group.items.length;
  const complete = total > 0 && done === total;

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);

  function openPopover() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 6, left: rect.left + rect.width / 2 });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onDocMouseDown(event) {
      if (
        buttonRef.current?.contains(event.target) ||
        popoverRef.current?.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPopover())}
        aria-expanded={open}
        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums transition ${
          complete
            ? "bg-mint/20 text-mint"
            : "bg-ink/5 text-ink/50 hover:bg-ink/10 hover:text-ink/70"
        }`}
      >
        {done}/{total} {group.label}
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              className="fixed z-[200] w-40 -translate-x-1/2 rounded-xl border-2 border-ink/15 bg-cream p-2.5 shadow-cozy"
              style={{ top: pos.top, left: pos.left }}
            >
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink/40">
                {group.label}
              </span>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <ChecklistCheckbox
                    key={item.id}
                    checked={normalized[item.id]}
                    label={item.label}
                    onChange={(value) =>
                      onChange({ ...normalized, [item.id]: value })
                    }
                  />
                ))}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export { CARD_CHECKLIST_GROUPS };

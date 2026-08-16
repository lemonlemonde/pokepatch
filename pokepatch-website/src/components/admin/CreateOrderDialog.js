"use client";

import { useEffect, useState } from "react";
import {
  overlayFadeClassName,
  useOverlayPresence,
} from "@/components/ExpandReveal";

function fieldClassName() {
  return "w-full rounded-xl border border-ink/15 bg-cream px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-mint focus:ring-2 focus:ring-mint/20";
}

const EMPTY_FORM = {
  first_name: "",
  last_name: "",
  customer_email: "",
  delivery_method: "local_dropoff",
};

/**
 * Create a pending quote order for a customer who may not have an account yet.
 * Cards and the rest of the draft are filled in the order editor afterward.
 */
export default function CreateOrderDialog({
  open,
  creating = false,
  onCancel,
  onCreate,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const { mounted, visible } = useOverlayPresence(open);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_FORM);
    setError("");
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape" && !creating) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, creating, onCancel]);

  if (!mounted) return null;

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    const first_name = form.first_name.trim();
    const last_name = form.last_name.trim();
    const customer_email = form.customer_email.trim();
    if (!first_name) {
      setError("First name is required.");
      return;
    }
    if (!last_name) {
      setError("Last name is required.");
      return;
    }
    if (!customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
      setError("Enter a valid email.");
      return;
    }
    try {
      await onCreate({
        first_name,
        last_name,
        customer_email,
        delivery_method: form.delivery_method,
      });
    } catch (err) {
      setError(err?.message || "Could not create order.");
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-night/70 px-4 py-6 ${overlayFadeClassName(visible)}`}
      role="presentation"
      onClick={() => {
        if (!creating) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-order-title"
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-ink/15 bg-cream"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="border-b border-ink/10 px-5 py-4">
          <h2 id="create-order-title" className="text-xl font-bold text-ink">
            New order
          </h2>
          <p className="mt-1 text-xs text-ink/50">
            Works for guests who have not signed up. Add cards after create.
          </p>
        </div>
        <div className="space-y-4 px-5 py-4">
          {error ? (
            <p className="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink">
                First name
              </span>
              <input
                value={form.first_name}
                onChange={(event) =>
                  updateField("first_name", event.target.value)
                }
                disabled={creating}
                autoFocus
                className={fieldClassName()}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-ink">
                Last name
              </span>
              <input
                value={form.last_name}
                onChange={(event) =>
                  updateField("last_name", event.target.value)
                }
                disabled={creating}
                className={fieldClassName()}
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-ink">
              Email
            </span>
            <input
              type="email"
              value={form.customer_email}
              onChange={(event) =>
                updateField("customer_email", event.target.value)
              }
              disabled={creating}
              className={fieldClassName()}
            />
          </label>
          <fieldset className="block">
            <legend className="mb-1.5 block text-sm font-semibold text-ink">
              Delivery
            </legend>
            <div className="flex flex-wrap gap-3">
              {[
                { value: "local_dropoff", label: "Local drop-off" },
                { value: "shipping", label: "Shipping" },
              ].map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    form.delivery_method === option.value
                      ? "border-mint bg-mint/10 text-ink"
                      : "border-ink/15 text-ink/70 hover:border-ink/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="delivery_method"
                    value={option.value}
                    checked={form.delivery_method === option.value}
                    disabled={creating}
                    onChange={() =>
                      updateField("delivery_method", option.value)
                    }
                    className="accent-mint"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="flex justify-end gap-2 border-t border-ink/10 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={creating}
            className="rounded-xl border border-ink/15 px-4 py-2 text-sm font-semibold text-ink/70 transition hover:border-ink/30 hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={creating}
            className="rounded-xl bg-mint px-4 py-2 text-sm font-semibold text-night transition hover:brightness-105 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create order"}
          </button>
        </div>
      </form>
    </div>
  );
}

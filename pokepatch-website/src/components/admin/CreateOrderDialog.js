"use client";

import { useEffect, useRef, useState } from "react";
import {
  overlayFadeClassName,
  useOverlayPresence,
} from "@/components/ExpandReveal";
import { adminSearchAccounts } from "@/lib/adminApi";

function fieldClassName() {
  return "w-full rounded-xl border border-ink/15 bg-cream px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-mint focus:ring-2 focus:ring-mint/20";
}

const EMPTY_FORM = {
  first_name: "",
  last_name: "",
  customer_email: "",
  delivery_method: "local_dropoff",
};

const MIN_ACCOUNT_QUERY = 2;
const ACCOUNT_SEARCH_DEBOUNCE_MS = 280;

function accountLabel(account) {
  const name = [account.first_name, account.last_name]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return name || account.email || "Account";
}

/**
 * Create a pending quote order for a guest or an existing account holder.
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
  const [accountQuery, setAccountQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const searchRequestIdRef = useRef(0);
  const { mounted, visible } = useOverlayPresence(open);

  function invalidateSearch() {
    searchRequestIdRef.current += 1;
    setSearchResults([]);
    setSearching(false);
    setSearchError("");
    setSearchTruncated(false);
  }

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_FORM);
    setError("");
    setAccountQuery("");
    setSelectedAccount(null);
    searchRequestIdRef.current += 1;
    setSearchResults([]);
    setSearching(false);
    setSearchError("");
    setSearchTruncated(false);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape" && !creating) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, creating, onCancel]);

  useEffect(() => {
    if (!open || selectedAccount) return undefined;

    const q = accountQuery.trim();
    if (q.length < MIN_ACCOUNT_QUERY) {
      searchRequestIdRef.current += 1;
      setSearchResults([]);
      setSearching(false);
      setSearchError("");
      setSearchTruncated(false);
      return undefined;
    }

    const requestId = ++searchRequestIdRef.current;
    setSearching(true);
    setSearchError("");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const payload = await adminSearchAccounts(q);
          if (requestId !== searchRequestIdRef.current) return;
          setSearchResults(payload.accounts ?? []);
          setSearchTruncated(Boolean(payload.truncated));
        } catch (err) {
          if (requestId !== searchRequestIdRef.current) return;
          setSearchResults([]);
          setSearchTruncated(false);
          setSearchError(err?.message || "Account search failed.");
        } finally {
          if (requestId === searchRequestIdRef.current) {
            setSearching(false);
          }
        }
      })();
    }, ACCOUNT_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [open, accountQuery, selectedAccount]);

  if (!mounted) return null;

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectAccount(account) {
    setSelectedAccount(account);
    setAccountQuery("");
    invalidateSearch();
    setForm((current) => ({
      ...current,
      first_name: (account.first_name ?? "").trim(),
      last_name: (account.last_name ?? "").trim(),
      customer_email: (account.email ?? "").trim(),
    }));
  }

  function clearSelectedAccount() {
    setSelectedAccount(null);
    setAccountQuery("");
    invalidateSearch();
    setForm(EMPTY_FORM);
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

  const showSearchPanel =
    !selectedAccount && accountQuery.trim().length >= MIN_ACCOUNT_QUERY;

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
            Search for an existing account to prefill, or enter a guest by hand.
            Add cards after create.
          </p>
        </div>
        <div className="space-y-4 px-5 py-4">
          {error ? (
            <p className="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </p>
          ) : null}

          <div className="block">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="block text-sm font-semibold text-ink">
                Find account
              </span>
              {selectedAccount ? (
                <button
                  type="button"
                  onClick={clearSelectedAccount}
                  disabled={creating}
                  className="text-xs font-semibold text-ink/50 transition hover:text-ink disabled:opacity-50"
                >
                  Clear
                </button>
              ) : null}
            </div>

            {selectedAccount ? (
              <div className="rounded-xl border border-mint/40 bg-mint/10 px-3.5 py-2.5">
                <p className="text-sm font-semibold text-ink">
                  {accountLabel(selectedAccount)}
                </p>
                <p className="mt-0.5 text-xs text-ink/60">
                  {selectedAccount.email}
                </p>
              </div>
            ) : (
              <>
                <input
                  type="search"
                  value={accountQuery}
                  onChange={(event) => setAccountQuery(event.target.value)}
                  disabled={creating}
                  placeholder="Search by name or email…"
                  autoComplete="off"
                  autoFocus
                  className={fieldClassName()}
                />
                <p className="mt-1.5 text-xs text-ink/40">
                  Type at least {MIN_ACCOUNT_QUERY} characters. Optional — leave
                  blank for a guest order.
                </p>
              </>
            )}

            {showSearchPanel ? (
              <div className="mt-2 max-h-52 overflow-auto rounded-xl border border-ink/15 bg-cream">
                {searching ? (
                  <p className="px-3.5 py-2.5 text-sm text-ink/50">Searching…</p>
                ) : searchError ? (
                  <p className="px-3.5 py-2.5 text-sm text-error">{searchError}</p>
                ) : searchResults.length === 0 ? (
                  <p className="px-3.5 py-2.5 text-sm text-ink/50">
                    No matching accounts.
                  </p>
                ) : (
                  <>
                    {searchResults.map((account) => (
                      <button
                        key={account.user_id}
                        type="button"
                        disabled={creating}
                        onClick={() => selectAccount(account)}
                        className="flex w-full flex-col items-start gap-0.5 border-b border-ink/5 px-3.5 py-2.5 text-left text-sm text-ink transition last:border-b-0 hover:bg-ink/5"
                      >
                        <span className="font-semibold">
                          {accountLabel(account)}
                        </span>
                        <span className="text-xs text-ink/50">
                          {account.email}
                        </span>
                      </button>
                    ))}
                    {searchTruncated ? (
                      <p className="px-3.5 py-2 text-xs text-ink/40">
                        More matches — refine your search.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>

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

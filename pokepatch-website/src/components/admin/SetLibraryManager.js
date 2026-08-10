"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminCreateSetLibraryEntry,
  adminDeleteSetLibraryEntry,
  adminListSetCatalog,
  adminListSetLibrary,
  adminSaveSetLibraryEntry,
  adminSyncSetCatalog,
} from "@/lib/adminApi";

function fieldClassName() {
  return "w-full rounded-xl border-2 border-ink/15 bg-cream px-4 py-2 text-ink outline-none focus:border-blush";
}

function sortByName(rows) {
  return [...rows].sort((a, b) =>
    (a.set_name ?? "").localeCompare(b.set_name ?? "")
  );
}

function formatSyncedAt(value) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "never";
  return date.toLocaleString();
}

export default function SetLibraryManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [newEntry, setNewEntry] = useState({ set_name: "", abbreviation: "" });
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");

  const [catalog, setCatalog] = useState([]);
  const [catalogSyncedAt, setCatalogSyncedAt] = useState(null);
  const [catalogError, setCatalogError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError("");
    try {
      const rows = sortByName(await adminListSetLibrary());
      setItems(rows);
      setDrafts(
        Object.fromEntries(
          rows.map((row) => [
            row.id,
            { set_name: row.set_name, abbreviation: row.abbreviation },
          ])
        )
      );
    } catch (err) {
      setListError(err.message || "Could not load the set library.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshCatalog = useCallback(async () => {
    setCatalogError("");
    try {
      const { items: rows, syncedAt } = await adminListSetCatalog();
      setCatalog(rows);
      setCatalogSyncedAt(syncedAt);
    } catch (err) {
      setCatalogError(err.message || "Could not load the set catalogue.");
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshCatalog();
  }, [refresh, refreshCatalog]);

  const visibleCatalog = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter(
      (row) =>
        row.name?.toLowerCase().includes(needle) ||
        row.series?.toLowerCase().includes(needle) ||
        row.abbreviation?.toLowerCase().includes(needle)
    );
  }, [catalog, search]);

  function patchDraft(id, partial) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...partial },
    }));
  }

  async function handleSync() {
    setSyncing(true);
    setCatalogError("");
    try {
      await adminSyncSetCatalog();
      await refreshCatalog();
    } catch (err) {
      setCatalogError(
        err.message ||
          "Sync failed. The Pokémon TCG API is frequently unavailable — try again."
      );
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreate() {
    const setName = newEntry.set_name.trim();
    const abbreviation = newEntry.abbreviation.trim();
    if (!setName || !abbreviation) {
      setFormError("Both set name and abbreviation are required.");
      return;
    }
    setCreating(true);
    setFormError("");
    try {
      await adminCreateSetLibraryEntry(setName, abbreviation);
      setNewEntry({ set_name: "", abbreviation: "" });
      await refresh();
      await refreshCatalog();
    } catch (err) {
      setFormError(err.message || "Could not add this set.");
    } finally {
      setCreating(false);
    }
  }

  async function handleSave(id) {
    const draft = drafts[id];
    if (!draft) return;
    setSavingId(id);
    setListError("");
    try {
      await adminSaveSetLibraryEntry(id, {
        set_name: draft.set_name.trim(),
        abbreviation: draft.abbreviation.trim(),
      });
      await refresh();
      await refreshCatalog();
    } catch (err) {
      setListError(err.message || "Could not save this set.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id, setName) {
    if (!window.confirm(`Remove “${setName}” from the set library?`)) return;
    setSavingId(id);
    setListError("");
    try {
      await adminDeleteSetLibraryEntry(id);
      await refresh();
      await refreshCatalog();
    } catch (err) {
      setListError(err.message || "Could not delete this set.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-ink/70">
        Every Pokémon set, mirrored locally from the Pokémon TCG API. Each set
        carries its official short code — override it below when the code is
        missing or you want different Google Drive folder shorthand.
      </p>

      <section className="rounded-2xl border-2 border-ink/10 bg-cream/70 p-5 shadow-cozy">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">Set catalogue</h2>
            <p className="text-xs text-ink/55">
              {catalog.length} sets · last synced {formatSyncedAt(catalogSyncedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="rounded-xl border-2 border-ink/20 px-4 py-2 text-sm font-semibold text-ink transition hover:border-blush disabled:opacity-60"
          >
            {syncing ? "Syncing…" : "Sync from Pokémon TCG API"}
          </button>
        </div>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className={`mt-4 ${fieldClassName()}`}
          placeholder="Filter by set, series, or code"
        />

        {catalogError && (
          <p className="mt-3 rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
            {catalogError}
          </p>
        )}

        {catalog.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-ink/20 px-4 py-10 text-center text-sm text-ink/50">
            Catalogue is empty. Run a sync to pull every set.
          </p>
        ) : (
          <ul className="mt-4 max-h-[28rem] space-y-1 overflow-y-auto pr-1">
            {visibleCatalog.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-lg border border-ink/10 bg-cream px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {row.name}
                  </p>
                  <p className="truncate text-xs text-ink/55">
                    {row.series || "—"}
                    {row.release_date ? ` · ${row.release_date}` : ""}
                  </p>
                </div>
                {row.abbreviation ? (
                  <span
                    className={`rounded px-2 py-1 text-xs font-bold ${
                      row.abbreviation_overridden
                        ? "bg-blush/30 text-ink"
                        : "bg-night/10 text-ink/70"
                    }`}
                    title={
                      row.abbreviation_overridden
                        ? "Overridden below"
                        : "Official code from the Pokémon TCG API"
                    }
                  >
                    {row.abbreviation}
                  </span>
                ) : (
                  <span className="text-xs text-ink/40">no code</span>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setNewEntry({
                      set_name: row.name,
                      abbreviation: row.abbreviation ?? "",
                    })
                  }
                  className="rounded-lg border border-ink/20 px-2 py-1 text-xs font-semibold text-ink hover:border-blush"
                >
                  Override
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border-2 border-ink/10 bg-cream/70 p-5 shadow-cozy">
        <h2 className="text-lg font-bold text-ink">Abbreviation overrides</h2>
        <p className="mt-1 text-xs text-ink/55">
          These win over the synced code. Only needed where the official code is
          missing or wrong for your naming.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-ink">Set name</span>
            <input
              value={newEntry.set_name}
              onChange={(event) =>
                setNewEntry((current) => ({
                  ...current,
                  set_name: event.target.value,
                }))
              }
              className={fieldClassName()}
              placeholder="e.g. Guardians Rising"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-ink">Abbreviation</span>
            <input
              value={newEntry.abbreviation}
              onChange={(event) =>
                setNewEntry((current) => ({
                  ...current,
                  abbreviation: event.target.value,
                }))
              }
              className={fieldClassName()}
              placeholder="e.g. GRI"
            />
          </label>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="self-end rounded-xl bg-berry px-4 py-2 text-sm font-semibold text-night shadow-cozy transition hover:brightness-110 disabled:opacity-60"
          >
            {creating ? "Adding…" : "Add"}
          </button>
        </div>
        {formError && (
          <p className="mt-3 rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
            {formError}
          </p>
        )}
      </section>

      {listError && (
        <p className="rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
          {listError}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink/60">Loading overrides…</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink/20 px-4 py-10 text-center text-sm text-ink/50">
          No overrides yet — the catalogue codes are being used as-is.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const draft = drafts[item.id] ?? {
              set_name: item.set_name,
              abbreviation: item.abbreviation,
            };
            const dirty =
              draft.set_name !== item.set_name ||
              draft.abbreviation !== item.abbreviation;
            const busy = savingId === item.id;
            return (
              <li
                key={item.id}
                className="grid gap-3 rounded-xl border-2 border-ink/10 bg-cream px-3 py-3 sm:grid-cols-[2fr_1fr_auto_auto]"
              >
                <input
                  value={draft.set_name}
                  onChange={(event) =>
                    patchDraft(item.id, { set_name: event.target.value })
                  }
                  className={fieldClassName()}
                />
                <input
                  value={draft.abbreviation}
                  onChange={(event) =>
                    patchDraft(item.id, { abbreviation: event.target.value })
                  }
                  className={fieldClassName()}
                />
                <button
                  type="button"
                  onClick={() => handleSave(item.id)}
                  disabled={!dirty || busy}
                  className="rounded-xl border-2 border-ink/20 px-3 py-2 text-sm font-semibold text-ink hover:border-blush disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(item.id, item.set_name)}
                  disabled={busy}
                  className="rounded-xl border-2 border-berry/50 px-3 py-2 text-sm font-semibold text-berry hover:bg-berry/10 disabled:opacity-60"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

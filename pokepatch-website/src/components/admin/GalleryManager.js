"use client";

import { useCallback, useEffect, useState } from "react";
import {
  adminClearGalleryPairSide,
  adminCreateGalleryItem,
  adminCreateGalleryPair,
  adminDeleteGalleryItem,
  adminDeleteGalleryPair,
  adminListGallery,
  adminReorderGallery,
  adminReorderGalleryPairs,
  adminSaveGalleryItem,
  adminUploadGalleryPairSide,
} from "@/lib/adminApi";
import { DAMAGE_TAGS, normalizeDamageTags } from "@/lib/gallery";

function fieldClassName() {
  return "w-full rounded-xl border-2 border-ink/15 bg-cream px-4 py-2 text-ink outline-none focus:border-blush";
}

function LoadingIndicator({ label = "Loading…", className = "" }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}
    >
      <div
        aria-hidden="true"
        className="h-10 w-10 animate-spin rounded-full border-4 border-ink/15 border-t-berry border-r-blush"
      />
      <p className="animate-soft-bounce text-sm font-semibold text-ink/70">{label}</p>
    </div>
  );
}

function ObjectPreview({ file, kind, className }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!file) {
      setUrl("");
      return undefined;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  if (!url) return null;

  if (kind === "video") {
    return <video src={url} className={className} muted playsInline />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={className} />;
}

function emptyDraft() {
  return {
    title: "",
    set_name: "",
    damage_tags: [],
    published: true,
  };
}

function itemToDraft(item) {
  return {
    title: item.title ?? "",
    set_name: item.set_name ?? "",
    damage_tags: normalizeDamageTags(item.damage_tags),
    published: item.published !== false,
  };
}

function SideUpload({
  label,
  previewUrl,
  stagedFile,
  mediaKind,
  uploading,
  onStage,
  onClear,
}) {
  const hasSomething = Boolean(stagedFile || previewUrl);
  const kind = mediaKind || (stagedFile?.type?.startsWith("video/") ? "video" : "image");

  return (
    <div className="rounded-xl border border-ink/10 bg-night/20 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-ink/60">{label}</p>
      <div className="mt-2 aspect-[3/4] overflow-hidden rounded-lg border border-ink/10 bg-night/30">
        {stagedFile ? (
          <ObjectPreview
            file={stagedFile}
            kind={kind}
            className="h-full w-full object-cover"
          />
        ) : previewUrl ? (
          kind === "video" ? (
            <video
              src={previewUrl}
              className="h-full w-full object-cover"
              muted
              playsInline
              controls
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={label}
              className="h-full w-full object-cover"
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-ink/40">
            No file
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <label className="cursor-pointer rounded-lg border border-ink/20 bg-cream px-2 py-1 text-xs font-semibold text-ink hover:border-blush">
          {uploading ? "Uploading…" : stagedFile ? "Change" : "Choose"}
          <input
            type="file"
            accept="image/*,video/*"
            className="hidden"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              onStage(file);
              event.target.value = "";
            }}
          />
        </label>
        {hasSomething && (
          <button
            type="button"
            disabled={uploading}
            onClick={onClear}
            className="rounded-lg border border-berry/40 px-2 py-1 text-xs font-semibold text-berry hover:bg-berry/10 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export default function GalleryManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [staged, setStaged] = useState({});
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [reordering, setReordering] = useState(false);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError("");
    try {
      const rows = await adminListGallery();
      setItems(rows);
      return rows;
    } catch (err) {
      setListError(err.message || "Could not load gallery.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function openItem(item) {
    setSelectedId(item.id);
    setDraft(itemToDraft(item));
    setStaged({});
    setEditorError("");
  }

  function startCreate() {
    setSelectedId(null);
    setDraft(emptyDraft());
    setStaged({});
    setEditorError("");
  }

  function closeEditor() {
    setSelectedId(null);
    setDraft(null);
    setStaged({});
    setEditorError("");
  }

  function replaceSelected(item) {
    setItems((current) =>
      current.map((row) => (row.id === item.id ? item : row))
    );
    setSelectedId(item.id);
    setDraft(itemToDraft(item));
  }

  async function handleSaveMeta() {
    if (!draft?.title.trim()) {
      setEditorError("Title is required.");
      return;
    }

    setSaving(true);
    setEditorError("");
    try {
      let item = selected;
      if (!item) {
        item = await adminCreateGalleryItem({
          title: draft.title.trim(),
          set_name: draft.set_name.trim(),
          damage_tags: draft.damage_tags,
          published: draft.published,
        });
      } else {
        item = await adminSaveGalleryItem(item.id, {
          title: draft.title.trim(),
          set_name: draft.set_name.trim(),
          damage_tags: draft.damage_tags,
          published: draft.published,
        });
      }

      // Upload any staged pair sides for the selected item.
      for (const [key, file] of Object.entries(staged)) {
        if (!file) continue;
        const [pairId, side] = key.split(":");
        if (!pairId || (side !== "before" && side !== "after")) continue;
        item = await adminUploadGalleryPairSide(pairId, side, file);
      }

      const rows = await refresh();
      const fresh = rows?.find((row) => row.id === item.id) ?? item;
      openItem(fresh);
    } catch (err) {
      setEditorError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddPair(mediaKind = "image") {
    if (!selected) return;
    setSaving(true);
    setEditorError("");
    try {
      const item = await adminCreateGalleryPair(selected.id, mediaKind);
      replaceSelected(item);
    } catch (err) {
      setEditorError(err.message || "Could not add pair.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePair(pairId) {
    if (!window.confirm("Delete this before/after pair?")) return;
    setSaving(true);
    setEditorError("");
    try {
      const item = await adminDeleteGalleryPair(pairId);
      setStaged((current) => {
        const next = { ...current };
        delete next[`${pairId}:before`];
        delete next[`${pairId}:after`];
        return next;
      });
      replaceSelected(item);
    } catch (err) {
      setEditorError(err.message || "Could not delete pair.");
    } finally {
      setSaving(false);
    }
  }

  async function handleMovePair(index, direction) {
    if (!selected) return;
    const pairs = [...(selected.pairs ?? [])];
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= pairs.length) return;
    const [row] = pairs.splice(index, 1);
    pairs.splice(nextIndex, 0, row);
    setReordering(true);
    setEditorError("");
    try {
      const item = await adminReorderGalleryPairs(
        selected.id,
        pairs.map((pair) => pair.id)
      );
      replaceSelected(item);
    } catch (err) {
      setEditorError(err.message || "Could not reorder pairs.");
      await refresh();
    } finally {
      setReordering(false);
    }
  }

  async function handleClearSide(pairId, side) {
    setSaving(true);
    setEditorError("");
    try {
      setStaged((current) => {
        const next = { ...current };
        delete next[`${pairId}:${side}`];
        return next;
      });
      const item = await adminClearGalleryPairSide(pairId, side);
      replaceSelected(item);
    } catch (err) {
      setEditorError(err.message || "Could not remove file.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    if (!window.confirm(`Delete “${selected.title}” from the gallery?`)) return;

    setSaving(true);
    setEditorError("");
    try {
      await adminDeleteGalleryItem(selected.id);
      closeEditor();
      await refresh();
    } catch (err) {
      setEditorError(err.message || "Delete failed.");
    } finally {
      setSaving(false);
    }
  }

  async function moveItem(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= items.length) return;

    const next = [...items];
    const [row] = next.splice(index, 1);
    next.splice(nextIndex, 0, row);
    setItems(next);
    setReordering(true);
    setListError("");
    try {
      const refreshed = await adminReorderGallery(next.map((item) => item.id));
      setItems(refreshed);
    } catch (err) {
      setListError(err.message || "Could not reorder.");
      await refresh();
    } finally {
      setReordering(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink/70">
          Each card is a list of before/after pairs. First pair shows on the gallery;
          the rest open under Show more.
        </p>
        <button
          type="button"
          onClick={startCreate}
          className="rounded-xl bg-berry px-4 py-2 text-sm font-semibold text-night shadow-cozy transition hover:brightness-110"
        >
          New gallery item
        </button>
      </div>

      {listError && (
        <p className="rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
          {listError}
        </p>
      )}

      {loading ? (
        <LoadingIndicator label="Loading gallery…" />
      ) : items.length === 0 && !draft ? (
        <p className="rounded-xl border border-dashed border-ink/20 px-4 py-10 text-center text-sm text-ink/50">
          No gallery items yet. Click “New gallery item” to add your first restoration.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li
              key={item.id}
              className={`flex flex-wrap items-center gap-3 rounded-xl border-2 px-3 py-3 ${
                selectedId === item.id
                  ? "border-berry bg-blush/20"
                  : "border-ink/10 bg-cream"
              }`}
            >
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={reordering || index === 0}
                  onClick={() => moveItem(index, -1)}
                  className="rounded-lg border border-ink/15 px-2 py-1 text-xs font-bold disabled:opacity-30"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={reordering || index === items.length - 1}
                  onClick={() => moveItem(index, 1)}
                  className="rounded-lg border border-ink/15 px-2 py-1 text-xs font-bold disabled:opacity-30"
                  aria-label="Move down"
                >
                  ↓
                </button>
              </div>

              <button
                type="button"
                onClick={() => openItem(item)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="font-display text-base font-bold text-ink">
                  {item.title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-ink/55">
                  {item.set_name ? `${item.set_name} · ` : ""}
                  {(item.pairs ?? []).length} pair
                  {(item.pairs ?? []).length === 1 ? "" : "s"}
                  {(item.damage_tags ?? []).length
                    ? ` · ${(item.damage_tags ?? []).length} tag${
                        (item.damage_tags ?? []).length === 1 ? "" : "s"
                      }`
                    : ""}
                  {!item.published ? " · unpublished" : ""}
                </span>
              </button>

              {item.pairs?.[0]?.urls?.before && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.pairs[0].urls.before}
                  alt=""
                  className="h-12 w-9 rounded object-cover"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <section className="rounded-2xl border-2 border-ink/10 bg-cream/70 p-5 shadow-cozy">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-ink">
                {selected ? `Edit — ${selected.title}` : "New gallery item"}
              </h2>
              <p className="mt-1 text-sm text-ink/60">
                Save metadata, then add as many before/after pairs as you want.
              </p>
            </div>
            <button
              type="button"
              onClick={closeEditor}
              className="rounded-xl border-2 border-ink/20 px-3 py-1.5 text-sm font-semibold text-ink hover:border-blush"
            >
              Close
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm font-semibold text-ink">Title</span>
              <input
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
                className={fieldClassName()}
                placeholder="Card name"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-semibold text-ink">Set</span>
              <input
                value={draft.set_name}
                onChange={(event) =>
                  setDraft({ ...draft, set_name: event.target.value })
                }
                className={fieldClassName()}
                placeholder="e.g. Base Set, Evolving Skies"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-sm font-semibold text-ink">Damage tags</span>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {DAMAGE_TAGS.map((tag) => {
                  const checked = draft.damage_tags.includes(tag.id);
                  return (
                    <label
                      key={tag.id}
                      className="flex items-center gap-2 text-sm font-semibold text-ink"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...draft.damage_tags, tag.id]
                            : draft.damage_tags.filter((id) => id !== tag.id);
                          setDraft({
                            ...draft,
                            damage_tags: normalizeDamageTags(next),
                          });
                        }}
                      />
                      {tag.label}
                    </label>
                  );
                })}
              </div>
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={draft.published}
                onChange={(event) =>
                  setDraft({ ...draft, published: event.target.checked })
                }
              />
              Published on /gallery
            </label>
          </div>

          {selected && (
            <div className="mt-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-lg font-bold text-ink">
                  Before / after pairs
                </h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleAddPair("image")}
                    className="rounded-lg border border-ink/20 bg-cream px-3 py-1.5 text-xs font-semibold text-ink hover:border-blush disabled:opacity-50"
                  >
                    + Image pair
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleAddPair("video")}
                    className="rounded-lg border border-ink/20 bg-cream px-3 py-1.5 text-xs font-semibold text-ink hover:border-blush disabled:opacity-50"
                  >
                    + Video pair
                  </button>
                </div>
              </div>

              {(selected.pairs ?? []).length === 0 ? (
                <p className="rounded-lg border border-dashed border-ink/15 px-3 py-6 text-center text-sm text-ink/50">
                  No pairs yet. Add an image or video pair.
                </p>
              ) : (
                (selected.pairs ?? []).map((pair, index) => (
                  <div
                    key={pair.id}
                    className="rounded-xl border border-ink/10 bg-night/15 p-4"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">
                        Pair {index + 1}
                        <span className="ml-2 text-xs font-normal uppercase tracking-wide text-ink/50">
                          {pair.media_kind || "image"}
                          {index === 0 ? " · featured" : ""}
                        </span>
                      </p>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={reordering || index === 0}
                          onClick={() => handleMovePair(index, -1)}
                          className="rounded-lg border border-ink/15 px-2 py-1 text-xs font-bold disabled:opacity-30"
                          aria-label="Move pair up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={
                            reordering ||
                            index === (selected.pairs ?? []).length - 1
                          }
                          onClick={() => handleMovePair(index, 1)}
                          className="rounded-lg border border-ink/15 px-2 py-1 text-xs font-bold disabled:opacity-30"
                          aria-label="Move pair down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleDeletePair(pair.id)}
                          className="rounded-lg border border-berry/40 px-2 py-1 text-xs font-semibold text-berry disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <SideUpload
                        label="Before"
                        previewUrl={pair.urls?.before}
                        stagedFile={staged[`${pair.id}:before`] ?? null}
                        mediaKind={pair.media_kind}
                        uploading={saving}
                        onStage={(file) =>
                          setStaged((current) => ({
                            ...current,
                            [`${pair.id}:before`]: file,
                          }))
                        }
                        onClear={() => {
                          if (staged[`${pair.id}:before`]) {
                            setStaged((current) => {
                              const next = { ...current };
                              delete next[`${pair.id}:before`];
                              return next;
                            });
                            return;
                          }
                          handleClearSide(pair.id, "before");
                        }}
                      />
                      <SideUpload
                        label="After"
                        previewUrl={pair.urls?.after}
                        stagedFile={staged[`${pair.id}:after`] ?? null}
                        mediaKind={pair.media_kind}
                        uploading={saving}
                        onStage={(file) =>
                          setStaged((current) => ({
                            ...current,
                            [`${pair.id}:after`]: file,
                          }))
                        }
                        onClear={() => {
                          if (staged[`${pair.id}:after`]) {
                            setStaged((current) => {
                              const next = { ...current };
                              delete next[`${pair.id}:after`];
                              return next;
                            });
                            return;
                          }
                          handleClearSide(pair.id, "after");
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {!selected && (
            <p className="mt-4 rounded-lg border border-ink/10 bg-night/20 px-3 py-2 text-sm text-ink/65">
              Create the item first — then add before/after pairs.
            </p>
          )}

          {editorError && (
            <p className="mt-4 rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
              {editorError}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveMeta}
              className={`rounded-xl bg-berry px-5 py-2.5 font-semibold text-night shadow-cozy transition hover:brightness-110 disabled:opacity-60 ${
                saving ? "animate-soft-bounce" : ""
              }`}
            >
              {saving ? "Saving…" : selected ? "Save changes" : "Create item"}
            </button>
            {selected && (
              <button
                type="button"
                disabled={saving}
                onClick={handleDelete}
                className="rounded-xl border-2 border-berry/50 px-4 py-2.5 text-sm font-semibold text-berry hover:bg-berry/10 disabled:opacity-60"
              >
                Delete
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GalleryCardSearch from "@/components/admin/GalleryCardSearch";
import { tcgCardImageUrl } from "@/lib/tcgCardImage";
import {
  adminClearGalleryPairSide,
  adminApplyGalleryTcgThumbnail,
  adminClearGalleryThumbnail,
  adminCreateGalleryItem,
  adminCreateGalleryPair,
  adminDeleteGalleryItem,
  adminDeleteGalleryPair,
  adminListGallery,
  adminReorderGalleryPairs,
  adminSaveGalleryItem,
  adminSaveGalleryPairCaption,
  adminUploadGalleryPairSide,
  adminUploadGalleryThumbnail,
} from "@/lib/adminApi";
import {
  CARD_THUMB_ASPECT_CLASS,
  CARD_THUMB_IMAGE_CLASS,
  DAMAGE_TAGS,
  normalizeDamageTags,
  formatPostedRelative,
  galleryPosterPublicUrl,
  galleryThumbPublicUrl,
} from "@/lib/gallery";
import {
  CARD_THUMB_MAX_DIMENSION,
  compressImageForUpload,
  makeThumbForUpload,
  makeVideoPosterForUpload,
  GALLERY_THUMB_MAX_DIMENSION,
} from "@/lib/imageCompression";

function fieldClassName() {
  return "w-full rounded-lg border border-ink/15 bg-cream px-4 py-2 text-ink outline-none focus:border-ink/40";
}

function secondaryButtonClassName() {
  return "rounded-lg border border-ink/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink/70 transition hover:border-ink/35 hover:text-ink disabled:opacity-50";
}

function primaryButtonClassName() {
  return "rounded-lg bg-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-night transition hover:bg-ink/90 disabled:opacity-50";
}

function dangerButtonClassName() {
  return "rounded-lg px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink/45 transition hover:text-berry disabled:opacity-50";
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

function sortItemsNewestFirst(rows) {
  return [...rows].sort((a, b) => {
    const aTime = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  });
}

function emptyDraft() {
  return {
    title: "",
    set_name: "",
    card_number: "",
    tcg_lookup_title: "",
    tcg_lookup_set_name: "",
    tcg_card_id: "",
    damage_tags: [],
    published: true,
  };
}

function itemToDraft(item) {
  return {
    title: item.title ?? "",
    set_name: item.set_name ?? "",
    card_number: item.card_number ?? "",
    tcg_lookup_title: item.tcg_lookup_title ?? "",
    tcg_lookup_set_name: item.tcg_lookup_set_name ?? "",
    tcg_card_id: item.tcg_card_id ?? "",
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
  const [dragging, setDragging] = useState(false);
  const hasSomething = Boolean(stagedFile || previewUrl);
  const kind = mediaKind || (stagedFile?.type?.startsWith("video/") ? "video" : "image");

  function acceptDroppedFile(fileList) {
    const file = Array.from(fileList ?? []).find(
      (entry) =>
        entry.type.startsWith("image/") || entry.type.startsWith("video/"),
    );
    if (file) onStage(file);
  }

  function handleFileInput(event) {
    const file = event.target.files?.[0] ?? null;
    onStage(file);
    event.target.value = "";
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-ink/10 bg-ink/[0.02] p-2.5">
      <div
        className={`relative h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-md border border-dashed transition ${
          uploading
            ? "opacity-60"
            : dragging
              ? "border-ink/40 bg-ink/[0.06]"
              : "border-ink/15 bg-ink/[0.03]"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (uploading) return;
          acceptDroppedFile(event.dataTransfer.files);
        }}
      >
        {stagedFile ? (
          <ObjectPreview
            file={stagedFile}
            kind={kind}
            className="h-full w-full object-cover"
          />
        ) : previewUrl ? (
          kind === "video" ? (
            galleryPosterPublicUrl(previewUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={galleryPosterPublicUrl(previewUrl)}
                alt={label}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-night/40 px-1 text-center text-[10px] leading-tight text-ink/50">
                Video
              </div>
            )
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={galleryThumbPublicUrl(previewUrl) || previewUrl}
              alt={label}
              className="h-full w-full object-cover"
            />
          )
        ) : (
          <label className="flex h-full cursor-pointer flex-col items-center justify-center gap-0.5 px-1 text-center text-[10px] leading-tight text-ink/40 transition hover:bg-ink/[0.04] hover:text-ink/55">
            <span>Drop</span>
            <span className="text-ink/30">or browse</span>
            <input
              type="file"
              accept="image/*,video/*"
              className="sr-only"
              disabled={uploading}
              onChange={handleFileInput}
            />
          </label>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45">
          {label}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <label className={`cursor-pointer ${secondaryButtonClassName()}`}>
            {uploading ? "Uploading…" : stagedFile ? "Change" : "Choose"}
            <input
              type="file"
              accept="image/*,video/*"
              className="hidden"
              disabled={uploading}
              onChange={handleFileInput}
            />
          </label>
          {hasSomething && (
            <button
              type="button"
              disabled={uploading}
              onClick={onClear}
              className={dangerButtonClassName()}
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ThumbnailUpload({
  previewUrl,
  previewCacheKey,
  stagedFile,
  uploading,
  onStage,
  onClear,
}) {
  const [dragging, setDragging] = useState(false);
  const hasSomething = Boolean(stagedFile || previewUrl);

  function acceptDroppedFile(fileList) {
    const file = Array.from(fileList ?? []).find((entry) =>
      entry.type.startsWith("image/"),
    );
    if (file) onStage(file);
  }

  function handleFileInput(event) {
    const file = event.target.files?.[0] ?? null;
    onStage(file);
    event.target.value = "";
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-ink/10 bg-ink/[0.02] p-2.5">
      <div
        className={`relative h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-md border border-dashed transition ${
          uploading
            ? "opacity-60"
            : dragging
              ? "border-ink/40 bg-ink/[0.06]"
              : "border-ink/15 bg-ink/[0.03]"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (uploading) return;
          acceptDroppedFile(event.dataTransfer.files);
        }}
      >
        {stagedFile ? (
          <ObjectPreview
            file={stagedFile}
            kind="image"
            className={`h-full w-full ${CARD_THUMB_IMAGE_CLASS}`}
          />
        ) : previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${previewUrl}:${previewCacheKey ?? ""}`}
            src={galleryThumbPublicUrl(previewUrl, previewCacheKey) || previewUrl}
            alt="Card thumbnail"
            className={`h-full w-full ${CARD_THUMB_IMAGE_CLASS}`}
          />
        ) : (
          <label className="flex h-full cursor-pointer flex-col items-center justify-center gap-0.5 px-1 text-center text-[10px] leading-tight text-ink/40 transition hover:bg-ink/[0.04] hover:text-ink/55">
            <span>Drop</span>
            <span className="text-ink/30">or browse</span>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={uploading}
              onChange={handleFileInput}
            />
          </label>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45">
          Card thumbnail
        </p>
        <div className="flex flex-wrap gap-1.5">
          <label className={`cursor-pointer ${secondaryButtonClassName()}`}>
            {uploading ? "Uploading…" : stagedFile ? "Change" : "Choose"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={handleFileInput}
            />
          </label>
          {hasSomething && (
            <button
              type="button"
              disabled={uploading}
              onClick={onClear}
              className={dangerButtonClassName()}
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function cardFromItem(item) {
  if (!item?.tcg_card_id) return null;
  return {
    id: item.tcg_card_id,
    name: item.title || item.tcg_lookup_title || "",
    set_name: item.set_name || item.tcg_lookup_set_name || "",
    number: item.card_number ?? "",
    image_small: tcgCardImageUrl({ id: item.tcg_card_id }),
  };
}

export default function GalleryManager({ initialEditId = null }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [staged, setStaged] = useState({});
  const [stagedThumbnail, setStagedThumbnail] = useState(null);
  const [captionDrafts, setCaptionDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [reordering, setReordering] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [applyingCard, setApplyingCard] = useState(false);
  const openedEditIdRef = useRef(null);

  const selected = items.find((item) => item.id === selectedId) ?? null;

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setListError("");
    }
    try {
      const rows = sortItemsNewestFirst(await adminListGallery());
      setItems(rows);
      return rows;
    } catch (err) {
      if (!silent) {
        setListError(err.message || "Could not load gallery.");
      }
      return null;
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  function upsertItem(item) {
    setItems((current) => {
      if (!current.some((row) => row.id === item.id)) {
        return sortItemsNewestFirst([item, ...current]);
      }
      return current.map((row) => (row.id === item.id ? item : row));
    });
  }

  function syncEditorFromItem(item, { resetStaged = false } = {}) {
    setSelectedId(item.id);
    setDraft(itemToDraft(item));
    setSelectedCard(cardFromItem(item));
    if (resetStaged) {
      setStaged({});
      setStagedThumbnail(null);
      setCaptionDrafts({});
    }
    setEditorError("");
  }

  useEffect(() => {
    refresh();
  }, [refresh]);

  function openItem(item) {
    syncEditorFromItem(item, { resetStaged: true });
  }

  useEffect(() => {
    if (!initialEditId) {
      openedEditIdRef.current = null;
      return;
    }
    if (loading) return;
    if (openedEditIdRef.current === initialEditId) return;
    openedEditIdRef.current = initialEditId;
    const match = items.find((item) => item.id === initialEditId);
    if (match) {
      syncEditorFromItem(match, { resetStaged: true });
    }
  }, [initialEditId, loading, items]);

  function startCreate() {
    setSelectedId(null);
    setDraft(emptyDraft());
    setSelectedCard(null);
    setStaged({});
    setStagedThumbnail(null);
    setCaptionDrafts({});
    setEditorError("");
  }

  function handleSelectCard(card) {
    setSelectedCard(card);
  }

  async function handleConfirmCard(card) {
    if (!card?.id || !draft) return;

    setApplyingCard(true);
    setEditorError("");
    try {
      let item = selected;
      if (!item) {
        item = await adminCreateGalleryItem({
          title: (card.name ?? "").trim(),
          set_name: (card.set_name ?? "").trim(),
          card_number: (card.number ?? "").trim(),
          tcg_lookup_title: (card.name ?? "").trim(),
          tcg_lookup_set_name: (card.set_name ?? "").trim(),
          tcg_card_id: card.id,
          damage_tags: draft.damage_tags,
          published: draft.published,
        });
        upsertItem(item);
        setSelectedId(item.id);
      }

      item = await adminApplyGalleryTcgThumbnail(item.id, card.id);

      upsertItem(item);
      syncEditorFromItem(item);
      setStagedThumbnail(null);
    } catch (err) {
      setEditorError(err.message || "Could not apply card.");
      if (selected) {
        syncEditorFromItem(selected);
        setSelectedCard(cardFromItem(selected));
      } else {
        setSelectedCard(null);
      }
    } finally {
      setApplyingCard(false);
    }
  }

  function handleClearCard() {
    setSelectedCard(null);
    setDraft((current) => ({
      ...current,
      title: "",
      set_name: "",
      card_number: "",
      tcg_card_id: "",
      tcg_lookup_title: "",
      tcg_lookup_set_name: "",
    }));
  }

  function closeEditor() {
    setSelectedId(null);
    setDraft(null);
    setSelectedCard(null);
    setStaged({});
    setStagedThumbnail(null);
    setCaptionDrafts({});
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
          card_number: draft.card_number.trim(),
          tcg_lookup_title: draft.tcg_lookup_title.trim(),
          tcg_lookup_set_name: draft.tcg_lookup_set_name.trim(),
          tcg_card_id: draft.tcg_card_id.trim(),
          damage_tags: draft.damage_tags,
          published: draft.published,
        });
      } else {
        item = await adminSaveGalleryItem(item.id, {
          title: draft.title.trim(),
          set_name: draft.set_name.trim(),
          card_number: draft.card_number.trim(),
          tcg_lookup_title: draft.tcg_lookup_title.trim(),
          tcg_lookup_set_name: draft.tcg_lookup_set_name.trim(),
          tcg_card_id: draft.tcg_card_id.trim(),
          damage_tags: draft.damage_tags,
          published: draft.published,
        });
      }

      // Card icon: one small WebP only (≤320px) — no raw PNG, no oversized main file.
      if (stagedThumbnail) {
        const { file: uploadFile, error: compressError } =
          await compressImageForUpload(stagedThumbnail, {
            maxDimension: CARD_THUMB_MAX_DIMENSION,
          });
        if (compressError || !uploadFile) {
          throw new Error(compressError || "Couldn't process this image.");
        }
        item = await adminUploadGalleryThumbnail(item.id, uploadFile);
      }

      // Apply official card art when a card is selected (unless manual upload staged).
      const cardId = draft.tcg_card_id.trim();
      const cardChanged = cardId && cardId !== (selected?.tcg_card_id ?? "");
      if (!stagedThumbnail && cardId && (!item.urls?.thumbnail || cardChanged)) {
        item = await adminApplyGalleryTcgThumbnail(item.id, cardId);
      }

      // Upload any staged pair sides for the selected item.
      for (const [key, file] of Object.entries(staged)) {
        if (!file) continue;
        const [pairId, side] = key.split(":");
        if (!pairId || (side !== "before" && side !== "after")) continue;

        if (file.type?.startsWith("video/")) {
          const { file: poster, error: posterError } =
            await makeVideoPosterForUpload(file);
          if (posterError || !poster) {
            throw new Error(
              posterError || "Couldn't capture a poster from this video."
            );
          }
          item = await adminUploadGalleryPairSide(pairId, side, file, {
            poster,
          });
        } else {
          const { file: uploadFile, error: compressError } =
            await compressImageForUpload(file);
          if (compressError || !uploadFile) {
            throw new Error(compressError || "Couldn't process this image.");
          }
          const { file: thumb } = await makeThumbForUpload(uploadFile, {
            maxDimension: GALLERY_THUMB_MAX_DIMENSION,
          });
          item = await adminUploadGalleryPairSide(pairId, side, uploadFile, {
            thumb,
          });
        }
      }

      // Persist any edited pair captions for still-existing pairs.
      const pairIds = new Set((selected?.pairs ?? []).map((pair) => pair.id));
      for (const [pairId, caption] of Object.entries(captionDrafts)) {
        if (!pairIds.has(pairId)) continue;
        item = await adminSaveGalleryPairCaption(pairId, caption);
      }

      upsertItem(item);
      syncEditorFromItem(item, { resetStaged: true });
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

  async function handleGenerateAllMissingThumbnails() {
    const missing = items.filter(
      (item) => !item.urls?.thumbnail && item.tcg_card_id
    );
    if (missing.length === 0) return;
    if (
      !window.confirm(
        `Apply card thumbnails for ${missing.length} item${missing.length === 1 ? "" : "s"} with a selected card but no thumbnail yet?`
      )
    ) {
      return;
    }

    setSaving(true);
    setEditorError("");
    let failed = 0;
    try {
      for (const row of missing) {
        try {
          await adminApplyGalleryTcgThumbnail(row.id, row.tcg_card_id);
        } catch {
          failed += 1;
        }
      }
      const rows = await refresh({ silent: Boolean(selectedId) });
      if (selectedId && rows) {
        const fresh = rows.find((row) => row.id === selectedId);
        if (fresh) syncEditorFromItem(fresh);
      }
      if (failed) {
        setEditorError(`${failed} thumbnail${failed === 1 ? "" : "s"} failed.`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleClearThumbnail() {
    if (!selected) return;
    setSaving(true);
    setEditorError("");
    try {
      setStagedThumbnail(null);
      const item = await adminClearGalleryThumbnail(selected.id);
      replaceSelected(item);
    } catch (err) {
      setEditorError(err.message || "Could not remove thumbnail.");
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

  function renderEditor() {
    if (!draft) return null;
    const cardLocked = Boolean(draft.tcg_card_id?.trim());
    const lockedFieldClassName = cardLocked
      ? `${fieldClassName()} bg-night/20 text-ink/80`
      : fieldClassName();

    return (
      <section className="rounded-lg border border-ink/10 bg-ink/[0.02] p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/40">
              {selected ? "Edit item" : "New item"}
            </p>
            <h2 className="mt-1 text-xl font-medium tracking-tight text-ink">
              {selected ? selected.title : "New gallery item"}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeEditor}
            className={secondaryButtonClassName()}
          >
            Close
          </button>
        </div>

        <GalleryCardSearch
          selectedCard={selectedCard}
          appliedCardId={selected?.tcg_card_id ?? ""}
          onSelect={handleSelectCard}
          onConfirm={handleConfirmCard}
          onClear={handleClearCard}
          confirming={applyingCard}
          initialCardName={draft.title.trim() || ""}
          initialSetName={draft.set_name.trim() || ""}
          disabled={saving || applyingCard}
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-ink">Card name</span>
            <input
              value={draft.title}
              readOnly={cardLocked}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
              className={lockedFieldClassName}
              placeholder="e.g. Pikachu ex"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-ink">Set</span>
            <input
              value={draft.set_name}
              readOnly={cardLocked}
              onChange={(event) =>
                setDraft({ ...draft, set_name: event.target.value })
              }
              className={lockedFieldClassName}
              placeholder="e.g. Ascended Heroes"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-ink">Card number</span>
            <input
              value={draft.card_number}
              readOnly={cardLocked}
              onChange={(event) =>
                setDraft({ ...draft, card_number: event.target.value })
              }
              className={lockedFieldClassName}
              placeholder="e.g. 277/297"
            />
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-sm font-semibold text-ink">Damage tags</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {DAMAGE_TAGS.map((tag) => {
                const checked = draft.damage_tags.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => {
                      const next = checked
                        ? draft.damage_tags.filter((id) => id !== tag.id)
                        : [...draft.damage_tags, tag.id];
                      setDraft({
                        ...draft,
                        damage_tags: normalizeDamageTags(next),
                      });
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors duration-150 ${
                      checked
                        ? "border-blush/45 bg-blush/20 text-ink ring-1 ring-blush/25"
                        : "border-ink/10 bg-ink/[0.03] text-ink hover:border-blush/35 hover:bg-blush/10"
                    }`}
                  >
                    {tag.label}
                  </button>
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

        {(selected || draft) && (
          <div className="mt-5">
            <ThumbnailUpload
              previewUrl={
                selected?.urls?.thumbnail ||
                (selectedCard?.id === selected?.tcg_card_id
                  ? tcgCardImageUrl(selectedCard)
                  : null)
              }
              previewCacheKey={
                selected?.updated_at ||
                selected?.tcg_card_id ||
                selectedCard?.id ||
                null
              }
              stagedFile={stagedThumbnail}
              uploading={saving || applyingCard}
              onStage={setStagedThumbnail}
              onClear={() => {
                if (stagedThumbnail) {
                  setStagedThumbnail(null);
                  return;
                }
                if (selected) handleClearThumbnail();
              }}
            />
          </div>
        )}

        {selected && (
          <div className="mt-5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45">
                Before / after pairs
              </h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleAddPair("image")}
                  className={secondaryButtonClassName()}
                >
                  + Image pair
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleAddPair("video")}
                  className={secondaryButtonClassName()}
                >
                  + Video pair
                </button>
              </div>
            </div>

            {(selected.pairs ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-ink/15 px-3 py-4 text-center text-sm text-ink/50">
                No pairs yet. Add an image or video pair.
              </p>
            ) : (
              (selected.pairs ?? []).map((pair, index) => (
                <div
                  key={pair.id}
                  className="rounded-lg border border-ink/10 bg-ink/[0.02] p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">
                      Pair {index + 1}
                      <span className="ml-2 font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-ink/45">
                        {pair.media_kind || "image"}
                        {index === 0 ? " · featured" : ""}
                      </span>
                    </p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={reordering || index === 0}
                        onClick={() => handleMovePair(index, -1)}
                        className={secondaryButtonClassName()}
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
                        className={secondaryButtonClassName()}
                        aria-label="Move pair down"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleDeletePair(pair.id)}
                        className={dangerButtonClassName()}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <label className="mb-2 block">
                    <span className="sr-only">
                      Caption (optional)
                    </span>
                    <input
                      value={captionDrafts[pair.id] ?? pair.caption ?? ""}
                      onChange={(event) =>
                        setCaptionDrafts((current) => ({
                          ...current,
                          [pair.id]: event.target.value,
                        }))
                      }
                      className={fieldClassName()}
                      placeholder="Caption (optional)"
                    />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
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
          <p className="mt-4 rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2 text-sm text-ink/65">
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
            className={`${primaryButtonClassName()} ${
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
              className={dangerButtonClassName()}
            >
              Delete
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={
              saving ||
              !items.some((item) => !item.urls?.thumbnail && item.tcg_card_id)
            }
            onClick={handleGenerateAllMissingThumbnails}
            className={secondaryButtonClassName()}
          >
            Generate missing thumbnails
          </button>
          <button
            type="button"
            onClick={startCreate}
            className={primaryButtonClassName()}
          >
            New gallery item
          </button>
        </div>
      </div>

      {listError && (
        <p className="rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-sm text-berry">
          {listError}
        </p>
      )}

      {draft && !selected && renderEditor()}

      <div className="order-last">
        {loading ? (
          <LoadingIndicator label="Loading gallery…" />
        ) : items.length === 0 && !draft ? (
          <p className="rounded-lg border border-dashed border-ink/20 px-4 py-10 text-center text-sm text-ink/50">
            No gallery items yet. Click “New gallery item” to add your first restoration.
          </p>
        ) : (
          <ul className="divide-y divide-ink/10 rounded-lg border border-ink/10">
            {items.map((item) => {
              const isOpen = selectedId === item.id;
              return (
                <li
                  key={item.id}
                  className={`px-3 py-3 transition ${
                    isOpen ? "bg-ink/[0.04]" : "hover:bg-ink/[0.02]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        isOpen ? closeEditor() : openItem(item)
                      }
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="text-base font-semibold text-ink">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-ink/55">
                        {item.created_at
                          ? `${formatPostedRelative(item.created_at)} · `
                          : ""}
                        {item.set_name ? `${item.set_name} · ` : ""}
                        {item.card_number ? `#${item.card_number} · ` : ""}
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

                    {item.urls?.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={
                          galleryThumbPublicUrl(item.urls.thumbnail) ||
                          item.urls.thumbnail
                        }
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className={`w-9 rounded ${CARD_THUMB_ASPECT_CLASS} ${CARD_THUMB_IMAGE_CLASS} bg-night/10`}
                      />
                    ) : item.pairs?.[0]?.urls?.before ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={
                          (item.pairs[0].media_kind === "video" ||
                          item.pairs[0].mediaKind === "video"
                            ? galleryPosterPublicUrl(item.pairs[0].urls.before)
                            : galleryThumbPublicUrl(item.pairs[0].urls.before)) ||
                          item.pairs[0].urls.before
                        }
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-12 w-9 rounded object-cover"
                      />
                    ) : null}
                  </div>

                  {isOpen && (
                    <div className="mt-4">{renderEditor()}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

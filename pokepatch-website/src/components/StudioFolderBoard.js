"use client";

import { useEffect, useRef, useState } from "react";

const PAIRS_PER_POST = 2;
const DRAG_TYPE = "text/pokepatch-after-id";

function isImage(file) {
  return file.type.startsWith("image/");
}

/**
 * Build the before-driven rows: one row per before image, in upload order, with
 * the after the user has matched to it (or null). Afters are matched one-to-one.
 */
export function buildPairs(beforeItems, afterItems, afterByBefore) {
  return beforeItems.map((before) => {
    const afterId = afterByBefore[before.id] ?? null;
    const after = afterId
      ? afterItems.find((item) => item.id === afterId) ?? null
      : null;
    return { id: before.id, before, after };
  });
}

function fileFromEntry(entry) {
  return new Promise((resolve) => entry.file(resolve, () => resolve(null)));
}

async function readDirectory(entry) {
  const reader = entry.createReader();
  const readBatch = () =>
    new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));

  const entries = [];
  let batch = await readBatch();
  while (batch.length) {
    entries.push(...batch);
    batch = await readBatch();
  }

  const files = [];
  for (const child of entries) {
    if (child.isFile) {
      const file = await fileFromEntry(child);
      if (file) files.push(file);
    } else if (child.isDirectory) {
      files.push(...(await readDirectory(child)));
    }
  }
  return files;
}

async function filesFromDrop(dataTransfer) {
  const items = dataTransfer.items;
  const roots = [];
  if (items?.length && items[0].webkitGetAsEntry) {
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) roots.push(entry);
    }
  }

  if (roots.length === 0) {
    return Array.from(dataTransfer.files ?? []);
  }

  const files = [];
  for (const entry of roots) {
    if (entry.isFile) {
      const file = await fileFromEntry(entry);
      if (file) files.push(file);
    } else if (entry.isDirectory) {
      files.push(...(await readDirectory(entry)));
    }
  }
  return files;
}

function FolderDropzone({ inputId, dragging, setDragging, onAddFiles }) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.setAttribute("webkitdirectory", "");
      inputRef.current.setAttribute("directory", "");
    }
  }, []);

  async function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    const files = await filesFromDrop(event.dataTransfer);
    onAddFiles(files);
  }

  return (
    <label
      htmlFor={inputId}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-6 text-center transition ${
        dragging
          ? "border-berry bg-berry/10"
          : "border-ink/25 bg-night/40 hover:border-berry/40 hover:bg-night/60"
      }`}
    >
      <p className="text-sm text-ink/70">Drop a folder here or click to browse</p>
      <p className="text-xs text-ink/40">PNG or JPG</p>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(event) => {
          onAddFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </label>
  );
}

export default function StudioFolderBoard({
  beforeItems,
  afterItems,
  setBeforeItems,
  setAfterItems,
  afterByBefore,
  setAfterByBefore,
  onError,
}) {
  const [previewUrls, setPreviewUrls] = useState({});
  const [beforeDragging, setBeforeDragging] = useState(false);
  const [afterDragging, setAfterDragging] = useState(false);
  const [activeRow, setActiveRow] = useState(null);

  useEffect(() => {
    const urls = Object.fromEntries(
      [...beforeItems, ...afterItems].map((item) => [
        item.id,
        URL.createObjectURL(item.file),
      ]),
    );
    setPreviewUrls(urls);
    return () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [beforeItems, afterItems]);

  const pairs = buildPairs(beforeItems, afterItems, afterByBefore);
  const usedAfterIds = new Set(Object.values(afterByBefore));
  const availableAfter = afterItems.filter((item) => !usedAfterIds.has(item.id));
  const matchedCount = pairs.filter((pair) => pair.after).length;
  const postCount = Math.ceil(matchedCount / PAIRS_PER_POST);

  function addBefore(fileList) {
    const images = Array.from(fileList).filter(isImage);
    if (images.length === 0) {
      onError("No images found in that folder.");
      return;
    }
    setBeforeItems((prev) => [
      ...prev,
      ...images.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
    onError("");
  }

  function addAfter(fileList) {
    const images = Array.from(fileList).filter(isImage);
    if (images.length === 0) {
      onError("No images found in that folder.");
      return;
    }
    setAfterItems((prev) => [
      ...prev,
      ...images.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
    onError("");
  }

  function removeBefore(beforeId) {
    setBeforeItems((prev) => prev.filter((item) => item.id !== beforeId));
    setAfterByBefore((prev) => {
      const next = { ...prev };
      delete next[beforeId];
      return next;
    });
  }

  function clearBefore() {
    setBeforeItems([]);
    setAfterByBefore({});
  }

  function removeAfter(afterId) {
    setAfterItems((prev) => prev.filter((item) => item.id !== afterId));
    setAfterByBefore((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([, value]) => value !== afterId),
      ),
    );
  }

  function clearAfter() {
    setAfterItems([]);
    setAfterByBefore({});
  }

  function matchAfter(beforeId, afterId) {
    if (!afterItems.some((item) => item.id === afterId)) return;
    setAfterByBefore((prev) => {
      const next = {};
      for (const [key, value] of Object.entries(prev)) {
        if (value !== afterId) next[key] = value;
      }
      next[beforeId] = afterId;
      return next;
    });
    onError("");
  }

  function unmatchAfter(beforeId) {
    setAfterByBefore((prev) => {
      const next = { ...prev };
      delete next[beforeId];
      return next;
    });
  }

  function handleRowDrop(event, beforeId) {
    event.preventDefault();
    setActiveRow(null);
    const afterId = event.dataTransfer.getData(DRAG_TYPE);
    if (afterId) matchAfter(beforeId, afterId);
  }

  function startAfterDrag(event, afterId) {
    event.dataTransfer.setData(DRAG_TYPE, afterId);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-secondary text-sm font-semibold text-blush/90">
              Before folder
            </p>
            {beforeItems.length > 0 && (
              <button
                type="button"
                onClick={clearBefore}
                className="text-xs font-semibold text-berry/90 hover:text-berry"
              >
                Clear ({beforeItems.length})
              </button>
            )}
          </div>
          <FolderDropzone
            inputId="grid-before-folder"
            dragging={beforeDragging}
            setDragging={setBeforeDragging}
            onAddFiles={addBefore}
          />
          <p className="text-xs text-ink/40">
            Each before becomes a row below — drag an after onto it to match.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-secondary text-sm font-semibold text-blush/90">
              After folder
            </p>
            {afterItems.length > 0 && (
              <button
                type="button"
                onClick={clearAfter}
                className="text-xs font-semibold text-berry/90 hover:text-berry"
              >
                Clear ({afterItems.length})
              </button>
            )}
          </div>
          <FolderDropzone
            inputId="grid-after-folder"
            dragging={afterDragging}
            setDragging={setAfterDragging}
            onAddFiles={addAfter}
          />
        </div>
      </div>

      <div className="sticky top-0 z-20 space-y-2 rounded-xl border border-ink/15 bg-night/95 p-3 shadow-cozy-sm backdrop-blur">
        <div className="flex items-center justify-between">
          <p className="font-secondary text-sm font-semibold text-blush/90">
            After bank
          </p>
          <p className="text-xs text-ink/50">Drag onto a row to match →</p>
        </div>
        <div className="max-h-40 overflow-y-auto">
          {availableAfter.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {availableAfter.map((item) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(event) => startAfterDrag(event, item.id)}
                  className="group relative w-16 shrink-0 cursor-grab active:cursor-grabbing"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrls[item.id]}
                    alt={item.file.name}
                    className="aspect-[3/4] w-full rounded-md border border-ink/15 bg-night/60 object-contain p-0.5"
                    draggable={false}
                  />
                  <button
                    type="button"
                    onClick={() => removeAfter(item.id)}
                    className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-berry text-[10px] font-bold text-night group-hover:flex"
                    aria-label={`Remove ${item.file.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="flex h-full min-h-[4rem] items-center justify-center text-center text-xs text-ink/40">
              {afterItems.length > 0
                ? "All afters matched — drag one onto a different row to move it"
                : "Upload the after folder above"}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-secondary text-sm font-semibold text-blush/90">
            Match afters to befores
          </p>
          <p className="text-xs text-ink/50">
            {matchedCount}/{pairs.length} matched → {postCount} image
            {postCount === 1 ? "" : "s"} (2 pairs per 2×2)
          </p>
        </div>

        {pairs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink/15 bg-night/30 px-3 py-10 text-center text-sm text-ink/40">
            Upload a before folder to start building rows.
          </p>
        ) : (
          <div className="space-y-4">
            {pairs.map((pair, index) => {
              const postIndex = Math.floor(index / PAIRS_PER_POST);
              const showPostHeading = index % PAIRS_PER_POST === 0;
              const isActive = activeRow === pair.id;

              return (
                <div key={pair.id} className="space-y-2">
                  {showPostHeading && (
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                      Post {postIndex + 1} · 2×2
                    </p>
                  )}
                  <div className="rounded-xl border border-ink/10 bg-night/40 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="font-secondary text-xs font-semibold text-blush/80">
                        Pair {index + 1}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeBefore(pair.before.id)}
                        className="text-xs font-semibold text-berry/90 hover:text-berry"
                      >
                        Remove row
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="overflow-hidden rounded-xl border border-ink/15 bg-night/50">
                        <p className="border-b border-ink/10 px-3 py-2 font-secondary text-xs font-semibold uppercase tracking-wide text-blush/80">
                          Before
                        </p>
                        <div className="p-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={previewUrls[pair.before.id]}
                            alt="Before preview"
                            className="mx-auto max-h-36 w-full object-contain"
                          />
                          <p className="mt-2 truncate text-xs text-ink/50">
                            {pair.before.file.name}
                          </p>
                        </div>
                      </div>

                      <div
                        onDragOver={(event) => {
                          event.preventDefault();
                          setActiveRow(pair.id);
                        }}
                        onDragLeave={() =>
                          setActiveRow((prev) =>
                            prev === pair.id ? null : prev,
                          )
                        }
                        onDrop={(event) => handleRowDrop(event, pair.id)}
                        className={`overflow-hidden rounded-xl border bg-night/50 transition ${
                          isActive
                            ? "border-berry bg-berry/10"
                            : pair.after
                              ? "border-ink/15"
                              : "border-dashed border-ink/10"
                        }`}
                      >
                        <p className="border-b border-ink/10 px-3 py-2 font-secondary text-xs font-semibold uppercase tracking-wide text-blush/80">
                          After
                        </p>
                        {pair.after ? (
                          <div
                            draggable
                            onDragStart={(event) =>
                              startAfterDrag(event, pair.after.id)
                            }
                            className="cursor-grab p-3 active:cursor-grabbing"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={previewUrls[pair.after.id]}
                              alt="After preview"
                              className="mx-auto max-h-36 w-full object-contain"
                              draggable={false}
                            />
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <p className="truncate text-xs text-ink/50">
                                {pair.after.file.name}
                              </p>
                              <button
                                type="button"
                                onClick={() => unmatchAfter(pair.id)}
                                className="shrink-0 text-xs font-semibold text-berry/90 hover:text-berry"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="px-3 py-10 text-center text-xs text-ink/30">
                            Drag an after here
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

const PAIRS_PER_POST = 2;

function isPng(file) {
  return file.type === "image/png";
}

function sortByName(items) {
  return [...items].sort((a, b) =>
    a.file.name.localeCompare(b.file.name, undefined, { numeric: true }),
  );
}

/**
 * Pair a "before" folder with an "after" folder. Files are matched by filename
 * first (so matching names line up regardless of upload order), then any
 * leftovers are paired positionally in sorted order. Returns the ordered pairs
 * plus any files that could not be matched.
 */
export function pairFolders(beforeItems, afterItems) {
  const sortedBefore = sortByName(beforeItems);
  const sortedAfter = sortByName(afterItems);

  const afterByName = new Map();
  for (const item of sortedAfter) {
    const list = afterByName.get(item.file.name) ?? [];
    list.push(item);
    afterByName.set(item.file.name, list);
  }

  const usedAfterIds = new Set();
  const pairs = [];
  const unmatchedBefore = [];

  for (const before of sortedBefore) {
    const candidates = afterByName.get(before.file.name);
    const match = candidates?.find((item) => !usedAfterIds.has(item.id));
    if (match) {
      usedAfterIds.add(match.id);
      pairs.push({ id: `${before.id}:${match.id}`, before, after: match });
    } else {
      unmatchedBefore.push(before);
    }
  }

  const unmatchedAfter = sortedAfter.filter((item) => !usedAfterIds.has(item.id));
  const positional = Math.min(unmatchedBefore.length, unmatchedAfter.length);
  for (let i = 0; i < positional; i += 1) {
    const before = unmatchedBefore[i];
    const after = unmatchedAfter[i];
    pairs.push({ id: `${before.id}:${after.id}`, before, after });
  }

  return {
    pairs,
    unpairedBefore: unmatchedBefore.slice(positional),
    unpairedAfter: unmatchedAfter.slice(positional),
  };
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

function ThumbStrip({ items, previewUrls, onRemove }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <div key={item.id} className="group relative w-16 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrls[item.id]}
            alt={item.file.name}
            className="aspect-[3/4] w-full rounded-md border border-ink/15 bg-night/60 object-contain p-0.5"
          />
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-berry text-[10px] font-bold text-night group-hover:flex"
            aria-label={`Remove ${item.file.name}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function FolderDropzone({
  title,
  inputId,
  items,
  previewUrls,
  onAddFiles,
  onRemove,
  onClear,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-secondary text-sm font-semibold text-blush/90">
          {title}
        </p>
        {items.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-semibold text-berry/90 hover:text-berry"
          >
            Clear ({items.length})
          </button>
        )}
      </div>

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
        <p className="text-xs text-ink/40">PNGs only</p>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/png"
          multiple
          className="sr-only"
          onChange={(event) => {
            onAddFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </label>

      {items.length > 0 && (
        <ThumbStrip items={items} previewUrls={previewUrls} onRemove={onRemove} />
      )}
    </div>
  );
}

function PairPreview({ pair, index, previewUrls, onRemove }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-night/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-secondary text-xs font-semibold text-blush/80">
          Pair {index + 1}
        </p>
        <button
          type="button"
          onClick={() => onRemove(pair)}
          className="text-xs font-semibold text-berry/90 hover:text-berry"
        >
          Remove pair
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          { role: "before", label: "Before", item: pair.before },
          { role: "after", label: "After", item: pair.after },
        ].map(({ role, label, item }) => (
          <div
            key={role}
            className="overflow-hidden rounded-xl border border-ink/15 bg-night/50"
          >
            <p className="border-b border-ink/10 px-3 py-2 font-secondary text-xs font-semibold uppercase tracking-wide text-blush/80">
              {label}
            </p>
            <div className="p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrls[item.id]}
                alt={`${label} preview`}
                className="mx-auto max-h-36 w-full object-contain"
              />
              <p className="mt-2 truncate text-xs text-ink/50">
                {item.file.name}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StudioFolderBoard({
  beforeItems,
  afterItems,
  setBeforeItems,
  setAfterItems,
  pairs,
  unpairedBefore,
  unpairedAfter,
  onError,
}) {
  const [previewUrls, setPreviewUrls] = useState({});

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

  function addFiles(setItems, fileList) {
    const pngs = fileList.filter(isPng);
    if (pngs.length === 0) {
      onError("No PNG images found in that folder.");
      return;
    }
    setItems((prev) => [
      ...prev,
      ...pngs.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
    onError("");
  }

  function removeItem(setItems, id) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  function removePair(pair) {
    setBeforeItems((prev) => prev.filter((item) => item.id !== pair.before.id));
    setAfterItems((prev) => prev.filter((item) => item.id !== pair.after.id));
  }

  const postCount = Math.ceil(pairs.length / PAIRS_PER_POST);
  const unpairedCount = unpairedBefore.length + unpairedAfter.length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <FolderDropzone
          title="Before folder"
          inputId="grid-before-folder"
          items={beforeItems}
          previewUrls={previewUrls}
          onAddFiles={(files) => addFiles(setBeforeItems, files)}
          onRemove={(id) => removeItem(setBeforeItems, id)}
          onClear={() => setBeforeItems([])}
        />
        <FolderDropzone
          title="After folder"
          inputId="grid-after-folder"
          items={afterItems}
          previewUrls={previewUrls}
          onAddFiles={(files) => addFiles(setAfterItems, files)}
          onRemove={(id) => removeItem(setAfterItems, id)}
          onClear={() => setAfterItems([])}
        />
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-secondary text-sm font-semibold text-blush/90">
            Auto-paired preview
          </p>
          <p className="text-xs text-ink/50">
            {pairs.length} pair{pairs.length === 1 ? "" : "s"} → {postCount}{" "}
            image{postCount === 1 ? "" : "s"} (2 pairs per 2×2)
          </p>
        </div>

        {unpairedCount > 0 && (
          <p className="rounded-lg border border-berry/40 bg-berry/10 px-3 py-2 text-xs text-berry">
            {unpairedCount} image{unpairedCount === 1 ? "" : "s"} could not be
            paired ({unpairedBefore.length} before, {unpairedAfter.length}{" "}
            after). Match the folders by filename or count.
          </p>
        )}

        {pairs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink/15 bg-night/30 px-3 py-10 text-center text-sm text-ink/40">
            Upload a before folder and an after folder to build pairs.
          </p>
        ) : (
          <div className="space-y-4">
            {pairs.map((pair, index) => {
              const postIndex = Math.floor(index / PAIRS_PER_POST);
              const showPostHeading = index % PAIRS_PER_POST === 0;
              return (
                <div key={pair.id} className="space-y-2">
                  {showPostHeading && (
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                      Post {postIndex + 1} · 2×2
                    </p>
                  )}
                  <PairPreview
                    pair={pair}
                    index={index}
                    previewUrls={previewUrls}
                    onRemove={removePair}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

const PAIRS_PER_POST = 2;
const DRAG_TYPE = "text/pokepatch-pair-item";
const ROLES = [
  { key: "before", label: "Before" },
  { key: "after", label: "After" },
];

export function createPair() {
  return { id: crypto.randomUUID(), before: null, after: null };
}

function isImage(file) {
  return file.type.startsWith("image/");
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

function setDragItem(event, role, id) {
  event.dataTransfer.setData(DRAG_TYPE, `${role}:${id}`);
  event.dataTransfer.effectAllowed = "move";
}

function readDragItem(event) {
  const raw = event.dataTransfer.getData(DRAG_TYPE);
  if (!raw) return null;
  const separator = raw.indexOf(":");
  return { role: raw.slice(0, separator), id: raw.slice(separator + 1) };
}

function SideBank({
  role,
  title,
  totalCount,
  availableItems,
  previewUrls,
  onAddFiles,
  onRemoveItem,
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
    <div className="flex w-full shrink-0 flex-col gap-2 lg:sticky lg:top-0 lg:h-screen lg:w-52 lg:py-4">
      <div className="flex items-center justify-between">
        <p className="font-secondary text-sm font-semibold text-blush/90">
          {title}
        </p>
        {totalCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-semibold text-berry/90 hover:text-berry"
          >
            Clear ({totalCount})
          </button>
        )}
      </div>

      <label
        htmlFor={`grid-${role}-folder`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center gap-0.5 rounded-xl border border-dashed px-3 py-4 text-center transition ${
          dragging
            ? "border-berry bg-berry/10"
            : "border-ink/25 bg-night/40 hover:border-berry/40 hover:bg-night/60"
        }`}
      >
        <p className="text-xs text-ink/70">Drop folder or browse</p>
        <p className="text-[10px] text-ink/40">PNG or JPG</p>
        <input
          id={`grid-${role}-folder`}
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

      <div className="min-h-[5rem] max-h-56 flex-1 overflow-y-auto rounded-xl border border-dashed border-ink/15 bg-night/30 p-2 lg:max-h-none">
        {availableItems.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {availableItems.map((item) => (
              <div
                key={item.id}
                draggable
                onDragStart={(event) => setDragItem(event, role, item.id)}
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
                  onClick={() => onRemoveItem(item.id)}
                  className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-berry text-[10px] font-bold text-night group-hover:flex"
                  aria-label={`Remove ${item.file.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="flex h-full min-h-[4rem] items-center justify-center px-2 text-center text-xs text-ink/40">
            {totalCount > 0
              ? "All placed — drag one back into a slot to swap"
              : `Upload the ${role} folder`}
          </p>
        )}
      </div>
    </div>
  );
}

function PairSlot({
  role,
  label,
  item,
  previewUrl,
  active,
  onActivate,
  onDeactivate,
  onDrop,
  onDragStartFilled,
  onClear,
}) {
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        onActivate();
      }}
      onDragLeave={onDeactivate}
      onDrop={onDrop}
      className={`overflow-hidden rounded-xl border bg-night/50 transition ${
        active
          ? "border-berry bg-berry/10"
          : item
            ? "border-ink/15"
            : "border-dashed border-ink/10"
      }`}
    >
      <p className="border-b border-ink/10 px-3 py-2 font-secondary text-xs font-semibold uppercase tracking-wide text-blush/80">
        {label}
      </p>
      {item && previewUrl ? (
        <div
          draggable
          onDragStart={onDragStartFilled}
          className="cursor-grab p-3 active:cursor-grabbing"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={`${label} preview`}
            className="mx-auto max-h-36 w-full object-contain"
            draggable={false}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-ink/50">{item.file.name}</p>
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 text-xs font-semibold text-berry/90 hover:text-berry"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <p className="px-3 py-10 text-center text-xs text-ink/30">
          Drop {role} here
        </p>
      )}
    </div>
  );
}

export default function StudioFolderBoard({
  beforeItems,
  afterItems,
  setBeforeItems,
  setAfterItems,
  pairs,
  setPairs,
  onError,
}) {
  const [previewUrls, setPreviewUrls] = useState({});
  const [activeSlot, setActiveSlot] = useState(null);

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

  const itemsByRole = { before: beforeItems, after: afterItems };
  const settersByRole = { before: setBeforeItems, after: setAfterItems };

  function findItem(role, id) {
    return itemsByRole[role].find((item) => item.id === id) ?? null;
  }

  function availableItems(role) {
    return itemsByRole[role].filter(
      (item) => !pairs.some((pair) => pair[role] === item.id),
    );
  }

  function addFiles(role, fileList) {
    const images = Array.from(fileList).filter(isImage);
    if (images.length === 0) {
      onError("No images found in that folder.");
      return;
    }
    settersByRole[role]((prev) => [
      ...prev,
      ...images.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
    onError("");
  }

  function removeFolderItem(role, id) {
    settersByRole[role]((prev) => prev.filter((item) => item.id !== id));
    setPairs((prev) =>
      prev.map((pair) => (pair[role] === id ? { ...pair, [role]: null } : pair)),
    );
  }

  function clearFolder(role) {
    settersByRole[role]([]);
    setPairs((prev) => prev.map((pair) => ({ ...pair, [role]: null })));
  }

  function assignToSlot(pairId, role, id) {
    if (!findItem(role, id)) return;
    setPairs((prev) =>
      prev.map((pair) => {
        const cleared = pair[role] === id ? { ...pair, [role]: null } : pair;
        return cleared.id === pairId ? { ...cleared, [role]: id } : cleared;
      }),
    );
    onError("");
  }

  function clearSlot(pairId, role) {
    setPairs((prev) =>
      prev.map((pair) =>
        pair.id === pairId ? { ...pair, [role]: null } : pair,
      ),
    );
  }

  function addPair() {
    setPairs((prev) => [...prev, createPair()]);
  }

  function removePair(pairId) {
    setPairs((prev) => {
      const next = prev.filter((pair) => pair.id !== pairId);
      return next.length ? next : [createPair()];
    });
  }

  function handleSlotDrop(event, pairId, role) {
    event.preventDefault();
    setActiveSlot(null);
    const dragged = readDragItem(event);
    if (dragged && dragged.role === role) {
      assignToSlot(pairId, role, dragged.id);
    }
  }

  const completePairs = pairs.filter((pair) => pair.before && pair.after);
  const postCount = Math.ceil(completePairs.length / PAIRS_PER_POST);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
      <SideBank
        role="before"
        title="Before bank"
        totalCount={beforeItems.length}
        availableItems={availableItems("before")}
        previewUrls={previewUrls}
        onAddFiles={(files) => addFiles("before", files)}
        onRemoveItem={(id) => removeFolderItem("before", id)}
        onClear={() => clearFolder("before")}
      />

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-secondary text-sm font-semibold text-blush/90">
            Pair before &amp; after
          </p>
          <p className="text-xs text-ink/50">
            {completePairs.length} pair{completePairs.length === 1 ? "" : "s"} →{" "}
            {postCount} image{postCount === 1 ? "" : "s"} (2 pairs per 2×2)
          </p>
        </div>

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
                <div className="rounded-xl border border-ink/10 bg-night/40 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-secondary text-xs font-semibold text-blush/80">
                      Pair {index + 1}
                    </p>
                    <button
                      type="button"
                      onClick={() => removePair(pair.id)}
                      className="text-xs font-semibold text-berry/90 hover:text-berry"
                    >
                      Remove pair
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {ROLES.map(({ key: role, label }) => {
                      const item = findItem(role, pair[role]);
                      const slotKey = `${pair.id}:${role}`;
                      return (
                        <PairSlot
                          key={role}
                          role={role}
                          label={label}
                          item={item}
                          previewUrl={item ? previewUrls[item.id] : null}
                          active={activeSlot === slotKey}
                          onActivate={() => setActiveSlot(slotKey)}
                          onDeactivate={() =>
                            setActiveSlot((prev) =>
                              prev === slotKey ? null : prev,
                            )
                          }
                          onDrop={(event) => handleSlotDrop(event, pair.id, role)}
                          onDragStartFilled={(event) =>
                            item && setDragItem(event, role, item.id)
                          }
                          onClear={() => clearSlot(pair.id, role)}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={addPair}
          className="w-full rounded-xl border border-dashed border-ink/25 bg-night/40 px-4 py-3 font-secondary text-sm font-semibold text-blush/90 transition hover:border-berry/40 hover:bg-night/60 hover:text-ink"
        >
          + Add pair
        </button>
      </div>

      <SideBank
        role="after"
        title="After bank"
        totalCount={afterItems.length}
        availableItems={availableItems("after")}
        previewUrls={previewUrls}
        onAddFiles={(files) => addFiles("after", files)}
        onRemoveItem={(id) => removeFolderItem("after", id)}
        onClear={() => clearFolder("after")}
      />
    </div>
  );
}

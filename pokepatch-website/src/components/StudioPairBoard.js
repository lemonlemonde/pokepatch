"use client";

import { useEffect, useState } from "react";

const DRAG_TYPE = "text/pokepatch-bank-id";
const PAIRS_PER_POST = 2;
const ROLES = [
  { key: "before", label: "Before" },
  { key: "after", label: "After" },
];

export function createPair() {
  return { id: crypto.randomUUID(), before: null, after: null };
}

function pickPngFiles(fileList) {
  return Array.from(fileList).filter((file) => file.type === "image/png");
}

function BankThumbnail({ item, previewUrl, onRemove }) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, item.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className="group relative w-24 shrink-0 cursor-grab active:cursor-grabbing"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={previewUrl}
        alt={item.file.name}
        className="aspect-[3/4] w-full rounded-lg border border-ink/15 bg-night/60 object-contain p-1"
        draggable={false}
      />
      <p className="mt-1 truncate text-[10px] text-ink/50">{item.file.name}</p>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-berry text-xs font-bold text-night group-hover:flex"
        aria-label={`Remove ${item.file.name}`}
      >
        ×
      </button>
    </div>
  );
}

export default function StudioPairBoard({
  bank,
  setBank,
  pairs,
  setPairs,
  onError,
}) {
  const [uploadDragging, setUploadDragging] = useState(false);
  const [bankDragging, setBankDragging] = useState(false);
  const [activeSlot, setActiveSlot] = useState(null);
  const [previewUrls, setPreviewUrls] = useState({});

  const placedIds = new Set();
  for (const pair of pairs) {
    if (pair.before) placedIds.add(pair.before);
    if (pair.after) placedIds.add(pair.after);
  }
  const availableBank = bank.filter((item) => !placedIds.has(item.id));

  useEffect(() => {
    const urls = Object.fromEntries(
      bank.map((item) => [item.id, URL.createObjectURL(item.file)]),
    );
    setPreviewUrls(urls);
    return () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [bank]);

  function addToBank(fileList) {
    const files = pickPngFiles(fileList);
    if (files.length === 0) {
      onError("Only PNG images are supported.");
      return;
    }
    const newItems = files.map((file) => ({ id: crypto.randomUUID(), file }));
    setBank((prev) => [...prev, ...newItems]);
    onError("");
  }

  function assignToSlot(pairId, role, bankId) {
    if (!bank.some((item) => item.id === bankId)) return;
    setPairs((prev) =>
      prev.map((pair) => {
        const next = { ...pair };
        if (next.before === bankId) next.before = null;
        if (next.after === bankId) next.after = null;
        if (pair.id === pairId) next[role] = bankId;
        return next;
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

  function returnToBank(bankId) {
    setPairs((prev) =>
      prev.map((pair) => ({
        ...pair,
        before: pair.before === bankId ? null : pair.before,
        after: pair.after === bankId ? null : pair.after,
      })),
    );
  }

  function removeFromBank(bankId) {
    setBank((prev) => prev.filter((item) => item.id !== bankId));
    returnToBank(bankId);
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

  function readDragId(event) {
    return event.dataTransfer.getData(DRAG_TYPE);
  }

  function handleUploadDrop(event) {
    event.preventDefault();
    setUploadDragging(false);
    addToBank(event.dataTransfer.files);
  }

  function handleBankDrop(event) {
    event.preventDefault();
    setBankDragging(false);
    const bankId = readDragId(event);
    if (bankId) returnToBank(bankId);
  }

  function handleSlotDrop(event, pairId, role) {
    event.preventDefault();
    setActiveSlot(null);
    const bankId = readDragId(event);
    if (bankId) assignToSlot(pairId, role, bankId);
  }

  function handlePaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.type === "image/png") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      addToBank(files);
    }
  }

  const completePairs = pairs.filter((pair) => pair.before && pair.after);
  const postCount = Math.ceil(completePairs.length / PAIRS_PER_POST);

  return (
    <div className="space-y-6" onPaste={handlePaste}>
      <div className="space-y-3">
        <p className="font-secondary text-sm font-semibold text-blush/90">
          Image bank
        </p>
        <label
          htmlFor="grid-images"
          onDragOver={(event) => {
            event.preventDefault();
            setUploadDragging(true);
          }}
          onDragLeave={() => setUploadDragging(false)}
          onDrop={handleUploadDrop}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-8 transition ${
            uploadDragging
              ? "border-berry bg-berry/10"
              : "border-ink/25 bg-night/40 hover:border-berry/40 hover:bg-night/60"
          }`}
        >
          <p className="text-sm text-ink/70">
            Drop PNGs here, click to browse, or paste
          </p>
          <input
            id="grid-images"
            type="file"
            accept="image/png"
            multiple
            className="sr-only"
            onChange={(event) => {
              if (event.target.files?.length) addToBank(event.target.files);
              event.target.value = "";
            }}
          />
        </label>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setBankDragging(true);
          }}
          onDragLeave={() => setBankDragging(false)}
          onDrop={handleBankDrop}
          className={`min-h-[7rem] rounded-xl border border-dashed p-3 transition ${
            bankDragging ? "border-berry bg-berry/10" : "border-ink/15 bg-night/30"
          }`}
        >
          {availableBank.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {availableBank.map((item) => (
                <BankThumbnail
                  key={item.id}
                  item={item}
                  previewUrl={previewUrls[item.id]}
                  onRemove={removeFromBank}
                />
              ))}
            </div>
          ) : (
            <p className="flex h-full min-h-[5rem] items-center justify-center text-center text-sm text-ink/40">
              {bank.length > 0
                ? "All images paired — drag one back here to swap"
                : "Uploaded images appear here"}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4">
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
                      const bankId = pair[role];
                      const item = bank.find((entry) => entry.id === bankId);
                      const preview = bankId ? previewUrls[bankId] : null;
                      const slotKey = `${pair.id}:${role}`;
                      const isActive = activeSlot === slotKey;

                      return (
                        <div
                          key={role}
                          onDragOver={(event) => {
                            event.preventDefault();
                            setActiveSlot(slotKey);
                          }}
                          onDragLeave={() =>
                            setActiveSlot((prev) =>
                              prev === slotKey ? null : prev,
                            )
                          }
                          onDrop={(event) =>
                            handleSlotDrop(event, pair.id, role)
                          }
                          className={`overflow-hidden rounded-xl border bg-night/50 transition ${
                            isActive
                              ? "border-berry bg-berry/10"
                              : item
                                ? "border-ink/15"
                                : "border-dashed border-ink/10"
                          }`}
                        >
                          <p className="border-b border-ink/10 px-3 py-2 font-secondary text-xs font-semibold uppercase tracking-wide text-blush/80">
                            {label}
                          </p>
                          {item && preview ? (
                            <div
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.setData(DRAG_TYPE, item.id);
                                event.dataTransfer.effectAllowed = "move";
                              }}
                              className="cursor-grab p-3 active:cursor-grabbing"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={preview}
                                alt={`${label} preview`}
                                className="mx-auto max-h-36 w-full object-contain"
                                draggable={false}
                              />
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <p className="truncate text-xs text-ink/50">
                                  {item.file.name}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => clearSlot(pair.id, role)}
                                  className="shrink-0 text-xs font-semibold text-berry/90 hover:text-berry"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="px-3 py-10 text-center text-xs text-ink/30">
                              Drop image here
                            </p>
                          )}
                        </div>
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
    </div>
  );
}

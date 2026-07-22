"use client";

import { useEffect, useState } from "react";
import StudioOpenableThumb from "@/components/StudioOpenableThumb";
import { StudioCroppableThumb } from "@/components/StudioCropLightbox";

export const EMPTY_SLOTS = [null, null, null, null];
const DRAG_TYPE = "text/pokepatch-bank-id";

/** Fixed Front + optional Back (video formatter). */
export const BEFORE_AFTER_PAIR_SLOT_GROUPS = [
  {
    title: "Front / Any",
    optional: false,
    slots: [
      { index: 0, label: "Before" },
      { index: 2, label: "After" },
    ],
  },
  {
    title: "Back",
    optional: true,
    slots: [
      { index: 1, label: "Before" },
      { index: 3, label: "After" },
    ],
  },
];

/** Flat slot list for N before|after rows: [b0, a0, b1, a1, …]. */
export function emptySlotsForPairRows(rowCount = 1) {
  const n = Math.max(1, rowCount);
  return Array.from({ length: n * 2 }, () => null);
}

/** Slot groups for dynamic 1×2 Before-After Pair rows. */
export function beforeAfterPairSlotGroups(rowCount = 1) {
  const n = Math.max(1, Math.floor(rowCount));
  return Array.from({ length: n }, (_, index) => ({
    title: n === 1 ? "Pair" : `Pair ${index + 1}`,
    optional: index > 0,
    removable: n > 1,
    slots: [
      { index: index * 2, label: "Before" },
      { index: index * 2 + 1, label: "After" },
    ],
  }));
}

/** Front|back for before, then after (1×2 Front-Back Pair). */
export const FRONT_BACK_PAIR_SLOT_GROUPS = [
  {
    title: "Before",
    optional: false,
    slots: [
      { index: 0, label: "Front" },
      { index: 1, label: "Back" },
    ],
  },
  {
    title: "After",
    optional: true,
    slots: [
      { index: 2, label: "Front" },
      { index: 3, label: "Back" },
    ],
  },
];

const SLOT_GROUPS = BEFORE_AFTER_PAIR_SLOT_GROUPS;

const MEDIA_CONFIG = {
  image: {
    accept: "image/*",
    bankLabel: "Image bank",
    uploadHint: "Drop images here, click to browse, or paste",
    emptyBank: "Uploaded images appear here",
    allPlaced: "All images placed — drag one back here to swap",
    dropSlot: "Drop image or thumbnail here",
    unsupportedError: "Only image files (PNG, JPG, etc.) are supported.",
    inputId: "card-images",
    pickFiles: (fileList) =>
      Array.from(fileList).filter((file) => file.type.startsWith("image/")),
    supportsPaste: true,
  },
  video: {
    accept: "video/mp4,video/quicktime,video/webm",
    bankLabel: "Video bank",
    uploadHint: "Drop videos here or click to browse",
    emptyBank: "Uploaded videos appear here",
    allPlaced: "All videos placed — drag one back here to swap",
    dropSlot: "Drop video or thumbnail here",
    unsupportedError: "Only MP4, MOV, and WebM videos are supported.",
    inputId: "card-videos",
    pickFiles: (fileList) =>
      Array.from(fileList).filter((file) => file.type.startsWith("video/")),
    supportsPaste: false,
  },
};

function createBankId() {
  return crypto.randomUUID();
}

function BankThumbnail({
  item,
  previewUrl,
  onRemove,
  mediaType,
  enableDrag = true,
}) {
  function handleDragStart(event) {
    if (!enableDrag) return;
    event.dataTransfer.setData(DRAG_TYPE, item.id);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <div
      draggable={enableDrag}
      onDragStart={handleDragStart}
      className={`group relative w-24 shrink-0 ${
        enableDrag ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      <StudioOpenableThumb
        src={previewUrl}
        alt={item.file.name}
        label={item.file.name}
        mediaType={mediaType}
      >
        {mediaType === "video" ? (
          <video
            src={previewUrl}
            muted
            playsInline
            preload="metadata"
            className="aspect-[3/4] w-full rounded-lg border border-ink/15 bg-night/60 object-contain p-1"
            draggable={false}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={item.file.name}
            className="aspect-[3/4] w-full rounded-lg border border-ink/15 bg-night/60 object-contain p-1"
            draggable={false}
          />
        )}
      </StudioOpenableThumb>
      <p className="mt-1 truncate text-[10px] text-ink/50">{item.file.name}</p>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove(item.id);
        }}
        className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-berry text-xs font-bold text-night group-hover:flex"
        aria-label={`Remove ${item.file.name}`}
      >
        ×
      </button>
    </div>
  );
}

export default function StudioMediaBank({
  mediaType,
  bank,
  setBank,
  slots = EMPTY_SLOTS,
  setSlots = null,
  onError,
  slotGroups = SLOT_GROUPS,
  hideSlots = false,
  /** When set, shows “+ Add pair” under the slot groups. */
  onAddPairRow = null,
  /** Called with pair row index (0-based) when Remove pair is clicked. */
  onRemovePairRow = null,
  /** When provided, parent owns object-URL lifecycle (e.g. annotate formatter). */
  previewUrls: controlledPreviewUrls = null,
  inputId = null,
  bankLabel = null,
}) {
  const config = MEDIA_CONFIG[mediaType];
  const fileInputId = inputId ?? config.inputId;
  const label = bankLabel ?? config.bankLabel;
  const [uploadDragging, setUploadDragging] = useState(false);
  const [bankDragging, setBankDragging] = useState(false);
  const [activeSlot, setActiveSlot] = useState(null);
  const [internalPreviewUrls, setInternalPreviewUrls] = useState({});

  const previewUrls = controlledPreviewUrls ?? internalPreviewUrls;
  const placedIds = hideSlots ? new Set() : new Set(slots.filter(Boolean));
  const availableBank = bank.filter((item) => !placedIds.has(item.id));

  useEffect(() => {
    if (controlledPreviewUrls) return undefined;
    const urls = Object.fromEntries(
      bank.map((item) => [item.id, URL.createObjectURL(item.file)]),
    );
    setInternalPreviewUrls(urls);
    return () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [bank, controlledPreviewUrls]);

  function addToBank(fileList) {
    const files = config.pickFiles(fileList);
    if (files.length === 0) {
      onError(config.unsupportedError);
      return;
    }
    const newItems = files.map((file) => ({ id: createBankId(), file }));
    setBank((prev) => [...prev, ...newItems]);
    onError("");
  }

  function assignToSlot(slotIndex, bankId) {
    if (!setSlots || !bank.some((item) => item.id === bankId)) return;

    setSlots((prev) => {
      const next = prev.map((id, index) => {
        if (index === slotIndex) return bankId;
        if (id === bankId) return null;
        return id;
      });
      return next;
    });
    onError("");
  }

  /** Add file(s) to the bank and place the first one into a slot. */
  function dropFilesIntoSlot(slotIndex, fileList) {
    if (!setSlots) return;
    const files = config.pickFiles(fileList);
    if (files.length === 0) {
      if (fileList?.length) onError(config.unsupportedError);
      return;
    }

    const primaryId = createBankId();
    const newItems = files.map((file, index) => ({
      id: index === 0 ? primaryId : createBankId(),
      file,
    }));

    setBank((prev) => [...prev, ...newItems]);
    setSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = primaryId;
      return next;
    });
    onError("");
  }

  function clearSlot(slotIndex) {
    if (!setSlots) return;
    setSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
  }

  function removeFromBank(bankId) {
    setBank((prev) => prev.filter((item) => item.id !== bankId));
    if (setSlots) {
      setSlots((prev) => prev.map((id) => (id === bankId ? null : id)));
    }
  }

  function replaceBankFile(bankId, file) {
    setBank((prev) =>
      prev.map((item) => (item.id === bankId ? { ...item, file } : item)),
    );
    onError("");
  }

  function returnToBank(bankId) {
    if (!setSlots) return;
    setSlots((prev) => prev.map((id) => (id === bankId ? null : id)));
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
    if (hideSlots) return;
    const bankId = readDragId(event);
    if (bankId) returnToBank(bankId);
  }

  function handleSlotDrop(event, slotIndex) {
    event.preventDefault();
    setActiveSlot(null);
    const bankId = readDragId(event);
    if (bankId) {
      assignToSlot(slotIndex, bankId);
      return;
    }
    if (event.dataTransfer.files?.length) {
      dropFilesIntoSlot(slotIndex, event.dataTransfer.files);
    }
  }

  function handlePaste(event) {
    if (!config.supportsPaste) return;

    const items = event.clipboardData?.items;
    if (!items) return;

    const files = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      addToBank(files);
    }
  }

  return (
    <div className="space-y-6" onPaste={handlePaste}>
      <div className="space-y-3">
        <p className="font-secondary text-sm font-semibold text-blush/90">
          {label}
        </p>
        <label
          htmlFor={fileInputId}
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
          <p className="text-sm text-ink/70">{config.uploadHint}</p>
          <input
            id={fileInputId}
            type="file"
            accept={config.accept}
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
            if (hideSlots) return;
            event.preventDefault();
            setBankDragging(true);
          }}
          onDragLeave={() => setBankDragging(false)}
          onDrop={handleBankDrop}
          className={`min-h-[7rem] rounded-xl border border-dashed p-3 transition ${
            bankDragging
              ? "border-berry bg-berry/10"
              : "border-ink/15 bg-night/30"
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
                  mediaType={mediaType}
                  enableDrag={!hideSlots}
                />
              ))}
            </div>
          ) : (
            <p className="flex h-full min-h-[5rem] items-center justify-center text-center text-sm text-ink/40">
              {bank.length > 0 && !hideSlots
                ? config.allPlaced
                : config.emptyBank}
            </p>
          )}
        </div>
      </div>

      {!hideSlots ? (
        <div className="space-y-4">
          <p className="font-secondary text-sm font-semibold text-blush/90">
            Drop into slots
          </p>
          {slotGroups.map((group, groupIndex) => (
            <div key={`${group.title}-${groupIndex}`} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                  {group.title}
                  {group.optional ? (
                    <span className="ml-1 font-normal normal-case text-ink/35">
                      (optional)
                    </span>
                  ) : null}
                </p>
                {group.removable && onRemovePairRow ? (
                  <button
                    type="button"
                    onClick={() => onRemovePairRow(groupIndex)}
                    className="text-xs font-semibold text-berry/90 hover:text-berry"
                  >
                    Remove pair
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {group.slots.map(({ index: slotIndex, label: slotLabel }) => {
                  const bankId = slots[slotIndex];
                  const item = bank.find((entry) => entry.id === bankId);
                  const preview = bankId ? previewUrls[bankId] : null;
                  const isActive = activeSlot === slotIndex;

                  return (
                    <div
                      key={slotIndex}
                      onDragOver={(event) => {
                        event.preventDefault();
                        const isFileDrag = Array.from(
                          event.dataTransfer.types,
                        ).includes("Files");
                        event.dataTransfer.dropEffect = isFileDrag
                          ? "copy"
                          : "move";
                        setActiveSlot(slotIndex);
                      }}
                      onDragLeave={() =>
                        setActiveSlot((prev) =>
                          prev === slotIndex ? null : prev,
                        )
                      }
                      onDrop={(event) => handleSlotDrop(event, slotIndex)}
                      className={`overflow-hidden rounded-xl border bg-night/50 transition ${
                        isActive
                          ? "border-berry bg-berry/10"
                          : item
                            ? "border-ink/15"
                            : "border-dashed border-ink/10"
                      }`}
                    >
                      <p className="border-b border-ink/10 px-3 py-2 font-secondary text-xs font-semibold uppercase tracking-wide text-blush/80">
                        {slotLabel}
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
                          {mediaType === "image" ? (
                            <StudioCroppableThumb
                              src={preview}
                              alt={`${group.title} ${slotLabel} — ${item.file.name}`}
                              label={`${group.title} · ${slotLabel}`}
                              originalFile={item.file}
                              onCropped={(file) =>
                                replaceBankFile(item.id, file)
                              }
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={preview}
                                alt={`${group.title} ${slotLabel} preview`}
                                className="mx-auto max-h-36 w-full object-contain"
                                draggable={false}
                              />
                            </StudioCroppableThumb>
                          ) : (
                            <StudioOpenableThumb
                              src={preview}
                              alt={`${group.title} ${slotLabel} — ${item.file.name}`}
                              label={`${group.title} · ${slotLabel}`}
                              mediaType={mediaType}
                            >
                              <video
                                src={preview}
                                muted
                                playsInline
                                preload="metadata"
                                className="mx-auto max-h-36 w-full object-contain"
                                draggable={false}
                              />
                            </StudioOpenableThumb>
                          )}
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <p className="truncate text-xs text-ink/50">
                              {item.file.name}
                            </p>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                clearSlot(slotIndex);
                              }}
                              className="shrink-0 text-xs font-semibold text-berry/90 hover:text-berry"
                            >
                              Remove
                            </button>
                          </div>
                          {mediaType === "image" ? (
                            <p className="mt-1 text-[10px] text-ink/35">
                              Click to crop
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="px-3 py-10 text-center text-xs text-ink/30">
                          {config.dropSlot}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {onAddPairRow ? (
            <button
              type="button"
              onClick={onAddPairRow}
              className="w-full rounded-xl border border-dashed border-ink/25 bg-night/40 px-4 py-3 font-secondary text-sm font-semibold text-blush/90 transition hover:border-berry/40 hover:bg-night/60 hover:text-ink"
            >
              + Add pair
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

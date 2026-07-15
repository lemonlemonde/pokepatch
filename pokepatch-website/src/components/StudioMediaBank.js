"use client";

import { useEffect, useState } from "react";

export const EMPTY_SLOTS = [null, null, null, null];
const DRAG_TYPE = "text/pokepatch-bank-id";

const SLOT_GROUPS = [
  {
    title: "Front",
    slots: [
      { index: 0, label: "Before" },
      { index: 2, label: "After" },
    ],
  },
  {
    title: "Back",
    slots: [
      { index: 1, label: "Before" },
      { index: 3, label: "After" },
    ],
  },
];

const MEDIA_CONFIG = {
  image: {
    accept: "image/*",
    bankLabel: "Image bank",
    uploadHint: "Drop images here, click to browse, or paste",
    emptyBank: "Uploaded images appear here",
    allPlaced: "All images placed — drag one back here to swap",
    dropSlot: "Drop image here",
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
    dropSlot: "Drop video here",
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

function BankThumbnail({ item, previewUrl, onRemove, mediaType }) {
  function handleDragStart(event) {
    event.dataTransfer.setData(DRAG_TYPE, item.id);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group relative w-24 shrink-0 cursor-grab active:cursor-grabbing"
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

export default function StudioMediaBank({
  mediaType,
  bank,
  setBank,
  slots,
  setSlots,
  onError,
}) {
  const config = MEDIA_CONFIG[mediaType];
  const [uploadDragging, setUploadDragging] = useState(false);
  const [bankDragging, setBankDragging] = useState(false);
  const [activeSlot, setActiveSlot] = useState(null);
  const [previewUrls, setPreviewUrls] = useState({});

  const placedIds = new Set(slots.filter(Boolean));
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
    if (!bank.some((item) => item.id === bankId)) return;

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

  function clearSlot(slotIndex) {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
  }

  function removeFromBank(bankId) {
    setBank((prev) => prev.filter((item) => item.id !== bankId));
    setSlots((prev) => prev.map((id) => (id === bankId ? null : id)));
  }

  function returnToBank(bankId) {
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
    const bankId = readDragId(event);
    if (bankId) returnToBank(bankId);
  }

  function handleSlotDrop(event, slotIndex) {
    event.preventDefault();
    setActiveSlot(null);
    const bankId = readDragId(event);
    if (bankId) assignToSlot(slotIndex, bankId);
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
          {config.bankLabel}
        </p>
        <label
          htmlFor={config.inputId}
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
            id={config.inputId}
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
                />
              ))}
            </div>
          ) : (
            <p className="flex h-full min-h-[5rem] items-center justify-center text-center text-sm text-ink/40">
              {bank.length > 0 ? config.allPlaced : config.emptyBank}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <p className="font-secondary text-sm font-semibold text-blush/90">
          Drag into slots
        </p>
        {SLOT_GROUPS.map((group) => (
          <div key={group.title} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
              {group.title}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {group.slots.map(({ index: slotIndex, label }) => {
                const bankId = slots[slotIndex];
                const item = bank.find((entry) => entry.id === bankId);
                const preview = bankId ? previewUrls[bankId] : null;
                const isActive = activeSlot === slotIndex;

                return (
                  <div
                    key={slotIndex}
                    onDragOver={(event) => {
                      event.preventDefault();
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
                        {mediaType === "video" ? (
                          <video
                            src={preview}
                            muted
                            playsInline
                            preload="metadata"
                            className="mx-auto max-h-36 w-full object-contain"
                            draggable={false}
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={preview}
                            alt={`${group.title} ${label} preview`}
                            className="mx-auto max-h-36 w-full object-contain"
                            draggable={false}
                          />
                        )}
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="truncate text-xs text-ink/50">
                            {item.file.name}
                          </p>
                          <button
                            type="button"
                            onClick={() => clearSlot(slotIndex)}
                            className="shrink-0 text-xs font-semibold text-berry/90 hover:text-berry"
                          >
                            Remove
                          </button>
                        </div>
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
      </div>
    </div>
  );
}

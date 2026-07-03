"use client";

import { useEffect, useState } from "react";
import SectionHeading from "@/components/SectionHeading";
import { canvasToBlob, stitchBothPosts } from "@/lib/instagramStitch";

const STORAGE_KEY = "pokepatch-studio-unlocked";
const PASSPHRASE =
  process.env.NEXT_PUBLIC_STUDIO_PASSPHRASE?.trim() ||
  "mrpokepatchpokemeapatch";

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

const EMPTY_SLOTS = [null, null, null, null];
const DRAG_TYPE = "text/pokepatch-bank-id";

function StudioGate({ onUnlock }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    if (value === PASSPHRASE) {
      sessionStorage.setItem(STORAGE_KEY, "1");
      onUnlock();
      return;
    }
    setError("Wrong passphrase.");
  }

  return (
    <div className="mx-auto max-w-sm animate-fade-up">
      <SectionHeading subtitle="Studio tools are for PokePatch use only.">
        Enter passphrase
      </SectionHeading>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="password"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
          }}
          placeholder="Passphrase"
          autoComplete="off"
          className="w-full rounded-xl border border-ink/20 bg-night/50 px-4 py-3 text-ink placeholder:text-ink/40 focus:border-berry/50 focus:outline-none focus:ring-2 focus:ring-berry/30"
        />
        {error && (
          <p className="text-center text-sm text-berry" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="w-full rounded-xl bg-berry px-4 py-3 font-semibold text-night shadow-cozy transition hover:brightness-110"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}

function pickPngFiles(fileList) {
  return Array.from(fileList).filter((file) => file.type === "image/png");
}

function createBankId() {
  return crypto.randomUUID();
}

function BankThumbnail({ item, previewUrl, onRemove }) {
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

function ImageBankEditor({ bank, setBank, slots, setSlots, onError }) {
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
    const pngs = pickPngFiles(fileList);
    if (pngs.length === 0) {
      onError("Only PNG images are supported.");
      return;
    }
    const newItems = pngs.map((file) => ({ id: createBankId(), file }));
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

  return (
    <div className="space-y-6" onPaste={handlePaste}>
      <div className="space-y-3">
        <p className="font-secondary text-sm font-semibold text-blush/90">
          Image bank
        </p>
        <label
          htmlFor="card-images"
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
            id="card-images"
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
                />
              ))}
            </div>
          ) : (
            <p className="flex h-full min-h-[5rem] items-center justify-center text-center text-sm text-ink/40">
              {bank.length > 0
                ? "All images placed — drag one back here to swap"
                : "Uploaded images appear here"}
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
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={preview}
                          alt={`${group.title} ${label} preview`}
                          className="mx-auto max-h-36 w-full object-contain"
                          draggable={false}
                        />
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
                        Drop image here
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

export default function InstagramStitchTool() {
  const [unlocked, setUnlocked] = useState(false);
  const [bank, setBank] = useState([]);
  const [slots, setSlots] = useState(EMPTY_SLOTS);
  const [outputs, setOutputs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setUnlocked(sessionStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  useEffect(() => {
    return () => {
      outputs?.forEach(({ url }) => URL.revokeObjectURL(url));
    };
  }, [outputs]);

  function getSlotImages() {
    return slots.map((id) => bank.find((item) => item.id === id)?.file ?? null);
  }

  async function handleGenerate(event) {
    event.preventDefault();
    setError("");

    const images = getSlotImages();

    if (images.some((file) => !file)) {
      setError("Drag an image into each of the 4 slots.");
      return;
    }

    setBusy(true);
    try {
      const { front, back } = await stitchBothPosts(images);
      const pairs = [
        { key: "front", label: "Front", canvas: front },
        { key: "back", label: "Back", canvas: back },
      ];

      const next = await Promise.all(
        pairs.map(async ({ key, label, canvas }) => {
          const blob = await canvasToBlob(canvas);
          const url = URL.createObjectURL(blob);
          return {
            key,
            label,
            url,
            filename: `pokepatch-${key}.png`,
          };
        }),
      );

      setOutputs((prev) => {
        prev?.forEach(({ url }) => URL.revokeObjectURL(url));
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!unlocked) {
    return <StudioGate onUnlock={() => setUnlocked(true)} />;
  }

  return (
    <div className="mx-auto max-w-3xl animate-fade-up">
      <SectionHeading subtitle="Before & after fronts side-by-side, then backs. Black background, white labels. 1080×1080.">
        Instagram stitch
      </SectionHeading>

      <form onSubmit={handleGenerate} className="space-y-6">
        <ImageBankEditor
          bank={bank}
          setBank={setBank}
          slots={slots}
          setSlots={setSlots}
          onError={setError}
        />

        {error && (
          <p className="text-center text-sm text-berry" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-berry px-4 py-3 font-semibold text-night shadow-cozy transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Generating…" : "Generate images"}
        </button>
      </form>

      {outputs && (
        <div className="mt-10 grid gap-10 sm:grid-cols-2">
          {outputs.map(({ key, label, url, filename }) => (
            <div key={key} className="space-y-4 text-center">
              <p className="font-secondary text-sm text-ink/60">
                {label} (1080×1080)
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`${label} preview`}
                className="mx-auto max-w-full rounded-xl border border-ink/15 shadow-cozy-sm"
              />
              <a
                href={url}
                download={filename}
                className="inline-block rounded-xl border border-ink/20 bg-night/50 px-6 py-3 font-semibold text-ink transition hover:border-berry/40 hover:bg-night/70"
              >
                Download {label.toLowerCase()}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

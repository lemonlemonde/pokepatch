"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import SectionHeading from "@/components/SectionHeading";
import StudioMediaBank, {
  BEFORE_AFTER_PAIR_SLOT_GROUPS,
  EMPTY_SLOTS,
  FRONT_BACK_PAIR_SLOT_GROUPS,
} from "@/components/StudioMediaBank";
import StudioFolderBoard, { createPair } from "@/components/StudioFolderBoard";
import StudioOpenableThumb from "@/components/StudioOpenableThumb";
import StudioAnnotatedPreview, {
  downloadBlob,
} from "@/components/StudioAnnotatedPreview";
import {
  canvasToBlob,
  stitchBeforeAfterPosts,
  stitchBothPosts,
} from "@/lib/instagramStitch";
import { stitchGridPosts } from "@/lib/instagramGridStitch";
import {
  extensionForMimeType,
  stitchBothVideos,
} from "@/lib/instagramVideoStitch";

const INPUT_CLASS =
  "w-full rounded-xl border border-ink/15 bg-cream px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-blush";

function createEmptyCardMeta() {
  return {
    frontFile: null,
    frontPreviewUrl: null,
    card: "",
    set: "",
    restoration: "",
    showCardInfo: true,
    showCaption: true,
  };
}

function validateCardMeta(meta) {
  if (meta.showCardInfo) {
    if (!meta.frontFile) return "Card info needs a front image.";
    if (!meta.card.trim()) return "Card info needs a card name.";
    if (!meta.set.trim()) return "Card info needs a set name.";
  }
  if (meta.showCaption && !meta.restoration.trim()) {
    return "Restoration caption needs restoration text.";
  }
  return null;
}

function cardMetaToOverlayOptions(meta) {
  return {
    showCardInfo: meta.showCardInfo,
    showCaption: meta.showCaption,
    frontFile: meta.frontFile,
    card: meta.card.trim(),
    set: meta.set.trim(),
    restoration: meta.restoration.trim(),
  };
}

function MetaSwitch({ id, label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <label
          htmlFor={id}
          className="font-secondary text-sm font-semibold text-ink"
        >
          {label}
        </label>
        {description ? (
          <p className="mt-0.5 text-xs text-ink/50">{description}</p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          checked ? "bg-berry" : "bg-ink/25"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-cream shadow-cozy-sm transition ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function StudioCardMetaControls({ value, onChange }) {
  const frontInputId = useId();
  const cardInfoSwitchId = useId();
  const captionSwitchId = useId();
  const [uploadDragging, setUploadDragging] = useState(false);

  useEffect(() => {
    const url = value.frontPreviewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [value.frontPreviewUrl]);

  function patch(partial) {
    onChange({ ...value, ...partial });
  }

  function setFrontFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    patch({
      frontFile: file,
      frontPreviewUrl: URL.createObjectURL(file),
    });
  }

  function handleFrontChange(event) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      patch({ frontFile: null, frontPreviewUrl: null });
      return;
    }
    setFrontFile(file);
  }

  function handleUploadDrop(event) {
    event.preventDefault();
    setUploadDragging(false);
    const file = Array.from(event.dataTransfer.files ?? []).find((entry) =>
      entry.type.startsWith("image/"),
    );
    if (file) setFrontFile(file);
  }

  function clearFront() {
    patch({ frontFile: null, frontPreviewUrl: null });
  }

  return (
    <div className="space-y-4 rounded-xl border border-ink/15 bg-night/30 p-4">
      <p className="font-secondary text-sm font-semibold text-ink">
        Card overlays
      </p>

      <div className="space-y-3 rounded-xl border border-ink/10 bg-night/20 p-3">
        <MetaSwitch
          id={cardInfoSwitchId}
          label="Card info"
          description="Top-left chip with front thumbnail, card, and set"
          checked={value.showCardInfo}
          onChange={(showCardInfo) => patch({ showCardInfo })}
        />

        {value.showCardInfo ? (
          <div className="grid gap-4 border-t border-ink/10 pt-3 sm:grid-cols-[minmax(0,11rem)_1fr]">
            <div className="space-y-2">
              <p className="font-secondary text-xs font-semibold uppercase tracking-wide text-ink/50">
                Front image
              </p>
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setUploadDragging(true);
                }}
                onDragLeave={() => setUploadDragging(false)}
                onDrop={handleUploadDrop}
                className={`rounded-xl transition ${
                  uploadDragging ? "ring-2 ring-berry/60" : ""
                }`}
              >
                {value.frontPreviewUrl ? (
                  <div className="space-y-2">
                    <StudioOpenableThumb
                      src={value.frontPreviewUrl}
                      alt="Card front preview"
                      label={value.frontFile?.name || "Card front"}
                      className="block w-24"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={value.frontPreviewUrl}
                        alt="Card front preview"
                        className="h-24 w-24 rounded-lg border border-ink/15 object-cover"
                      />
                    </StudioOpenableThumb>
                    <div className="flex w-24 flex-col gap-1">
                      <label
                        htmlFor={frontInputId}
                        className="cursor-pointer rounded-lg border border-ink/20 px-2 py-1 text-center font-secondary text-xs font-semibold text-ink/70 transition hover:border-berry/40 hover:text-ink"
                      >
                        Replace
                      </label>
                      <button
                        type="button"
                        onClick={clearFront}
                        className="rounded-lg border border-ink/20 px-2 py-1 font-secondary text-xs font-semibold text-ink/70 transition hover:border-berry/40 hover:text-ink"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                ) : (
                  <label
                    htmlFor={frontInputId}
                    className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-3 py-6 text-center transition ${
                      uploadDragging
                        ? "border-berry bg-berry/10"
                        : "border-ink/25 bg-night/40 hover:border-berry/40 hover:bg-night/60"
                    }`}
                  >
                    <p className="text-xs text-ink/70">
                      Drop image here or browse
                    </p>
                  </label>
                )}
              </div>
              <input
                id={frontInputId}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleFrontChange}
              />
            </div>

            <div className="grid gap-3">
              <label className="block space-y-1.5">
                <span className="font-secondary text-xs font-semibold uppercase tracking-wide text-ink/50">
                  Card
                </span>
                <input
                  type="text"
                  value={value.card}
                  onChange={(event) => patch({ card: event.target.value })}
                  placeholder="Sylveon-GX (Secret Rare)"
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="font-secondary text-xs font-semibold uppercase tracking-wide text-ink/50">
                  Set
                </span>
                <input
                  type="text"
                  value={value.set}
                  onChange={(event) => patch({ set: event.target.value })}
                  placeholder="Guardians Rising"
                  className={INPUT_CLASS}
                />
              </label>
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 rounded-xl border border-ink/10 bg-night/20 p-3">
        <MetaSwitch
          id={captionSwitchId}
          label="Restoration caption"
          description="Centered caption above the images"
          checked={value.showCaption}
          onChange={(showCaption) => patch({ showCaption })}
        />

        {value.showCaption ? (
          <label className="block space-y-1.5 border-t border-ink/10 pt-3">
            <span className="font-secondary text-xs font-semibold uppercase tracking-wide text-ink/50">
              Restoration
            </span>
            <input
              type="text"
              value={value.restoration}
              onChange={(event) => patch({ restoration: event.target.value })}
              placeholder="Surface Clean"
              className={INPUT_CLASS}
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}

const PHOTO_GROUP_MODES = [
  {
    id: "before-after-pair",
    label: "Before-After Pair",
    subtitle:
      "Before & after side-by-side. Fill Front/Any for one post; Back is optional for a second. 1080×1080.",
    slotGroups: BEFORE_AFTER_PAIR_SLOT_GROUPS,
  },
  {
    id: "front-back-pair",
    label: "Front-Back Pair",
    subtitle:
      "Front & back side-by-side. Fill Before for one post; After is optional for a second. 1080×1080.",
    slotGroups: FRONT_BACK_PAIR_SLOT_GROUPS,
  },
];

const COMPARISON_SUBTITLE =
  "Before & after fronts side-by-side, then backs. Black background, white labels. 1080×1080.";
const GRID_SUBTITLE =
  "Load the before & after banks on each side, drag a pair into each slot, then export 2×2 grid posts (2 pairs each). Same black background, white labels, and branding. 1080×1080.";

const STUDIO_BASE = "/admin/studio/";

const STUDIO_OPTIONS = [
  {
    id: "photo",
    slug: "front-back",
    title: "1×2 formatter",
    description:
      "Before-After or Front-Back pair posts. One complete pair is enough for a single output. 1080×1080.",
  },
  {
    id: "grid",
    slug: "grid",
    title: "2×2 grid formatter",
    description:
      "Upload a before folder and an after folder, pair them yourself, and export one or more 2×2 grid posts.",
  },
  {
    id: "video",
    slug: "video",
    title: "Video formatter",
    description:
      "Side-by-side before & after videos for front and back. Same layout, labels, and branding as photos.",
  },
];

function studioRoute(id) {
  const option = STUDIO_OPTIONS.find((entry) => entry.id === id);
  return option ? `${STUDIO_BASE}${option.slug}/` : STUDIO_BASE;
}

function modeFromPathname(pathname) {
  const option = STUDIO_OPTIONS.find((entry) =>
    pathname?.startsWith(`${STUDIO_BASE}${entry.slug}`),
  );
  return option?.id ?? null;
}

function StudioSelector({ onSelect }) {
  return (
    <div className="mx-auto max-w-3xl animate-fade-up">
      <div className="grid gap-4 sm:grid-cols-3">
        {STUDIO_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelect(option.id)}
            className="rounded-xl border border-ink/20 bg-night/50 px-6 py-10 text-left shadow-cozy-sm transition hover:border-berry/40 hover:bg-night/70"
          >
            <p className="text-xl font-bold text-ink">{option.title}</p>
            <p className="mt-2 text-sm text-ink/60">{option.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function BackButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-ink/20 bg-night/40 px-4 py-2 font-secondary text-sm font-semibold text-blush/90 transition hover:border-berry/40 hover:bg-night/60 hover:text-ink"
    >
      ← Back to studio
    </button>
  );
}

function downloadAllFromUrls(outputs) {
  outputs.forEach((output, index) => {
    setTimeout(() => {
      const anchor = document.createElement("a");
      anchor.href = output.url;
      anchor.download = output.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }, index * 150);
  });
}

function OutputGrid({ outputs, renderPreview, annotated = false }) {
  const exportersRef = useRef(new Map());

  const setExporter = useCallback((key, exporter) => {
    if (exporter) exportersRef.current.set(key, exporter);
    else exportersRef.current.delete(key);
  }, []);

  async function downloadAllAnnotated() {
    for (let index = 0; index < outputs.length; index += 1) {
      const output = outputs[index];
      const exporter = exportersRef.current.get(output.key);
      if (exporter) {
        const { blob, filename } = await exporter();
        downloadBlob(blob, filename);
      } else {
        downloadBlob(
          await fetch(output.url).then((res) => res.blob()),
          output.filename,
        );
      }
      if (index < outputs.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }

  return (
    <div className="mt-10 space-y-8">
      {outputs.length > 1 && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() =>
              annotated ? downloadAllAnnotated() : downloadAllFromUrls(outputs)
            }
            className="rounded-xl bg-berry px-6 py-3 font-semibold text-night shadow-cozy transition hover:brightness-110"
          >
            Download all ({outputs.length})
          </button>
        </div>
      )}
      <div className="grid gap-10 sm:grid-cols-2">
        {outputs.map((output) => (
          <div key={output.key} className="space-y-4 text-center">
            <p className="font-secondary text-sm text-ink/60">
              {output.label} (1080×1080)
            </p>
            {annotated ? (
              <StudioAnnotatedPreview
                label={output.label}
                url={output.url}
                filename={output.filename}
                onExporterChange={(exporter) => setExporter(output.key, exporter)}
              />
            ) : (
              <>
                {renderPreview(output)}
                <a
                  href={output.url}
                  download={output.filename}
                  className="inline-block rounded-xl border border-ink/20 bg-night/50 px-6 py-3 font-semibold text-ink transition hover:border-berry/40 hover:bg-night/70"
                >
                  Download {output.label.toLowerCase()}
                </a>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MediaFormatter({
  mediaType,
  title,
  subtitle,
  emptySlotMessage,
  generateLabel,
  busyLabel,
  onBack,
  onGenerate,
  renderPreview,
  annotated = false,
  controls = null,
  afterBank = null,
  resetKey = null,
  slotGroups,
  validateFiles = null,
  validateExtra = null,
}) {
  const [bank, setBank] = useState([]);
  const [slots, setSlots] = useState(EMPTY_SLOTS);
  const [outputs, setOutputs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      outputs?.forEach(({ url }) => URL.revokeObjectURL(url));
    };
  }, [outputs]);

  useEffect(() => {
    if (resetKey == null) return;
    setOutputs((prev) => {
      prev?.forEach(({ url }) => URL.revokeObjectURL(url));
      return null;
    });
    setError("");
  }, [resetKey]);

  function getSlotFiles() {
    return slots.map((id) => bank.find((item) => item.id === id)?.file ?? null);
  }

  async function handleGenerate(event) {
    event.preventDefault();
    setError("");

    const files = getSlotFiles();
    if (validateFiles) {
      const validationError = validateFiles(files);
      if (validationError) {
        setError(validationError);
        return;
      }
    } else if (files.some((file) => !file)) {
      setError(emptySlotMessage);
      return;
    }

    if (validateExtra) {
      const extraError = validateExtra();
      if (extraError) {
        setError(extraError);
        return;
      }
    }

    setBusy(true);
    try {
      const next = await onGenerate(files);
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

  return (
    <div className="mx-auto max-w-3xl animate-fade-up">
      <BackButton onClick={onBack} />
      <SectionHeading subtitle={subtitle}>{title}</SectionHeading>

      <form onSubmit={handleGenerate} className="space-y-6">
        {controls}

        <StudioMediaBank
          mediaType={mediaType}
          bank={bank}
          setBank={setBank}
          slots={slots}
          setSlots={setSlots}
          onError={setError}
          slotGroups={slotGroups}
        />

        {afterBank}

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
          {busy ? busyLabel : generateLabel}
        </button>
      </form>

      {outputs && (
        <OutputGrid
          outputs={outputs}
          renderPreview={renderPreview}
          annotated={annotated}
        />
      )}
    </div>
  );
}

async function canvasOutputsFromPairs(pairs) {
  return Promise.all(
    pairs.map(async ({ key, label, canvas }) => {
      const blob = await canvasToBlob(canvas);
      return {
        key,
        label,
        url: URL.createObjectURL(blob),
        filename: `pokepatch-${key}.png`,
      };
    }),
  );
}

function validatePhotoPairFiles(files, groupBy) {
  const [beforeFront, beforeBack, afterFront, afterBack] = files;

  if (groupBy === "front-back-pair") {
    const beforeOk = Boolean(beforeFront && beforeBack);
    const afterOk = Boolean(afterFront && afterBack);
    if (!beforeOk && !afterOk) {
      return "Fill at least one complete pair (Before: front + back, and/or After: front + back).";
    }
    if ((beforeFront || beforeBack) && !beforeOk) {
      return "Before pair needs both Front and Back.";
    }
    if ((afterFront || afterBack) && !afterOk) {
      return "After pair needs both Front and Back.";
    }
    return null;
  }

  const frontOk = Boolean(beforeFront && afterFront);
  const backOk = Boolean(beforeBack && afterBack);
  if (!frontOk && !backOk) {
    return "Fill at least one complete pair (Front/Any: before + after, and/or Back: before + after).";
  }
  if ((beforeFront || afterFront) && !frontOk) {
    return "Front/Any pair needs both Before and After.";
  }
  if ((beforeBack || afterBack) && !backOk) {
    return "Back pair needs both Before and After.";
  }
  return null;
}

async function generatePhotoOutputs(files, groupBy, overlayOptions = null) {
  if (groupBy === "front-back-pair") {
    const canvases = await stitchBeforeAfterPosts(files, overlayOptions);
    const pairs = [];
    if (canvases.before) {
      pairs.push({ key: "before", label: "Before", canvas: canvases.before });
    }
    if (canvases.after) {
      pairs.push({ key: "after", label: "After", canvas: canvases.after });
    }
    return canvasOutputsFromPairs(pairs);
  }

  const canvases = await stitchBothPosts(files, overlayOptions);
  const pairs = [];
  if (canvases.front) {
    // Solo Front/Any pair → filename pokepatch-any.png; with Back → front/back.
    const solo = !canvases.back;
    pairs.push({
      key: solo ? "any" : "front",
      label: solo ? "Any" : "Front",
      canvas: canvases.front,
    });
  }
  if (canvases.back) {
    pairs.push({ key: "back", label: "Back", canvas: canvases.back });
  }
  return canvasOutputsFromPairs(pairs);
}

async function generateVideoOutputs(files) {
  const { front, back } = await stitchBothVideos(files);
  const pairs = [
    { key: "front", label: "Front", result: front },
    { key: "back", label: "Back", result: back },
  ];

  return pairs.map(({ key, label, result }) => {
    const ext = extensionForMimeType(result.mimeType);
    return {
      key,
      label,
      url: URL.createObjectURL(result.blob),
      filename: `pokepatch-${key}.${ext}`,
    };
  });
}

function GroupModeToggle({ value, onChange }) {
  return (
    <div
      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      role="group"
      aria-label="Pair mode"
    >
      <p className="font-secondary text-sm text-ink/60">Pair mode</p>
      <div className="inline-flex rounded-xl border border-ink/20 bg-night/40 p-1">
        {PHOTO_GROUP_MODES.map((mode) => {
          const active = value === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(mode.id)}
              className={`rounded-lg px-3 py-2 font-secondary text-sm font-semibold transition ${
                active
                  ? "bg-berry text-night shadow-cozy-sm"
                  : "text-ink/70 hover:text-ink"
              }`}
            >
              {mode.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PhotoFormatter({ onBack }) {
  const [groupBy, setGroupBy] = useState("before-after-pair");
  const [cardMeta, setCardMeta] = useState(createEmptyCardMeta);
  const activeMode =
    PHOTO_GROUP_MODES.find((mode) => mode.id === groupBy) ??
    PHOTO_GROUP_MODES[0];

  return (
    <MediaFormatter
      mediaType="image"
      title="1×2 formatter"
      subtitle={activeMode.subtitle}
      emptySlotMessage="Fill at least one complete pair."
      generateLabel="Generate images"
      busyLabel="Generating…"
      onBack={onBack}
      onGenerate={(files) =>
        generatePhotoOutputs(files, groupBy, cardMetaToOverlayOptions(cardMeta))
      }
      validateFiles={(files) => validatePhotoPairFiles(files, groupBy)}
      validateExtra={() => validateCardMeta(cardMeta)}
      annotated
      resetKey={groupBy}
      slotGroups={activeMode.slotGroups}
      controls={
        <GroupModeToggle value={groupBy} onChange={setGroupBy} />
      }
      afterBank={
        <StudioCardMetaControls value={cardMeta} onChange={setCardMeta} />
      }
    />
  );
}

function VideoFormatter({ onBack }) {
  return (
    <MediaFormatter
      mediaType="video"
      title="Video formatter"
      subtitle={COMPARISON_SUBTITLE}
      emptySlotMessage="Drag a video into each of the 4 slots."
      generateLabel="Generate videos"
      busyLabel="Generating…"
      onBack={onBack}
      onGenerate={generateVideoOutputs}
      renderPreview={({ url }) => (
        <video
          src={url}
          controls
          playsInline
          className="mx-auto max-w-full rounded-xl border border-ink/15 shadow-cozy-sm"
        />
      )}
    />
  );
}

function GridFormatter({ onBack }) {
  const [beforeItems, setBeforeItems] = useState([]);
  const [afterItems, setAfterItems] = useState([]);
  const [pairs, setPairs] = useState(() => [createPair(), createPair()]);
  const [cardMeta, setCardMeta] = useState(createEmptyCardMeta);
  const [outputs, setOutputs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      outputs?.forEach(({ url }) => URL.revokeObjectURL(url));
    };
  }, [outputs]);

  async function handleGenerate(event) {
    event.preventDefault();
    setError("");

    const partial = pairs.some(
      (pair) => Boolean(pair.before) !== Boolean(pair.after),
    );
    if (partial) {
      setError("Each pair needs both a before and an after (or remove it).");
      return;
    }

    const files = pairs
      .filter((pair) => pair.before && pair.after)
      .map((pair) => ({
        before: beforeItems.find((item) => item.id === pair.before)?.file,
        after: afterItems.find((item) => item.id === pair.after)?.file,
      }))
      .filter((pair) => pair.before && pair.after);

    if (files.length === 0) {
      setError("Pair at least one before image with an after image.");
      return;
    }

    const metaError = validateCardMeta(cardMeta);
    if (metaError) {
      setError(metaError);
      return;
    }

    setBusy(true);
    try {
      const canvases = await stitchGridPosts(
        files,
        cardMetaToOverlayOptions(cardMeta),
      );
      const next = await Promise.all(
        canvases.map(async (canvas, index) => {
          const blob = await canvasToBlob(canvas);
          return {
            key: `post-${index + 1}`,
            label: `Post ${index + 1}`,
            url: URL.createObjectURL(blob),
            filename: `pokepatch-grid-${index + 1}.png`,
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

  return (
    <div className="mx-auto max-w-6xl animate-fade-up">
      <div className="mx-auto max-w-3xl">
        <BackButton onClick={onBack} />
        <SectionHeading subtitle={GRID_SUBTITLE}>
          2×2 grid formatter
        </SectionHeading>
      </div>

      <form onSubmit={handleGenerate} className="space-y-6">
        <StudioFolderBoard
          beforeItems={beforeItems}
          afterItems={afterItems}
          setBeforeItems={setBeforeItems}
          setAfterItems={setAfterItems}
          pairs={pairs}
          setPairs={setPairs}
          onError={setError}
        />

        <div className="mx-auto max-w-3xl space-y-6">
          <StudioCardMetaControls value={cardMeta} onChange={setCardMeta} />

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
            {busy ? "Generating…" : "Generate grid posts"}
          </button>
        </div>
      </form>

      {outputs && (
        <div className="mx-auto max-w-3xl">
          <OutputGrid outputs={outputs} annotated />
        </div>
      )}
    </div>
  );
}

export default function StudioTool() {
  const router = useRouter();
  const pathname = usePathname();
  const mode = modeFromPathname(pathname);
  const goBack = () => router.push(STUDIO_BASE);

  if (mode === "photo") {
    return <PhotoFormatter onBack={goBack} />;
  }

  if (mode === "grid") {
    return <GridFormatter onBack={goBack} />;
  }

  if (mode === "video") {
    return <VideoFormatter onBack={goBack} />;
  }

  return <StudioSelector onSelect={(id) => router.push(studioRoute(id))} />;
}

"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import SectionHeading from "@/components/SectionHeading";
import StudioFolderBoard, {
  createPair,
  readDragItem as readPairBankDragItem,
  SideBank,
} from "@/components/StudioFolderBoard";
import StudioOpenableThumb from "@/components/StudioOpenableThumb";
import {
  downloadSlotImages,
  resolveStudioImageFile,
} from "@/lib/studioSlotImage";
import { StudioCroppableThumb } from "@/components/StudioSlotEditor";
import StudioAnnotatedPreview from "@/components/StudioAnnotatedPreview";
import { downloadBlob } from "@/lib/downloadFile";
import useDebouncedValue from "@/lib/useDebouncedValue";
import useStableObjectUrls from "@/lib/useStableObjectUrls";
import useStudioDraft from "@/lib/useStudioDraft";
import { deleteDraft } from "@/lib/studioDraftDb";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";
import {
  canvasToBlob,
  stitchBeforeAfterPairRows,
  stitchBeforeAfterPosts,
} from "@/lib/instagramStitch";
import CardSearch from "@/components/CardSearch";
import {
  DEFAULT_PACKAGE_CAPTION,
  downloadStudioPackageZip,
} from "@/lib/studioPackageZip";

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

/**
 * `resolveDroppedItemFile` lets the front image accept a thumbnail dragged out
 * of an image bank, not just an OS file drop. Each formatter owns its own bank
 * items and drag payload format, so it passes a resolver that turns the drag
 * event back into that item's `File` (or null when the drag isn't one of ours).
 */
function StudioCardMetaControls({
  value,
  onChange,
  resolveDroppedItemFile = null,
}) {
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

    // A bank thumbnail carries an item reference rather than a file, so it has
    // to be resolved first — `dataTransfer.files` is empty for those drags.
    // `setFrontFile` mints its own object URL from the File, so the bank keeps
    // owning (and revoking) its preview URL independently of this one.
    const bankFile = resolveDroppedItemFile?.(event) ?? null;
    if (bankFile) {
      setFrontFile(bankFile);
      return;
    }

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
                    {resolveDroppedItemFile ? (
                      <p className="text-[10px] text-ink/40">
                        or drag one in from a bank
                      </p>
                    ) : null}
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
              <CardSearch
                onSelect={(found) =>
                  patch({ card: found.name, set: found.set_name })
                }
              />
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
      "Before & after side-by-side. Add as many pair rows as you need — each complete pair becomes its own post.",
    dynamicPairRows: true,
  },
  {
    id: "front-back-pair",
    label: "Front-Back Pair",
    subtitle:
      "Front & back side-by-side. Fill Before for one post; After is optional for a second.",
    dynamicPairRows: false,
  },
];

const PHOTO_OUTPUT_FORMATS = [
  {
    id: "square",
    label: "1:1 square",
    sizeHint: "1080×1080",
  },
  {
    id: "reel",
    label: "9:16 Reels",
    sizeHint: "1080×1920",
  },
];

const STUDIO_BASE = "/admin/studio/";

const STUDIO_OPTIONS = [
  {
    id: "photo",
    slug: "front-back",
    title: "1×2 formatter",
    description:
      "Before-After or Front-Back pair posts. Square (1:1) or Reels (9:16). Before-After supports as many pair rows as you need.",
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
      <div className="grid gap-4 sm:grid-cols-2">
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

function ClearAllButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-ink/20 bg-night/40 px-4 py-2 font-secondary text-sm font-semibold text-blush/90 transition hover:border-berry/40 hover:bg-night/60 hover:text-ink"
    >
      Clear all
    </button>
  );
}

/** Has the user typed or uploaded anything into the card-info panel? */
function hasCardMetaContent(cardMeta) {
  return Boolean(
    cardMeta.frontFile ||
      cardMeta.card.trim() ||
      cardMeta.set.trim() ||
      cardMeta.restoration.trim(),
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

/**
 * `outputSources`, when given, is parallel to `outputs` *by index* (not by
 * `output.key` — front-back-pair's "before"/"after" keys are independently
 * conditional, and before-after-pair falls back to the key `"any"` when
 * there's exactly one output, so key-matching can't be relied on).
 * `outputSources[i]` is the list of source slot images
 * (`{ item, previewUrl, label, exportName }`, same shape `downloadSlotImages`
 * takes) that fed `outputs[i]`.
 *
 * `onAltTextChange`, when given, turns on a per-post alt text field under each
 * image — only the package download consumes alt text, so formatters without
 * one leave it off.
 */
function OutputGrid({
  outputs,
  outputSources = null,
  renderPreview,
  annotated = false,
  exportersRef: externalExportersRef = null,
  altTextByKey = {},
  onAltTextChange = null,
}) {
  const internalExportersRef = useRef(new Map());
  const exportersRef = externalExportersRef ?? internalExportersRef;

  const setExporter = useCallback(
    (key, exporter) => {
      if (exporter) exportersRef.current.set(key, exporter);
      else exportersRef.current.delete(key);
    },
    [exportersRef],
  );

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
        {outputs.map((output, index) => {
          const sources = outputSources?.[index] ?? [];
          const sourcesButton =
            sources.length > 0 ? (
              <button
                type="button"
                onClick={() => downloadSlotImages(sources)}
                className="inline-block rounded-xl border border-ink/20 bg-night/50 px-6 py-3 font-semibold text-ink transition hover:border-berry/40 hover:bg-night/70"
              >
                Download source imgs
              </button>
            ) : null;
          const altTextField = onAltTextChange ? (
            <label className="block space-y-1.5 text-left">
              <span className="font-secondary text-xs font-semibold uppercase tracking-wide text-ink/50">
                Alt text
              </span>
              <textarea
                value={altTextByKey[output.key] ?? ""}
                onChange={(event) =>
                  onAltTextChange(output.key, event.target.value)
                }
                rows={2}
                className={`${INPUT_CLASS} resize-y`}
              />
            </label>
          ) : null;
          return (
            <div key={output.key} className="space-y-4 text-center">
              <p className="font-secondary text-sm text-ink/60">
                {output.sizeHint
                  ? `${output.label} (${output.sizeHint})`
                  : output.label}
              </p>
              {annotated ? (
                <StudioAnnotatedPreview
                  label={output.label}
                  url={output.url}
                  filename={output.filename}
                  onExporterChange={(exporter) =>
                    setExporter(output.key, exporter)
                  }
                  extraActions={sourcesButton}
                >
                  {altTextField}
                </StudioAnnotatedPreview>
              ) : (
                <>
                  {renderPreview(output)}
                  {altTextField}
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <a
                      href={output.url}
                      download={output.filename}
                      className="inline-block rounded-xl border border-ink/20 bg-night/50 px-6 py-3 font-semibold text-ink transition hover:border-berry/40 hover:bg-night/70"
                    >
                      Download {output.label.toLowerCase()}
                    </a>
                    {sourcesButton}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * `blob` is kept alongside `url` so an output can be written to the draft and
 * rebuilt after a refresh — object URLs die with the page, blobs clone into
 * IndexedDB.
 */
async function canvasOutputsFromPairs(pairs, sizeHint = "1080×1080") {
  return Promise.all(
    pairs.map(async ({ key, label, canvas }) => {
      const blob = await canvasToBlob(canvas);
      return {
        key,
        label,
        sizeHint,
        blob,
        url: URL.createObjectURL(blob),
        filename: `pokepatch-${key}.png`,
      };
    }),
  );
}

/** Re-mint object URLs for outputs read back out of a draft. */
function outputsFromDraft(stored) {
  return (stored ?? [])
    .filter((output) => output?.blob)
    .map((output) => ({ ...output, url: URL.createObjectURL(output.blob) }));
}

function validatePhotoPairFiles(files, groupBy) {
  if (groupBy === "front-back-pair") {
    const [beforeFront, beforeBack, afterFront, afterBack] = files;
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

  // Flat [before, after, …] rows for Before-After Pair.
  let complete = 0;
  const rowCount = Math.ceil(files.length / 2);
  for (let i = 0; i < rowCount; i += 1) {
    const before = files[i * 2] ?? null;
    const after = files[i * 2 + 1] ?? null;
    if (before && after) {
      complete += 1;
    } else if (before || after) {
      return `Pair ${i + 1} needs both Before and After.`;
    }
  }
  if (!complete) {
    return "Fill at least one complete before & after pair.";
  }
  return null;
}

async function generatePhotoOutputs(
  files,
  groupBy,
  overlayOptions = null,
  format = "square",
) {
  const sizeHint =
    PHOTO_OUTPUT_FORMATS.find((entry) => entry.id === format)?.sizeHint ??
    "1080×1080";

  if (groupBy === "front-back-pair") {
    const canvases = await stitchBeforeAfterPosts(
      files,
      overlayOptions,
      format,
    );
    const pairs = [];
    if (canvases.before) {
      pairs.push({ key: "before", label: "Before", canvas: canvases.before });
    }
    if (canvases.after) {
      pairs.push({ key: "after", label: "After", canvas: canvases.after });
    }
    return canvasOutputsFromPairs(pairs, sizeHint);
  }

  const pairs = await stitchBeforeAfterPairRows(files, overlayOptions, format);
  return canvasOutputsFromPairs(pairs, sizeHint);
}

async function resolveStudioItemsToFiles(items, previewUrls) {
  return Promise.all(
    items.map((item) =>
      item && previewUrls[item.id]
        ? resolveStudioImageFile(item, previewUrls[item.id])
        : null,
    ),
  );
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

function OutputFormatToggle({ value, onChange }) {
  return (
    <div
      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      role="group"
      aria-label="Output format"
    >
      <p className="font-secondary text-sm text-ink/60">Output format</p>
      <div className="inline-flex rounded-xl border border-ink/20 bg-night/40 p-1">
        {PHOTO_OUTPUT_FORMATS.map((format) => {
          const active = value === format.id;
          return (
            <button
              key={format.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(format.id)}
              className={`rounded-lg px-3 py-2 font-secondary text-sm font-semibold transition ${
                active
                  ? "bg-berry text-night shadow-cozy-sm"
                  : "text-ink/70 hover:text-ink"
              }`}
            >
              {format.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const BEFORE_AFTER_PAIR_DRAFT_KEY = "photo:before-after-pair";

/**
 * The caption and alt text reach the draft this far behind the field, so a
 * burst of typing doesn't re-write a payload that carries every uploaded photo
 * and generated image with it. Photo edits still save on the draft's own
 * shorter debounce.
 */
const TEXT_DRAFT_DEBOUNCE_MS = 2000;

function BeforeAfterPairPhotoFormatter({
  onBack,
  onChangeGroupBy,
  outputFormat,
  onChangeOutputFormat,
  cardMeta,
  onChangeCardMeta,
}) {
  const [beforeItems, setBeforeItems] = useState([]);
  const [afterItems, setAfterItems] = useState([]);
  const [pairs, setPairs] = useState(() => [createPair()]);
  const [outputs, setOutputs] = useState(null);
  // Sources are held as `{ role, itemId, label, exportName }` refs rather than
  // resolved entries: the item objects and their preview URLs belong to the
  // banks, so storing copies in a draft would duplicate every File and hand
  // back items that are no longer the same objects the board is editing.
  const [outputSourceRefs, setOutputSourceRefs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [caption, setCaption] = useState(DEFAULT_PACKAGE_CAPTION);
  const [altTextByKey, setAltTextByKey] = useState({});
  const [packaging, setPackaging] = useState(false);
  const exportersRef = useRef(new Map());
  const activeFormat =
    PHOTO_OUTPUT_FORMATS.find((format) => format.id === outputFormat) ??
    PHOTO_OUTPUT_FORMATS[0];

  const allItems = useMemo(
    () => [...beforeItems, ...afterItems],
    [beforeItems, afterItems],
  );
  const previewUrls = useStableObjectUrls(allItems);

  const outputSources = useMemo(
    () =>
      outputSourceRefs.map((refs) =>
        (refs ?? [])
          .map(({ role, itemId, label, exportName }) => ({
            item: (role === "before" ? beforeItems : afterItems).find(
              (entry) => entry.id === itemId,
            ),
            previewUrl: previewUrls[itemId],
            label,
            exportName,
          }))
          // A source whose photo has since been deleted from the bank drops out
          // rather than rendering as a broken entry.
          .filter((source) => source.item && source.previewUrl),
      ),
    [outputSourceRefs, beforeItems, afterItems, previewUrls],
  );

  const hasContent =
    beforeItems.length > 0 ||
    afterItems.length > 0 ||
    hasCardMetaContent(cardMeta);
  const { requestLeave, dialog } = useUnsavedChangesGuard(hasContent);

  const [draftCaption, flushDraftCaption] = useDebouncedValue(
    caption,
    TEXT_DRAFT_DEBOUNCE_MS,
  );
  const [draftAltText, flushDraftAltText] = useDebouncedValue(
    altTextByKey,
    TEXT_DRAFT_DEBOUNCE_MS,
  );

  const draftPayload = useMemo(
    () => ({
      beforeItems,
      afterItems,
      pairs,
      caption: draftCaption,
      altTextByKey: draftAltText,
      // `url` is a dead object URL by the time this is read back — only `blob`
      // survives, and `outputsFromDraft` mints a fresh URL from it.
      outputs: outputs?.map(({ url, ...rest }) => rest) ?? null,
      outputSourceRefs,
    }),
    [
      beforeItems,
      afterItems,
      pairs,
      draftCaption,
      draftAltText,
      outputs,
      outputSourceRefs,
    ],
  );
  const restored = useStudioDraft(
    BEFORE_AFTER_PAIR_DRAFT_KEY,
    draftPayload,
    hasContent,
  );
  useEffect(() => {
    if (!restored) return;
    setBeforeItems(restored.beforeItems ?? []);
    setAfterItems(restored.afterItems ?? []);
    setPairs(restored.pairs?.length ? restored.pairs : [createPair()]);
    // Drafts predating these fields have none of them; fall back to the default
    // caption rather than blanking the field. Flushed as well as set, so the
    // photos landing in the same commit can't trigger a save that writes the
    // pre-restore text back over what was just read.
    const restoredCaption = restored.caption ?? DEFAULT_PACKAGE_CAPTION;
    const restoredAltText = restored.altTextByKey ?? {};
    setCaption(restoredCaption);
    flushDraftCaption(restoredCaption);
    setAltTextByKey(restoredAltText);
    flushDraftAltText(restoredAltText);
    setOutputSourceRefs(restored.outputSourceRefs ?? []);
    const restoredOutputs = outputsFromDraft(restored.outputs);
    setOutputs(restoredOutputs.length ? restoredOutputs : null);
    // Both flushes are stable, so listing them can't re-run this restore.
  }, [restored, flushDraftCaption, flushDraftAltText]);

  function clearAll() {
    if (!window.confirm("Clear all photos and card info loaded here?")) {
      return;
    }
    setBeforeItems([]);
    setAfterItems([]);
    setPairs([createPair()]);
    setCaption(DEFAULT_PACKAGE_CAPTION);
    flushDraftCaption(DEFAULT_PACKAGE_CAPTION);
    setAltTextByKey({});
    flushDraftAltText({});
    setOutputs((prev) => {
      prev?.forEach(({ url }) => URL.revokeObjectURL(url));
      return null;
    });
    setOutputSourceRefs([]);
    onChangeCardMeta(createEmptyCardMeta());
    deleteDraft(BEFORE_AFTER_PAIR_DRAFT_KEY);
    deleteDraft(PHOTO_SHARED_DRAFT_KEY);
  }

  /** Bank/slot thumbnail → its underlying File, for the card-info front image. */
  function resolveDroppedItemFile(event) {
    const dragged = readPairBankDragItem(event);
    if (!dragged) return null;
    const items = dragged.role === "before" ? beforeItems : afterItems;
    return items.find((item) => item.id === dragged.id)?.file ?? null;
  }

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

    const completePairs = pairs.filter((pair) => pair.before && pair.after);
    const selectedItems = completePairs.flatMap((pair) => [
      beforeItems.find((item) => item.id === pair.before) ?? null,
      afterItems.find((item) => item.id === pair.after) ?? null,
    ]);
    const files = await resolveStudioItemsToFiles(selectedItems, previewUrls);

    const validationError = validatePhotoPairFiles(files, "before-after-pair");
    if (validationError) {
      setError(validationError);
      return;
    }

    const metaError = validateCardMeta(cardMeta);
    if (metaError) {
      setError(metaError);
      return;
    }

    // One output per complete pair, in the same order — `generatePhotoOutputs`
    // (stitchBeforeAfterPairRows) never drops or reorders a complete pair. The
    // pair number comes from this index rather than the output key, which is
    // `"any"` (not `"pair-1"`) when there's only one pair.
    const nextSourceRefs = completePairs.map((pair, index) => [
      {
        role: "before",
        itemId: pair.before,
        label: "Before",
        exportName: `before-pair-${index + 1}`,
      },
      {
        role: "after",
        itemId: pair.after,
        label: "After",
        exportName: `after-pair-${index + 1}`,
      },
    ]);

    setBusy(true);
    try {
      const next = await generatePhotoOutputs(
        files,
        "before-after-pair",
        cardMetaToOverlayOptions(cardMeta),
        outputFormat,
      );
      setOutputs((prev) => {
        prev?.forEach(({ url }) => URL.revokeObjectURL(url));
        return next;
      });
      setOutputSourceRefs(nextSourceRefs);
      // The caption and alt text are deliberately left alone here: regenerating
      // is usually a tweak to the same post (a crop, a format switch), and
      // retyping the text every time is worse than the one case this gives up —
      // alt text is keyed by output key (`pair-N`, or `any` for a lone pair),
      // so swapping a pair's photos leaves the old text on that slot. Only
      // "Clear all" resets them.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadPackage() {
    if (!outputs?.length) return;
    setPackaging(true);
    setError("");
    try {
      await downloadStudioPackageZip({
        outputs,
        outputSources,
        exporters: exportersRef.current,
        altTextByKey,
        caption,
        cardMeta,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not build the download package.",
      );
    } finally {
      setPackaging(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl animate-fade-up">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <BackButton
            onClick={async () => {
              if (await requestLeave()) onBack();
            }}
          />
          {hasContent ? <ClearAllButton onClick={clearAll} /> : null}
        </div>
        <SectionHeading
          subtitle={`Before & after side-by-side. Add as many pair rows as you need — each complete pair becomes its own post. Output: ${activeFormat.sizeHint}.`}
        >
          1×2 formatter
        </SectionHeading>
      </div>

      <form onSubmit={handleGenerate} className="space-y-6">
        <div className="mx-auto max-w-3xl space-y-3">
          <GroupModeToggle
            value="before-after-pair"
            onChange={onChangeGroupBy}
          />
          <OutputFormatToggle
            value={outputFormat}
            onChange={onChangeOutputFormat}
          />
        </div>

        <StudioFolderBoard
          beforeItems={beforeItems}
          afterItems={afterItems}
          setBeforeItems={setBeforeItems}
          setAfterItems={setAfterItems}
          pairs={pairs}
          setPairs={setPairs}
          onError={setError}
        >
          <StudioCardMetaControls
            value={cardMeta}
            onChange={onChangeCardMeta}
            resolveDroppedItemFile={resolveDroppedItemFile}
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
        </StudioFolderBoard>
      </form>

      {outputs && (
        <div className="mx-auto max-w-3xl">
          <OutputGrid
            outputs={outputs}
            outputSources={outputSources}
            annotated
            exportersRef={exportersRef}
            altTextByKey={altTextByKey}
            onAltTextChange={(key, value) =>
              setAltTextByKey((current) => ({ ...current, [key]: value }))
            }
          />

          <div className="mt-10 space-y-4 rounded-xl border border-ink/15 bg-night/30 p-4">
            <p className="font-secondary text-sm font-semibold text-ink">
              Download package
            </p>

            <label className="block space-y-1.5">
              <span className="flex items-center justify-between gap-3">
                <span className="font-secondary text-xs font-semibold uppercase tracking-wide text-ink/50">
                  Caption
                </span>
                <button
                  type="button"
                  onClick={() => setCaption(DEFAULT_PACKAGE_CAPTION)}
                  disabled={caption === DEFAULT_PACKAGE_CAPTION}
                  className="shrink-0 rounded-lg border border-ink/20 px-2 py-1 font-secondary text-xs font-semibold text-ink/70 transition hover:border-berry/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Restore default
                </button>
              </span>
              <textarea
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                rows={6}
                className={`${INPUT_CLASS} resize-y`}
              />
            </label>

            <button
              type="button"
              onClick={handleDownloadPackage}
              disabled={packaging || busy}
              className="w-full rounded-xl border border-ink/20 bg-night/50 px-4 py-3 font-semibold text-ink transition hover:border-berry/40 hover:bg-night/70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {packaging ? "Building package…" : "Download package (.zip)"}
            </button>
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}

const FRONT_BACK_DRAG_TYPE = "text/pokepatch-front-back-item";
const FRONT_BACK_EMPTY_SLOTS = {
  beforeFront: null,
  beforeBack: null,
  afterFront: null,
  afterBack: null,
};
const FRONT_BACK_PAIR_DRAFT_KEY = "photo:front-back-pair";

function FrontBackPairPhotoFormatter({
  onBack,
  onChangeGroupBy,
  outputFormat,
  onChangeOutputFormat,
  cardMeta,
  onChangeCardMeta,
}) {
  const [beforeItems, setBeforeItems] = useState([]);
  const [afterItems, setAfterItems] = useState([]);
  const [slots, setSlots] = useState(FRONT_BACK_EMPTY_SLOTS);
  const [activeSlot, setActiveSlot] = useState(null);
  const [outputs, setOutputs] = useState(null);
  const [outputSources, setOutputSources] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activeFormat =
    PHOTO_OUTPUT_FORMATS.find((format) => format.id === outputFormat) ??
    PHOTO_OUTPUT_FORMATS[0];

  const allItems = useMemo(
    () => [...beforeItems, ...afterItems],
    [beforeItems, afterItems],
  );
  const previewUrls = useStableObjectUrls(allItems);

  const hasContent =
    beforeItems.length > 0 ||
    afterItems.length > 0 ||
    hasCardMetaContent(cardMeta);
  const { requestLeave, dialog } = useUnsavedChangesGuard(hasContent);

  const draftPayload = useMemo(
    () => ({ beforeItems, afterItems, slots }),
    [beforeItems, afterItems, slots],
  );
  const restored = useStudioDraft(
    FRONT_BACK_PAIR_DRAFT_KEY,
    draftPayload,
    hasContent,
  );
  useEffect(() => {
    if (!restored) return;
    setBeforeItems(restored.beforeItems ?? []);
    setAfterItems(restored.afterItems ?? []);
    setSlots(restored.slots ?? FRONT_BACK_EMPTY_SLOTS);
  }, [restored]);

  function clearAll() {
    if (!window.confirm("Clear all photos and card info loaded here?")) {
      return;
    }
    setBeforeItems([]);
    setAfterItems([]);
    setSlots(FRONT_BACK_EMPTY_SLOTS);
    onChangeCardMeta(createEmptyCardMeta());
    deleteDraft(FRONT_BACK_PAIR_DRAFT_KEY);
    deleteDraft(PHOTO_SHARED_DRAFT_KEY);
  }

  useEffect(() => {
    return () => {
      outputs?.forEach(({ url }) => URL.revokeObjectURL(url));
    };
  }, [outputs]);

  function addFiles(role, fileList) {
    const images = Array.from(fileList).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (images.length === 0) {
      setError("No images found in that folder.");
      return;
    }
    const setter = role === "before" ? setBeforeItems : setAfterItems;
    setter((prev) => [
      ...prev,
      ...images.map((file) => ({
        id: crypto.randomUUID(),
        file,
        crop: null,
        annotations: null,
      })),
    ]);
    setError("");
  }

  function findItem(role, id) {
    const items = role === "before" ? beforeItems : afterItems;
    return items.find((item) => item.id === id) ?? null;
  }

  function availableItems(role) {
    const items = role === "before" ? beforeItems : afterItems;
    const used = new Set(
      Object.entries(slots)
        .filter(([slotKey, id]) => slotKey.startsWith(role) && id)
        .map(([, id]) => id),
    );
    return items.filter((item) => !used.has(item.id));
  }

  function removeFolderItem(role, id) {
    const setter = role === "before" ? setBeforeItems : setAfterItems;
    setter((prev) => prev.filter((item) => item.id !== id));
    setSlots((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([slotKey, value]) => [
          slotKey,
          value === id ? null : value,
        ]),
      ),
    );
  }

  function updateItemCrop(role, id, crop) {
    const setter = role === "before" ? setBeforeItems : setAfterItems;
    setter((prev) =>
      prev.map((item) => (item.id === id ? { ...item, crop } : item)),
    );
    setError("");
  }

  function updateItemAnnotations(role, id, annotations) {
    const setter = role === "before" ? setBeforeItems : setAfterItems;
    setter((prev) =>
      prev.map((item) => (item.id === id ? { ...item, annotations } : item)),
    );
  }

  function clearFolder(role) {
    if (role === "before") {
      setBeforeItems([]);
    } else {
      setAfterItems([]);
    }
    setSlots((prev) => ({
      ...prev,
      ...(role === "before"
        ? { beforeFront: null, beforeBack: null }
        : { afterFront: null, afterBack: null }),
    }));
  }

  function assignToSlot(slotKey, role, id) {
    if (!findItem(role, id)) return;
    setSlots((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key.startsWith(role) && next[key] === id) next[key] = null;
      }
      next[slotKey] = id;
      return next;
    });
    setError("");
  }

  function clearSlot(slotKey) {
    setSlots((prev) => ({ ...prev, [slotKey]: null }));
  }

  function returnToBank(role, id) {
    setSlots((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([slotKey, value]) => [
          slotKey,
          value === id && slotKey.startsWith(role) ? null : value,
        ]),
      ),
    );
    setError("");
  }

  function handleBankItemDrop(event, role) {
    const dragged = readDragItem(event);
    if (dragged?.role === role) {
      returnToBank(role, dragged.id);
    }
  }

  function setDragItem(event, role, id) {
    event.dataTransfer.setData(FRONT_BACK_DRAG_TYPE, `${role}:${id}`);
    event.dataTransfer.effectAllowed = "move";
  }

  function readDragItem(event) {
    const raw = event.dataTransfer.getData(FRONT_BACK_DRAG_TYPE);
    if (!raw) return null;
    const separator = raw.indexOf(":");
    return { role: raw.slice(0, separator), id: raw.slice(separator + 1) };
  }

  /** Bank/slot thumbnail → its underlying File, for the card-info front image. */
  function resolveDroppedItemFile(event) {
    const dragged = readDragItem(event);
    if (!dragged) return null;
    return findItem(dragged.role, dragged.id)?.file ?? null;
  }

  async function handleGenerate(event) {
    event.preventDefault();
    setError("");

    const selectedItems = [
      slots.beforeFront ? findItem("before", slots.beforeFront) : null,
      slots.beforeBack ? findItem("before", slots.beforeBack) : null,
      slots.afterFront ? findItem("after", slots.afterFront) : null,
      slots.afterBack ? findItem("after", slots.afterBack) : null,
    ];
    const files = await resolveStudioItemsToFiles(selectedItems, previewUrls);

    const validationError = validatePhotoPairFiles(files, "front-back-pair");
    if (validationError) {
      setError(validationError);
      return;
    }

    const metaError = validateCardMeta(cardMeta);
    if (metaError) {
      setError(metaError);
      return;
    }

    // Same before/after order and presence check generatePhotoOutputs
    // (stitchBeforeAfterPosts) uses — "before" needs both front and back,
    // independently of whether "after" is present, and vice versa.
    const nextSources = [];
    if (selectedItems[0] && selectedItems[1]) {
      nextSources.push([
        {
          item: selectedItems[0],
          previewUrl: previewUrls[selectedItems[0].id],
          label: "Before · Front",
        },
        {
          item: selectedItems[1],
          previewUrl: previewUrls[selectedItems[1].id],
          label: "Before · Back",
        },
      ]);
    }
    if (selectedItems[2] && selectedItems[3]) {
      nextSources.push([
        {
          item: selectedItems[2],
          previewUrl: previewUrls[selectedItems[2].id],
          label: "After · Front",
        },
        {
          item: selectedItems[3],
          previewUrl: previewUrls[selectedItems[3].id],
          label: "After · Back",
        },
      ]);
    }

    setBusy(true);
    try {
      const next = await generatePhotoOutputs(
        files,
        "front-back-pair",
        cardMetaToOverlayOptions(cardMeta),
        outputFormat,
      );
      setOutputs((prev) => {
        prev?.forEach(({ url }) => URL.revokeObjectURL(url));
        return next;
      });
      setOutputSources(nextSources);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const sections = [
    {
      role: "before",
      title: "Before",
      slots: [
        { key: "beforeFront", label: "Front" },
        { key: "beforeBack", label: "Back" },
      ],
    },
    {
      role: "after",
      title: "After",
      slots: [
        { key: "afterFront", label: "Front" },
        { key: "afterBack", label: "Back" },
      ],
    },
  ];

  /** Filled slots in section order — the "Download all" payload. */
  const filledSlots = sections.flatMap((section) =>
    section.slots
      .map(({ key, label }) => {
        const slotItem = slots[key] ? findItem(section.role, slots[key]) : null;
        const url = slotItem ? previewUrls[slotItem.id] : null;
        return slotItem && url
          ? {
              item: slotItem,
              previewUrl: url,
              label: `${section.title}-${label}`,
            }
          : null;
      })
      .filter(Boolean),
  );

  return (
    <div className="mx-auto max-w-6xl animate-fade-up">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <BackButton
            onClick={async () => {
              if (await requestLeave()) onBack();
            }}
          />
          {hasContent ? <ClearAllButton onClick={clearAll} /> : null}
        </div>
        <SectionHeading
          subtitle={`Front & back side-by-side. Fill Before for one post; After is optional for a second. Output: ${activeFormat.sizeHint}.`}
        >
          1×2 formatter
        </SectionHeading>
      </div>

      <form onSubmit={handleGenerate} className="space-y-6">
        <div className="mx-auto max-w-3xl space-y-3">
          <GroupModeToggle value="front-back-pair" onChange={onChangeGroupBy} />
          <OutputFormatToggle
            value={outputFormat}
            onChange={onChangeOutputFormat}
          />
        </div>

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
            onItemDrop={(event) => handleBankItemDrop(event, "before")}
          />

          <div className="min-w-0 flex-1 space-y-6">
            <div className="space-y-4">
              {sections.map((section) => (
                <div key={section.role} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                    {section.title}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {section.slots.map(({ key, label }, slotPosition) => {
                      const item = slots[key]
                        ? findItem(section.role, slots[key])
                        : null;
                      const preview = item ? previewUrls[item.id] : null;
                      const isActive = activeSlot === key;

                      const siblingSlot =
                        section.slots[slotPosition === 0 ? 1 : 0];
                      const siblingItem = slots[siblingSlot.key]
                        ? findItem(section.role, slots[siblingSlot.key])
                        : null;
                      const sibling =
                        siblingItem && previewUrls[siblingItem.id]
                          ? {
                              item: siblingItem,
                              src: previewUrls[siblingItem.id],
                              alt: `${section.title} ${siblingSlot.label} — ${siblingItem.file.name}`,
                              label: `${section.title} ${siblingSlot.label}`,
                              side: slotPosition === 0 ? "right" : "left",
                              onCropChange: (crop) =>
                                updateItemCrop(
                                  section.role,
                                  siblingItem.id,
                                  crop,
                                ),
                              onAnnotationsChange: (annotations) =>
                                updateItemAnnotations(
                                  section.role,
                                  siblingItem.id,
                                  annotations,
                                ),
                            }
                          : null;

                      return (
                        <div
                          key={key}
                          onDragOver={(event) => {
                            event.preventDefault();
                            setActiveSlot(key);
                          }}
                          onDragLeave={() =>
                            setActiveSlot((prev) => (prev === key ? null : prev))
                          }
                          onDrop={(event) => {
                            event.preventDefault();
                            setActiveSlot(null);
                            const dragged = readDragItem(event);
                            if (dragged?.role === section.role) {
                              assignToSlot(key, section.role, dragged.id);
                            }
                          }}
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
                              onDragStart={(event) =>
                                setDragItem(event, section.role, item.id)
                              }
                              className="cursor-grab p-3 active:cursor-grabbing"
                            >
                              <StudioCroppableThumb
                                item={item}
                                src={preview}
                                alt={`${section.title} ${label} — ${item.file.name}`}
                                label={`${section.title} ${label}`}
                                previewClassName="rounded-lg"
                                onCropChange={(crop) =>
                                  updateItemCrop(section.role, item.id, crop)
                                }
                                onAnnotationsChange={(annotations) =>
                                  updateItemAnnotations(
                                    section.role,
                                    item.id,
                                    annotations,
                                  )
                                }
                                sibling={sibling}
                              />
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <p className="truncate text-xs text-ink/50">
                                  {item.file.name}
                                </p>
                                <div className="flex shrink-0 items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      downloadSlotImages([
                                        {
                                          item,
                                          previewUrl: preview,
                                          label: `${section.title}-${label}`,
                                        },
                                      ]);
                                    }}
                                    className="text-xs font-semibold text-blush/90 hover:text-blush"
                                  >
                                    Download
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      clearSlot(key);
                                    }}
                                    className="text-xs font-semibold text-berry/90 hover:text-berry"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                              <p className="mt-1 text-[10px] text-ink/35">
                                Click to crop or annotate
                              </p>
                            </div>
                          ) : (
                            <p className="px-3 py-10 text-center text-xs text-ink/30">
                              Drop {section.title.toLowerCase()} {label.toLowerCase()} here
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {filledSlots.length > 1 ? (
              <button
                type="button"
                onClick={() => downloadSlotImages(filledSlots)}
                className="w-full rounded-xl border border-ink/20 bg-night/50 px-4 py-2.5 font-secondary text-sm font-semibold text-ink transition hover:border-berry/40 hover:bg-night/70"
              >
                Download all slot images ({filledSlots.length})
              </button>
            ) : null}

            <StudioCardMetaControls
              value={cardMeta}
              onChange={onChangeCardMeta}
              resolveDroppedItemFile={resolveDroppedItemFile}
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
            onItemDrop={(event) => handleBankItemDrop(event, "after")}
          />
        </div>
      </form>

      {outputs && (
        <div className="mx-auto max-w-3xl">
          <OutputGrid outputs={outputs} outputSources={outputSources} annotated />
        </div>
      )}
      {dialog}
    </div>
  );
}

const PHOTO_SHARED_DRAFT_KEY = "photo:shared";

function PhotoFormatter({ onBack }) {
  const [groupBy, setGroupBy] = useState("before-after-pair");
  const [outputFormat, setOutputFormat] = useState("square");
  const [cardMeta, setCardMeta] = useState(createEmptyCardMeta);

  // Card info (name/set/caption/front image) is shared across both 1×2
  // submodes and owned here; each submode persists its own photos/pairs
  // separately (see BEFORE_AFTER_PAIR_DRAFT_KEY / FRONT_BACK_PAIR_DRAFT_KEY).
  const draftPayload = useMemo(
    () => ({ groupBy, outputFormat, cardMeta }),
    [groupBy, outputFormat, cardMeta],
  );
  const restored = useStudioDraft(
    PHOTO_SHARED_DRAFT_KEY,
    draftPayload,
    hasCardMetaContent(cardMeta),
  );
  useEffect(() => {
    if (!restored) return;
    if (restored.groupBy) setGroupBy(restored.groupBy);
    if (restored.outputFormat) setOutputFormat(restored.outputFormat);
    if (restored.cardMeta) {
      const frontFile = restored.cardMeta.frontFile ?? null;
      setCardMeta({
        ...restored.cardMeta,
        // Restored blob URL is dead after reload — mint a fresh one, same
        // as StudioCardMetaControls does for a freshly-picked file.
        frontPreviewUrl: frontFile ? URL.createObjectURL(frontFile) : null,
      });
    }
  }, [restored]);

  if (groupBy === "before-after-pair") {
    return (
      <BeforeAfterPairPhotoFormatter
        onBack={onBack}
        onChangeGroupBy={setGroupBy}
        outputFormat={outputFormat}
        onChangeOutputFormat={setOutputFormat}
        cardMeta={cardMeta}
        onChangeCardMeta={setCardMeta}
      />
    );
  }

  if (groupBy === "front-back-pair") {
    return (
      <FrontBackPairPhotoFormatter
        onBack={onBack}
        onChangeGroupBy={setGroupBy}
        outputFormat={outputFormat}
        onChangeOutputFormat={setOutputFormat}
        cardMeta={cardMeta}
        onChangeCardMeta={setCardMeta}
      />
    );
  }

  return null;
}

export default function StudioTool() {
  const router = useRouter();
  const pathname = usePathname();
  const mode = modeFromPathname(pathname);
  const goBack = () => router.push(STUDIO_BASE);

  if (mode === "photo") {
    return <PhotoFormatter onBack={goBack} />;
  }

  return <StudioSelector onSelect={(id) => router.push(studioRoute(id))} />;
}

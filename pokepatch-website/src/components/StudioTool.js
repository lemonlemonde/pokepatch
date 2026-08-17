"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StudioFolderBoard, {
  createPair,
  readDragItem as readPairBankDragItem,
} from "@/components/StudioFolderBoard";
import StudioOpenableThumb from "@/components/StudioOpenableThumb";
import GalleryCardSearch from "@/components/admin/GalleryCardSearch";
import { fetchTcgCardImageFile } from "@/lib/tcgCardImage";
import { resolveStudioImageSource } from "@/lib/studioSlotImage";
import { publishStudioPairsToGallery } from "@/lib/studioToGallery";
import { buildStudioSeedFromGalleryItem } from "@/lib/galleryToStudio";
import StudioAnnotatedPreview from "@/components/StudioAnnotatedPreview";
import { downloadBlob } from "@/lib/downloadFile";
import useDebouncedValue from "@/lib/useDebouncedValue";
import useStableObjectUrls from "@/lib/useStableObjectUrls";
import useStudioDraft from "@/lib/useStudioDraft";
import { deleteDraft } from "@/lib/studioDraftDb";
import {
  OUTPUT_EXT,
  canvasToBlob,
  stitchBeforeAfterPairRows,
} from "@/lib/instagramStitch";
import {
  DEFAULT_PACKAGE_CAPTION,
  downloadStudioPackageZip,
} from "@/lib/studioPackageZip";
import {
  STUDIO_EXPORT_SCALE,
  getOutputCanvasSize,
} from "@/lib/studioLayout";

const INPUT_CLASS =
  "w-full rounded-xl border border-ink/15 bg-cream px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-ink/40";

function createEmptyCardMeta() {
  return {
    frontFile: null,
    frontPreviewUrl: null,
    card: "",
    set: "",
    showCardInfo: true,
  };
}

function validateCardMeta(meta) {
  if (meta.showCardInfo) {
    if (!meta.frontFile) return "Card info needs a front image.";
    if (!meta.card.trim()) return "Card info needs a card name.";
    if (!meta.set.trim()) return "Card info needs a set name.";
  }
  return null;
}

function cardMetaToOverlayOptions(meta) {
  return {
    showCardInfo: meta.showCardInfo,
    frontFile: meta.frontFile,
    card: meta.card.trim(),
    set: meta.set.trim(),
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
          checked ? "bg-ink" : "bg-ink/25"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-cream transition ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

/**
 * `resolveDroppedItemFile` lets the front image accept a thumbnail dragged out
 * of the Before/After photo lists, not just an OS file drop.
 */
function StudioCardMetaControls({
  value,
  onChange,
  resolveDroppedItemFile = null,
}) {
  const frontInputId = useId();
  const cardInfoSwitchId = useId();
  const [uploadDragging, setUploadDragging] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pickedCard, setPickedCard] = useState(null);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState("");

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

  async function applySearchedCard(card) {
    setPickedCard(card);
    setPickError("");
    setPicking(true);
    try {
      const file = await fetchTcgCardImageFile(card);
      patch({
        frontFile: file,
        frontPreviewUrl: URL.createObjectURL(file),
        card: (card.name ?? "").trim() || value.card,
        set: (card.set_name ?? "").trim() || value.set,
      });
    } catch {
      setPickError("Couldn't download that card's image. Try another, or upload one.");
    } finally {
      setPicking(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-ink/15 bg-night/30 p-4">
      <div>
        <p className="font-secondary text-sm font-semibold text-ink">
          Card info overlay
        </p>
        <p className="mt-0.5 text-xs text-ink/50">
          Optional chip in the corner of each generated post
        </p>
      </div>

      <MetaSwitch
        id={cardInfoSwitchId}
        label="Include card info"
        description="Front thumbnail, card name, and set"
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
                uploadDragging ? "ring-2 ring-ink/60" : ""
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
                      className="cursor-pointer rounded-lg border border-ink/20 px-2 py-1 text-center font-secondary text-xs font-semibold text-ink/70 transition hover:border-ink/40 hover:text-ink"
                    >
                      Replace
                    </label>
                    <button
                      type="button"
                      onClick={clearFront}
                      className="rounded-lg border border-ink/20 px-2 py-1 font-secondary text-xs font-semibold text-ink/70 transition hover:border-ink/40 hover:text-ink"
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
                      ? "border-ink bg-ink/10"
                      : "border-ink/25 bg-night/40 hover:border-ink/40 hover:bg-night/60"
                  }`}
                >
                  <p className="text-xs text-ink/70">
                    Drop image here or browse
                  </p>
                  {resolveDroppedItemFile ? (
                    <p className="text-[10px] text-ink/40">
                      or drag one in from Before/After photos
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
            <button
              type="button"
              onClick={() => setSearchOpen((open) => !open)}
              aria-expanded={searchOpen}
              className="justify-self-start rounded-lg border border-ink/20 px-3 py-1.5 font-secondary text-xs font-semibold text-ink/70 transition hover:border-ink/40 hover:text-ink"
            >
              {searchOpen ? "Hide catalog search" : "Search TCG catalog"}
            </button>
          </div>
        </div>
      ) : null}

      {value.showCardInfo && searchOpen ? (
        <div className="space-y-2 border-t border-ink/10 pt-3">
          <GalleryCardSearch
            selectedCard={pickedCard}
            onSelect={applySearchedCard}
            onClear={() => {
              setPickedCard(null);
              setPickError("");
              clearFront();
            }}
            initialCardName={value.card}
            initialSetName={value.set}
            disabled={picking}
          />
          {picking ? (
            <p className="font-secondary text-xs text-ink/50">
              Downloading card image…
            </p>
          ) : null}
          {pickError ? (
            <p className="font-secondary text-xs font-semibold text-ink">
              {pickError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Exported pixel size for a format — supersampled for export. */
function exportSizeHint(format) {
  const { width, height } = getOutputCanvasSize(format);
  return `${width * STUDIO_EXPORT_SCALE}×${height * STUDIO_EXPORT_SCALE}`;
}

const PHOTO_OUTPUT_FORMATS = [
  {
    id: "reel",
    label: "Reel 9:16",
    sizeHint: exportSizeHint("reel"),
  },
  {
    id: "carousel",
    label: "Carousel 4:5",
    sizeHint: exportSizeHint("carousel"),
  },
];

/** Map older draft format ids onto the current set. */
function normalizeOutputFormat(format) {
  if (format === "carousel" || format === "reel") return format;
  if (format === "square") return "carousel";
  return "reel";
}

function ClearAllButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-ink/20 bg-night/40 px-4 py-2 font-secondary text-sm font-semibold text-ink/90 transition hover:border-ink/40 hover:bg-night/60 hover:text-ink"
    >
      Clear all
    </button>
  );
}

/** Has the user typed or uploaded anything into the card-info panel? */
function hasCardMetaContent(cardMeta) {
  return Boolean(
    cardMeta.frontFile || cardMeta.card.trim() || cardMeta.set.trim(),
  );
}

/**
 * Finalized-output grid. Per-post downloads and source-image downloads are
 * intentionally omitted — use "Download all" or the package zip at the bottom.
 *
 * `onAltTextChange`, when given, turns on a per-post alt text field under each
 * image — only the package download consumes alt text.
 */
function OutputGrid({
  outputs,
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

  return (
    <div className="mt-10">
      <div className="grid gap-10 sm:grid-cols-2">
        {outputs.map((output) => {
          const altTextField = onAltTextChange ? (
            <label className="block space-y-1.5 text-left">
              <span className="font-secondary text-xs font-semibold uppercase tracking-wide text-ink/50">
                Alt text
              </span>
              <p className="text-[11px] leading-snug text-ink/40">
                Optional Instagram accessibility text — not drawn on the image.
                Included in the zip package below.
              </p>
              <textarea
                value={altTextByKey[output.key] ?? ""}
                onChange={(event) =>
                  onAltTextChange(output.key, event.target.value)
                }
                rows={2}
                placeholder="e.g. Before and after of a crease repair on Sylveon-GX"
                className={`${INPUT_CLASS} resize-y`}
              />
            </label>
          ) : null;
          return (
            <div key={output.key} className="space-y-4 text-center">
              <p className="font-secondary text-sm text-ink/60">
                {output.sizeHint
                  ? `${output.label} · ${output.sizeHint}`
                  : output.label}
              </p>
              <StudioAnnotatedPreview
                label={output.label}
                url={output.url}
                filename={output.filename}
                onExporterChange={(exporter) =>
                  setExporter(output.key, exporter)
                }
              >
                {altTextField}
              </StudioAnnotatedPreview>
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
async function canvasOutputsFromPairs(
  pairs,
  sizeHint = exportSizeHint("reel"),
) {
  return Promise.all(
    pairs.map(async ({ key, label, canvas }) => {
      const blob = await canvasToBlob(canvas);
      return {
        key,
        label,
        sizeHint,
        blob,
        url: URL.createObjectURL(blob),
        filename: `pokepatch-${key}.${OUTPUT_EXT}`,
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

function validatePhotoPairFiles(files) {
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

async function generatePhotoOutputs(files, overlayOptions = null, format = "reel") {
  const sizeHint =
    PHOTO_OUTPUT_FORMATS.find((entry) => entry.id === format)?.sizeHint ??
    exportSizeHint("reel");
  const pairs = await stitchBeforeAfterPairRows(files, overlayOptions, format);
  return canvasOutputsFromPairs(pairs, sizeHint);
}

/** Formatter inputs — a File per untouched slot, a canvas per edited one. */
async function resolveStudioItemsToSources(items, previewUrls) {
  return Promise.all(
    items.map((item) =>
      item && previewUrls[item.id]
        ? resolveStudioImageSource(item, previewUrls[item.id])
        : null,
    ),
  );
}

function OutputFormatToggle({ value, onChange }) {
  return (
    <div
      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
      role="group"
      aria-label="Output format"
    >
      <p className="font-secondary text-sm text-ink/60">Format</p>
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
                  ? "bg-ink text-night "
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
const PHOTO_SHARED_DRAFT_KEY = "photo:shared";

/**
 * The caption and alt text reach the draft this far behind the field, so a
 * burst of typing doesn't re-write a payload that carries every uploaded photo
 * and generated image with it. Photo edits still save on the draft's own
 * shorter debounce.
 */
const TEXT_DRAFT_DEBOUNCE_MS = 2000;

function BeforeAfterPairPhotoFormatter({
  outputFormat,
  onChangeOutputFormat,
  cardMeta,
  onChangeCardMeta,
  gallerySeed = null,
}) {
  const router = useRouter();
  const [beforeItems, setBeforeItems] = useState([]);
  const [afterItems, setAfterItems] = useState([]);
  const [pairs, setPairs] = useState(() => [createPair()]);
  const [outputs, setOutputs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sendingToGallery, setSendingToGallery] = useState(false);
  const [error, setError] = useState("");
  const [caption, setCaption] = useState(DEFAULT_PACKAGE_CAPTION);
  const [altTextByKey, setAltTextByKey] = useState({});
  const [packaging, setPackaging] = useState(false);
  const [downloadingImages, setDownloadingImages] = useState(false);
  const exportersRef = useRef(new Map());
  const resultsRef = useRef(null);
  const gallerySeedAppliedRef = useRef(null);
  const activeFormat =
    PHOTO_OUTPUT_FORMATS.find((format) => format.id === outputFormat) ??
    PHOTO_OUTPUT_FORMATS[0];

  const completePairCount = useMemo(
    () => pairs.filter((pair) => pair.before && pair.after).length,
    [pairs],
  );

  const allItems = useMemo(
    () => [...beforeItems, ...afterItems],
    [beforeItems, afterItems],
  );
  const previewUrls = useStableObjectUrls(allItems);

  const hasContent =
    beforeItems.length > 0 ||
    afterItems.length > 0 ||
    hasCardMetaContent(cardMeta);

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
      outputs: outputs?.map(({ url, ...rest }) => rest) ?? null,
    }),
    [
      beforeItems,
      afterItems,
      pairs,
      draftCaption,
      draftAltText,
      outputs,
    ],
  );
  const restored = useStudioDraft(
    BEFORE_AFTER_PAIR_DRAFT_KEY,
    draftPayload,
    hasContent,
  );
  useEffect(() => {
    if (gallerySeed) {
      if (gallerySeedAppliedRef.current === gallerySeed) return;
      gallerySeedAppliedRef.current = gallerySeed;

      setOutputs((prev) => {
        prev?.forEach(({ url }) => URL.revokeObjectURL(url));
        return null;
      });
      setBeforeItems(gallerySeed.beforeItems ?? []);
      setAfterItems(gallerySeed.afterItems ?? []);
      setPairs(
        gallerySeed.pairs?.length ? gallerySeed.pairs : [createPair()],
      );
      setCaption(DEFAULT_PACKAGE_CAPTION);
      flushDraftCaption(DEFAULT_PACKAGE_CAPTION);
      setAltTextByKey({});
      flushDraftAltText({});
      setError("");
      return;
    }

    if (!restored) return;
    setBeforeItems(restored.beforeItems ?? []);
    setAfterItems(restored.afterItems ?? []);
    setPairs(restored.pairs?.length ? restored.pairs : [createPair()]);
    const restoredCaption = restored.caption ?? DEFAULT_PACKAGE_CAPTION;
    const restoredAltText = restored.altTextByKey ?? {};
    setCaption(restoredCaption);
    flushDraftCaption(restoredCaption);
    setAltTextByKey(restoredAltText);
    flushDraftAltText(restoredAltText);
    const restoredOutputs = outputsFromDraft(restored.outputs);
    setOutputs(restoredOutputs.length ? restoredOutputs : null);
  }, [restored, gallerySeed, flushDraftCaption, flushDraftAltText]);

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
    onChangeCardMeta(createEmptyCardMeta());
    deleteDraft(BEFORE_AFTER_PAIR_DRAFT_KEY);
    deleteDraft(PHOTO_SHARED_DRAFT_KEY);
  }

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
    const files = await resolveStudioItemsToSources(selectedItems, previewUrls);

    const validationError = validatePhotoPairFiles(files);
    if (validationError) {
      setError(validationError);
      return;
    }

    const metaError = validateCardMeta(cardMeta);
    if (metaError) {
      setError(metaError);
      return;
    }

    setBusy(true);
    try {
      const next = await generatePhotoOutputs(
        files,
        cardMetaToOverlayOptions(cardMeta),
        outputFormat,
      );
      setOutputs((prev) => {
        prev?.forEach(({ url }) => URL.revokeObjectURL(url));
        return next;
      });
      requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendToGallery() {
    setError("");

    const partial = pairs.some(
      (pair) => Boolean(pair.before) !== Boolean(pair.after),
    );
    if (partial) {
      setError("Each pair needs both a before and an after (or remove it).");
      return;
    }

    if (!cardMeta.card.trim()) {
      setError("Add a card name before sending to gallery.");
      return;
    }

    if (completePairCount === 0) {
      setError("Fill at least one complete before & after pair.");
      return;
    }

    setSendingToGallery(true);
    try {
      await publishStudioPairsToGallery({
        pairs,
        beforeItems,
        afterItems,
        previewUrls,
        meta: {
          title: cardMeta.card.trim(),
          set_name: cardMeta.set.trim(),
        },
      });
      router.push("/admin/gallery/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send to gallery.",
      );
    } finally {
      setSendingToGallery(false);
    }
  }

  async function handleDownloadAllImages() {
    if (!outputs?.length) return;
    setDownloadingImages(true);
    try {
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
    } finally {
      setDownloadingImages(false);
    }
  }

  async function handleDownloadPackage() {
    if (!outputs?.length) return;
    setPackaging(true);
    setError("");
    try {
      await downloadStudioPackageZip({
        outputs,
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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <OutputFormatToggle
          value={outputFormat}
          onChange={onChangeOutputFormat}
        />
        {hasContent ? <ClearAllButton onClick={clearAll} /> : null}
      </div>

      <p className="mb-4 text-sm text-ink/50">
        Export size: {activeFormat.sizeHint}. Work is saved in this browser
        until you clear it.
      </p>

      <form onSubmit={handleGenerate} className="space-y-6">
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
            <p className="text-center text-sm text-error" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={busy || sendingToGallery || completePairCount === 0}
              className="w-full flex-1 rounded-xl bg-ink px-4 py-3 font-semibold text-night transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy
                ? "Generating…"
                : completePairCount === 0
                  ? "Fill a before & after pair to generate"
                  : completePairCount === 1
                    ? "Generate post"
                    : `Generate ${completePairCount} posts`}
            </button>
            <button
              type="button"
              onClick={handleSendToGallery}
              disabled={busy || sendingToGallery || completePairCount === 0}
              className="w-full flex-1 rounded-xl border border-ink/20 bg-night/50 px-4 py-3 font-semibold text-ink transition hover:border-ink/40 hover:bg-night/70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sendingToGallery
                ? "Sending to gallery…"
                : completePairCount <= 1
                  ? "Send to gallery"
                  : `Send ${completePairCount} pairs to gallery`}
            </button>
          </div>
        </StudioFolderBoard>
      </form>

      {outputs && (
        <div ref={resultsRef} className="mx-auto max-w-3xl scroll-mt-28">
          <OutputGrid
            outputs={outputs}
            exportersRef={exportersRef}
            altTextByKey={altTextByKey}
            onAltTextChange={(key, value) =>
              setAltTextByKey((current) => ({ ...current, [key]: value }))
            }
          />

          <div className="mt-10 space-y-4 rounded-xl border border-ink/15 bg-night/30 p-4">
            <div>
              <p className="font-secondary text-sm font-semibold text-ink">
                Downloads
              </p>
              <p className="mt-1 text-xs text-ink/50">
                Images alone, or a zip with caption.txt, optional alt-text
                files, and card name/set for posting.
              </p>
            </div>

            <label className="block space-y-1.5">
              <span className="flex items-center justify-between gap-3">
                <span className="font-secondary text-xs font-semibold uppercase tracking-wide text-ink/50">
                  Post caption
                </span>
                <button
                  type="button"
                  onClick={() => setCaption(DEFAULT_PACKAGE_CAPTION)}
                  disabled={caption === DEFAULT_PACKAGE_CAPTION}
                  className="shrink-0 rounded-lg border border-ink/20 px-2 py-1 font-secondary text-xs font-semibold text-ink/70 transition hover:border-ink/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
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

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleDownloadAllImages}
                disabled={downloadingImages || packaging || busy}
                className="flex-1 rounded-xl bg-ink px-4 py-3 font-semibold text-night transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {downloadingImages
                  ? "Downloading…"
                  : outputs.length > 1
                    ? `Download all images (${outputs.length})`
                    : "Download image"}
              </button>
              <button
                type="button"
                onClick={handleDownloadPackage}
                disabled={packaging || downloadingImages || busy}
                className="flex-1 rounded-xl border border-ink/20 bg-night/50 px-4 py-3 font-semibold text-ink transition hover:border-ink/40 hover:bg-night/70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {packaging ? "Building package…" : "Download package (.zip)"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StudioTool() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromGalleryParam = searchParams.get("fromGallery");
  const [outputFormat, setOutputFormat] = useState("reel");
  const [cardMeta, setCardMeta] = useState(createEmptyCardMeta);
  const [gallerySeed, setGallerySeed] = useState(null);
  const [galleryImporting, setGalleryImporting] = useState(Boolean(fromGalleryParam));
  const [galleryImportError, setGalleryImportError] = useState("");
  const galleryImportStartedRef = useRef(null);

  const draftPayload = useMemo(
    () => ({ outputFormat, cardMeta }),
    [outputFormat, cardMeta],
  );
  const restored = useStudioDraft(
    PHOTO_SHARED_DRAFT_KEY,
    draftPayload,
    hasCardMetaContent(cardMeta),
  );
  useEffect(() => {
    if (gallerySeed || galleryImporting) return;
    if (!restored) return;
    if (restored.outputFormat) {
      setOutputFormat(normalizeOutputFormat(restored.outputFormat));
    }
    if (restored.cardMeta) {
      const frontFile = restored.cardMeta.frontFile ?? null;
      setCardMeta({
        showCardInfo: restored.cardMeta.showCardInfo ?? true,
        card: restored.cardMeta.card ?? "",
        set: restored.cardMeta.set ?? "",
        frontFile,
        frontPreviewUrl: frontFile ? URL.createObjectURL(frontFile) : null,
      });
    }
  }, [restored, gallerySeed, galleryImporting]);

  useEffect(() => {
    const itemId = (fromGalleryParam ?? "").trim();
    if (!itemId) return undefined;
    if (galleryImportStartedRef.current === itemId) return undefined;
    galleryImportStartedRef.current = itemId;

    let cancelled = false;
    setGalleryImporting(true);
    setGalleryImportError("");

    (async () => {
      try {
        const seed = await buildStudioSeedFromGalleryItem(itemId);
        if (cancelled) return;

        await Promise.all([
          deleteDraft(BEFORE_AFTER_PAIR_DRAFT_KEY),
          deleteDraft(PHOTO_SHARED_DRAFT_KEY),
        ]);
        if (cancelled) return;

        const frontFile = seed.cardMeta.frontFile ?? null;
        setCardMeta({
          showCardInfo: seed.cardMeta.showCardInfo ?? true,
          card: seed.cardMeta.card ?? "",
          set: seed.cardMeta.set ?? "",
          frontFile,
          frontPreviewUrl: frontFile ? URL.createObjectURL(frontFile) : null,
        });
        setGallerySeed(seed);
      } catch (err) {
        if (!cancelled) {
          setGalleryImportError(
            err instanceof Error
              ? err.message
              : "Could not load that gallery item into Studio.",
          );
        }
      } finally {
        if (!cancelled) {
          setGalleryImporting(false);
          router.replace("/admin/studio/");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fromGalleryParam, router]);

  if (galleryImporting) {
    return (
      <div className="py-16 text-center">
        <p className="animate-soft-bounce text-sm font-semibold text-ink/70">
          Loading gallery images into Studio…
        </p>
      </div>
    );
  }

  return (
    <>
      {galleryImportError ? (
        <p className="mb-4 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
          {galleryImportError}
        </p>
      ) : null}
      <BeforeAfterPairPhotoFormatter
        outputFormat={outputFormat}
        onChangeOutputFormat={setOutputFormat}
        cardMeta={cardMeta}
        onChangeCardMeta={setCardMeta}
        gallerySeed={gallerySeed}
      />
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import SectionHeading from "@/components/SectionHeading";
import StudioMediaBank, {
  BEFORE_AFTER_PAIR_SLOT_GROUPS,
  EMPTY_SLOTS,
  FRONT_BACK_PAIR_SLOT_GROUPS,
} from "@/components/StudioMediaBank";
import StudioFolderBoard, { createPair } from "@/components/StudioFolderBoard";
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

function downloadAll(outputs) {
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

function OutputGrid({ outputs, renderPreview }) {
  return (
    <div className="mt-10 space-y-8">
      {outputs.length > 1 && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => downloadAll(outputs)}
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
            {renderPreview(output)}
            <a
              href={output.url}
              download={output.filename}
              className="inline-block rounded-xl border border-ink/20 bg-night/50 px-6 py-3 font-semibold text-ink transition hover:border-berry/40 hover:bg-night/70"
            >
              Download {output.label.toLowerCase()}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImagePreview({ label, url }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`${label} preview`}
      className="mx-auto max-w-full rounded-xl border border-ink/15 shadow-cozy-sm"
    />
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
  controls = null,
  resetKey = null,
  slotGroups,
  validateFiles = null,
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

      {outputs && <OutputGrid outputs={outputs} renderPreview={renderPreview} />}
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

async function generatePhotoOutputs(files, groupBy) {
  if (groupBy === "front-back-pair") {
    const canvases = await stitchBeforeAfterPosts(files);
    const pairs = [];
    if (canvases.before) {
      pairs.push({ key: "before", label: "Before", canvas: canvases.before });
    }
    if (canvases.after) {
      pairs.push({ key: "after", label: "After", canvas: canvases.after });
    }
    return canvasOutputsFromPairs(pairs);
  }

  const canvases = await stitchBothPosts(files);
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
      onGenerate={(files) => generatePhotoOutputs(files, groupBy)}
      validateFiles={(files) => validatePhotoPairFiles(files, groupBy)}
      renderPreview={ImagePreview}
      resetKey={groupBy}
      slotGroups={activeMode.slotGroups}
      controls={
        <GroupModeToggle value={groupBy} onChange={setGroupBy} />
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

    setBusy(true);
    try {
      const canvases = await stitchGridPosts(files);
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
          <OutputGrid outputs={outputs} renderPreview={ImagePreview} />
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

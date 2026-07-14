"use client";

import { useEffect, useState } from "react";
import SectionHeading from "@/components/SectionHeading";
import StudioMediaBank, { EMPTY_SLOTS } from "@/components/StudioMediaBank";
import { canvasToBlob, stitchBothPosts } from "@/lib/instagramStitch";
import {
  extensionForMimeType,
  stitchBothVideos,
} from "@/lib/instagramVideoStitch";

const FORMATTER_SUBTITLE =
  "Before & after fronts side-by-side, then backs. Black background, white labels. 1080×1080.";

function StudioSelector({ onSelect }) {
  return (
    <div className="mx-auto max-w-3xl animate-fade-up">
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onSelect("photo")}
          className="rounded-xl border border-ink/20 bg-night/50 px-6 py-10 text-left shadow-cozy-sm transition hover:border-berry/40 hover:bg-night/70"
        >
          <p className="font-display text-xl font-bold text-ink">Photo formatter</p>
          <p className="mt-2 font-secondary text-sm text-ink/60">
            Side-by-side before & after PNGs for front and back. 1080×1080 with
            labels and branding.
          </p>
        </button>
        <button
          type="button"
          onClick={() => onSelect("video")}
          className="rounded-xl border border-ink/20 bg-night/50 px-6 py-10 text-left shadow-cozy-sm transition hover:border-berry/40 hover:bg-night/70"
        >
          <p className="font-display text-xl font-bold text-ink">Video formatter</p>
          <p className="mt-2 font-secondary text-sm text-ink/60">
            Side-by-side before & after videos for front and back. Same layout,
            labels, and branding as photos.
          </p>
        </button>
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

function MediaFormatter({
  mediaType,
  title,
  emptySlotMessage,
  generateLabel,
  busyLabel,
  onBack,
  onGenerate,
  renderPreview,
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

  function getSlotFiles() {
    return slots.map((id) => bank.find((item) => item.id === id)?.file ?? null);
  }

  async function handleGenerate(event) {
    event.preventDefault();
    setError("");

    const files = getSlotFiles();
    if (files.some((file) => !file)) {
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
      <SectionHeading subtitle={FORMATTER_SUBTITLE}>{title}</SectionHeading>

      <form onSubmit={handleGenerate} className="space-y-6">
        <StudioMediaBank
          mediaType={mediaType}
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
          {busy ? busyLabel : generateLabel}
        </button>
      </form>

      {outputs && (
        <div className="mt-10 grid gap-10 sm:grid-cols-2">
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
      )}
    </div>
  );
}

async function generatePhotoOutputs(files) {
  const { front, back } = await stitchBothPosts(files);
  const pairs = [
    { key: "front", label: "Front", canvas: front },
    { key: "back", label: "Back", canvas: back },
  ];

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

function PhotoFormatter({ onBack }) {
  return (
    <MediaFormatter
      mediaType="image"
      title="Photo formatter"
      emptySlotMessage="Drag an image into each of the 4 slots."
      generateLabel="Generate images"
      busyLabel="Generating…"
      onBack={onBack}
      onGenerate={generatePhotoOutputs}
      renderPreview={({ label, url }) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`${label} preview`}
          className="mx-auto max-w-full rounded-xl border border-ink/15 shadow-cozy-sm"
        />
      )}
    />
  );
}

function VideoFormatter({ onBack }) {
  return (
    <MediaFormatter
      mediaType="video"
      title="Video formatter"
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

export default function StudioTool() {
  const [mode, setMode] = useState(null);

  if (mode === "photo") {
    return <PhotoFormatter onBack={() => setMode(null)} />;
  }

  if (mode === "video") {
    return <VideoFormatter onBack={() => setMode(null)} />;
  }

  return <StudioSelector onSelect={setMode} />;
}

import {
  INSTAGRAM_HEIGHT,
  INSTAGRAM_WIDTH,
  drawComparisonFrame,
  enableHighQuality,
  ensureLabelFont,
  ensureLogo,
} from "@/lib/studioLayout";

const OUTPUT_FPS = 30;

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    video.onloadedmetadata = () => resolve({ video, url });
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load ${file.name}`));
    };
    video.src = url;
  });
}

function waitForSeek(video) {
  return new Promise((resolve) => {
    if (video.seeking) {
      video.addEventListener("seeked", resolve, { once: true });
      return;
    }
    resolve();
  });
}

function seekVideo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.001) {
    return waitForSeek(video);
  }
  video.currentTime = time;
  return waitForSeek(video);
}

export function extensionForMimeType(mimeType) {
  if (mimeType?.includes("mp4")) return "mp4";
  return "webm";
}

async function stitchComparisonVideo(
  leftFile,
  rightFile,
  leftLabel,
  rightLabel,
) {
  const mimeType = pickRecorderMimeType();
  if (!mimeType) {
    throw new Error("Video export is not supported in this browser.");
  }

  const [, logoImg] = await Promise.all([ensureLabelFont(), ensureLogo()]);
  const [{ video: leftVideo, url: leftUrl }, { video: rightVideo, url: rightUrl }] =
    await Promise.all([loadVideo(leftFile), loadVideo(rightFile)]);

  const leftDuration = leftVideo.duration;
  const rightDuration = rightVideo.duration;
  const duration = Math.max(leftDuration, rightDuration);
  if (!Number.isFinite(duration) || duration <= 0) {
    URL.revokeObjectURL(leftUrl);
    URL.revokeObjectURL(rightUrl);
    throw new Error("Could not read video duration.");
  }

  leftVideo.loop = leftDuration < duration;
  rightVideo.loop = rightDuration < duration;
  const masterVideo =
    leftDuration >= rightDuration ? leftVideo : rightVideo;

  const canvas = document.createElement("canvas");
  canvas.width = INSTAGRAM_WIDTH;
  canvas.height = INSTAGRAM_HEIGHT;
  const ctx = canvas.getContext("2d");
  enableHighQuality(ctx);

  const stream = canvas.captureStream(OUTPUT_FPS);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
  });

  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  leftVideo.pause();
  rightVideo.pause();

  const recordingDone = new Promise((resolve, reject) => {
    recorder.onstop = () => {
      URL.revokeObjectURL(leftUrl);
      URL.revokeObjectURL(rightUrl);
      resolve(new Blob(chunks, { type: mimeType }));
    };
    recorder.onerror = () => reject(new Error("Failed to record video."));
  });

  recorder.start(100);

  await Promise.all([seekVideo(leftVideo, 0), seekVideo(rightVideo, 0)]);
  drawComparisonFrame(ctx, leftVideo, rightVideo, leftLabel, rightLabel, logoImg);

  await Promise.all([
    leftVideo.play().catch(() => undefined),
    rightVideo.play().catch(() => undefined),
  ]);

  await new Promise((resolve) => {
    function onFrame() {
      if (
        masterVideo.ended ||
        masterVideo.currentTime >= duration - 0.05
      ) {
        leftVideo.pause();
        rightVideo.pause();
        resolve();
        return;
      }

      drawComparisonFrame(
        ctx,
        leftVideo,
        rightVideo,
        leftLabel,
        rightLabel,
        logoImg,
      );
      requestAnimationFrame(onFrame);
    }

    requestAnimationFrame(onFrame);
  });

  recorder.stop();
  const blob = await recordingDone;
  return { blob, mimeType };
}

export async function stitchBothVideos(files) {
  const [beforeFront, beforeBack, afterFront, afterBack] = files;
  const [front, back] = await Promise.all([
    stitchComparisonVideo(beforeFront, afterFront, "before", "after"),
    stitchComparisonVideo(beforeBack, afterBack, "before", "after"),
  ]);
  return { front, back };
}

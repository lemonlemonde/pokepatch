"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const MAX_FILES = 12;
const MAX_FILE_MB = 50;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

function copyFileList(fileList) {
  if (!fileList) return [];
  const copied = [];
  for (let i = 0; i < fileList.length; i += 1) {
    copied.push(fileList[i]);
  }
  return copied;
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function fieldClassName() {
  return "w-full rounded-xl border-2 border-ink/15 bg-cream px-4 py-2 text-ink outline-none focus:border-blush";
}

export default function QuoteForm() {
  const router = useRouter();
  const formRef = useRef(null);
  const fileInputRef = useRef(null);
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [restorationDetails, setRestorationDetails] = useState("");
  const [contact, setContact] = useState("");
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [fileError, setFileError] = useState("");

  useEffect(() => {
    const urls = files.map((item) => URL.createObjectURL(item.file));
    setPreviews(urls);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [files]);

  function handleFilesChange(e) {
    const input = e.target;
    const selected = copyFileList(input.files);

    if (selected.length === 0) return;

    const valid = selected.filter((file) => file.size <= MAX_FILE_BYTES);
    const skipped = selected.length - valid.length;

    if (valid.length === 0) {
      setFileError(`Each image must be ${MAX_FILE_MB}MB or smaller.`);
      input.value = "";
      return;
    }

    let trimmed = false;

    setFiles((prev) => {
      const next = [
        ...prev,
        ...valid.map((file) => ({ id: crypto.randomUUID(), file })),
      ];
      if (next.length > MAX_FILES) {
        trimmed = true;
        return next.slice(0, MAX_FILES);
      }
      return next;
    });

    if (skipped > 0) {
      setFileError(
        `${skipped} file${skipped === 1 ? "" : "s"} skipped (over ${MAX_FILE_MB}MB). ${valid.length} added.`
      );
    } else if (trimmed) {
      setFileError(`Only the first ${MAX_FILES} images were kept.`);
    } else {
      setFileError("");
    }

    input.value = "";
  }

  function removeFile(id) {
    setFiles((prev) => prev.filter((item) => item.id !== id));
    setFileError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (honeypot) return;

    if (!isSupabaseConfigured) {
      setStatus("error");
      setErrorMessage("Form is not configured. Missing Supabase environment variables.");
      return;
    }

    if (!deliveryMethod) {
      setStatus("error");
      setErrorMessage("Please choose how you'll send your cards.");
      return;
    }
    if (files.length === 0) {
      setStatus("error");
      setErrorMessage("Please upload at least one photo of your cards.");
      return;
    }

    setStatus("uploading");
    setErrorMessage("");

    const submissionId = crypto.randomUUID();
    const imagePaths = [];

    try {
      for (let i = 0; i < files.length; i += 1) {
        const { file } = files[i];
        const path = `${submissionId}/${i + 1}-${sanitizeFilename(file.name)}`;
        const { error: uploadError } = await supabase.storage
          .from("card-photos")
          .upload(path, file, { upsert: false });

        if (uploadError) throw uploadError;
        imagePaths.push(path);
      }

      setStatus("submitting");

      const { error: insertError } = await supabase.from("quote_requests").insert({
        delivery_method: deliveryMethod,
        restoration_details: restorationDetails.trim(),
        contact: contact.trim(),
        image_paths: imagePaths,
      });

      if (insertError) throw insertError;

      setStatus("success");
      setDeliveryMethod("");
      setRestorationDetails("");
      setContact("");
      setFiles([]);
      setFileError("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      formRef.current?.reset();
      router.push("/thank-you");
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err?.message ?? "Something went wrong. Please try again in a moment."
      );
    }
  }

  const isBusy = status === "uploading" || status === "submitting";
  const isFormComplete =
    deliveryMethod !== "" &&
    files.length > 0 &&
    restorationDetails.trim() !== "" &&
    contact.trim() !== "";

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="pixel-border animate-fade-up space-y-10 rounded-2xl bg-cream/60 p-6 [animation-delay:150ms]"
    >
      {!isSupabaseConfigured && (
        <p className="rounded-2xl border-2 border-peach bg-peach/30 px-4 py-3 text-sm text-ink/80">
          Form setup needed: add{" "}
          <code className="rounded bg-night/50 px-1">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
          and{" "}
          <code className="rounded bg-night/50 px-1">
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
          </code>{" "}
          to <code className="rounded bg-night/50 px-1">.env.local</code>.
        </p>
      )}

      {status === "success" && (
        <p className="rounded-2xl border-2 border-mint bg-mint/40 px-4 py-3 text-sm font-semibold text-ink">
          Thank you! Your quote request was submitted. We&apos;ll get back to you
          soon.
        </p>
      )}

      {status === "error" && errorMessage && (
        <p className="rounded-2xl border-2 border-blush bg-blush/40 px-4 py-3 text-sm font-semibold text-ink">
          {errorMessage}
        </p>
      )}

      <fieldset className="space-y-3">
        <legend className="text-lg font-bold text-ink">
          How will you be sending your cards?{" "}
          <span className="text-berry">*</span>
        </legend>
        <p className="font-secondary text-sm text-ink/70">
          If you choose local drop-off, we&apos;ll provide the address after we
          review your submission.
        </p>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-ink/10 bg-cream/80 px-4 py-3">
          <input
            type="radio"
            name="delivery_method"
            value="local_dropoff"
            checked={deliveryMethod === "local_dropoff"}
            onChange={(e) => setDeliveryMethod(e.target.value)}
            className="mt-1"
            required
          />
          <span className="font-secondary text-sm text-ink">
            📍 Local Drop-Off (North San Jose)
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-ink/10 bg-cream/80 px-4 py-3">
          <input
            type="radio"
            name="delivery_method"
            value="shipping"
            checked={deliveryMethod === "shipping"}
            onChange={(e) => setDeliveryMethod(e.target.value)}
            className="mt-1"
            required
          />
          <span className="font-secondary text-sm text-ink">📦 Shipping</span>
        </label>
      </fieldset>

      <div className="border-t border-ink/10 pt-10">
        <p className="mb-1 text-lg font-bold text-ink">
          Upload photos of your cards <span className="text-berry">*</span>
        </p>
        <p className="mb-2 font-secondary text-sm text-ink/70">
          Please upload clear photos of the front and back of each card
          you&apos;d like restored.
        </p>
        <p className="mb-2 font-secondary text-sm text-ink/70">
          If you run into file size limits, upload 1 photo and note this in
          the description. We will reach out to you.
        </p>

        <input
          ref={fileInputRef}
          id="photos"
          name="photos"
          type="file"
          accept="image/*"
          multiple
          onChange={handleFilesChange}
          className="sr-only"
        />
        {fileError && (
          <p className="mb-2 rounded-2xl border-2 border-blush bg-blush/40 px-4 py-2 text-sm font-semibold text-ink">
            {fileError}
          </p>
        )}
        <label
          htmlFor="photos"
          className="inline-flex cursor-pointer items-center rounded-full bg-blush px-4 py-2 text-sm font-semibold text-night transition-colors duration-150 sm:hover:bg-blush/80"
        >
          Browse files
        </label>
        {files.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="font-secondary text-sm text-ink/60">
              {files.length} file{files.length === 1 ? "" : "s"} selected
              {files.length >= MAX_FILES ? ` (max ${MAX_FILES})` : ""}
            </p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {files.map((item, index) => (
                <li
                  key={item.id}
                  className="group relative overflow-hidden rounded-xl border-2 border-ink/10 bg-cream/80"
                >
                  {previews[index] ? (
                    <img
                      src={previews[index]}
                      alt={item.file.name}
                      className="h-28 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-28 w-full items-center justify-center text-xs text-ink/50">
                      Loading...
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(item.id)}
                    aria-label={`Remove ${item.file.name}`}
                    className="absolute right-1.5 top-1.5 rounded-full bg-ink/70 px-2 py-0.5 text-xs font-bold text-cream transition-colors duration-150 sm:hover:bg-ink"
                  >
                    ✕
                  </button>
                  <span className="block truncate px-2 py-1 font-secondary text-xs text-ink">
                    {item.file.name}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="border-t border-ink/10 pt-10">
        <label
          htmlFor="restoration_details"
          className="mb-1 block text-lg font-bold text-ink"
        >
          Describe the restoration needed <span className="text-berry">*</span>
        </label>
        <div className="mb-2 font-secondary text-sm text-ink/70">
          <p>
            List each card by name and briefly note the damage and where it is.
          </p>
          <p>For example:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Charizard (Base Set, Holo) – scratches on holo.
            </li>
            <li>
              Pikachu (Jungle) – crease on left edge and bend
              through center.
            </li>
          </ul>
        </div>
        <textarea
          id="restoration_details"
          name="restoration_details"
          rows={8}
          required
          value={restorationDetails}
          onChange={(e) => setRestorationDetails(e.target.value)}
          placeholder="Type the card name and restoration details here..."
          className={fieldClassName()}
        />
      </div>

      <div className="border-t border-ink/10 pt-10">
        <label htmlFor="contact" className="mb-1 block text-lg font-bold text-ink">
          Contact information <span className="text-berry">*</span>
        </label>
        <p className="mb-2 font-secondary text-sm text-ink/70">
          How can we reach you regarding your quote? (phone number, email address, or Discord username)
        </p>
        <input
          id="contact"
          name="contact"
          type="text"
          required
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="your@email.com or (555) 555-5555"
          className={fieldClassName()}
        />
      </div>

      <input
        type="text"
        name="website"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />

      <button
        type="submit"
        disabled={isBusy || !isSupabaseConfigured || !isFormComplete}
        className="w-full rounded-full bg-lavender px-6 py-3 font-bold text-night shadow-cozy transition-all duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-0.5 active:shadow-cozy-sm sm:hover:-translate-y-1 sm:hover:bg-lavender/80 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)]"
      >
        {status === "uploading"
          ? "Uploading photos..."
          : status === "submitting"
            ? "Submitting..."
            : "Submit quote request"}
      </button>
    </form>
  );
}

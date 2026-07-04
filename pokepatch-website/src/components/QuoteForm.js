"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

const MAX_CARDS = 10;
const MAX_PHOTOS_PER_CARD = 4;
const MAX_FILE_MB = 50;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

const CONTACT_TYPES = [
  { value: "phone", label: "Phone" },
  { value: "discord", label: "Discord" },
  { value: "instagram", label: "Instagram" },
];

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

function emptyContact() {
  return { id: crypto.randomUUID(), contactType: "phone", value: "" };
}

function emptyCard() {
  return {
    id: crypto.randomUUID(),
    cardName: "",
    setName: "",
    description: "",
    files: [],
  };
}

function isCardComplete(card) {
  return (
    card.cardName.trim() !== "" &&
    card.description.trim() !== "" &&
    card.files.length > 0
  );
}

function isCardEmpty(card) {
  return (
    card.cardName.trim() === "" &&
    card.setName.trim() === "" &&
    card.description.trim() === "" &&
    card.files.length === 0
  );
}

function firstMissingOnCard(card, index) {
  if (card.cardName.trim() === "") {
    return `Card name in Card ${index} is required`;
  }
  if (card.description.trim() === "") {
    return `Description in Card ${index} is required`;
  }
  if (card.files.length === 0) {
    return `Photos in Card ${index} are required`;
  }
  return null;
}

function getFirstMissingFieldMessage({
  customerName,
  deliveryMethod,
  contacts,
  cards,
}) {
  if (customerName.trim() === "") return "Name is required";
  if (deliveryMethod === "") return "Delivery method is required";
  if (!contacts.some((c) => c.value.trim() !== "")) {
    return "At least one contact method is required";
  }
  if (cards.length === 0) return "At least one card is required";

  const hasCompleteCard = cards.some(isCardComplete);
  if (!hasCompleteCard) {
    return firstMissingOnCard(cards[0], 1);
  }

  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    if (!isCardEmpty(card) && !isCardComplete(card)) {
      return firstMissingOnCard(card, i + 1);
    }
  }

  return null;
}

function CardPhotoPreviews({ files, onRemove }) {
  const [previews, setPreviews] = useState([]);

  useEffect(() => {
    const urls = files.map((item) => URL.createObjectURL(item.file));
    setPreviews(urls);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [files]);

  if (files.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      <p className="font-secondary text-sm text-ink/60">
        {files.length} file{files.length === 1 ? "" : "s"} selected
        {files.length >= MAX_PHOTOS_PER_CARD
          ? ` (max ${MAX_PHOTOS_PER_CARD})`
          : ""}
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
              onClick={() => onRemove(item.id)}
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
  );
}

export default function QuoteForm() {
  const router = useRouter();
  const formRef = useRef(null);
  const [customerName, setCustomerName] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [contacts, setContacts] = useState([emptyContact()]);
  const [cards, setCards] = useState([emptyCard()]);
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [cardFileErrors, setCardFileErrors] = useState({});

  function updateContact(id, patch) {
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  }

  function addContact() {
    setContacts((prev) => [...prev, emptyContact()]);
  }

  function removeContact(id) {
    setContacts((prev) => {
      if (prev.length <= 1) {
        return [emptyContact()];
      }
      return prev.filter((c) => c.id !== id);
    });
  }

  function updateCard(id, patch) {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  }

  function addCard() {
    setCards((prev) => {
      if (prev.length >= MAX_CARDS) return prev;
      return [...prev, emptyCard()];
    });
  }

  function removeCard(id) {
    setCards((prev) => prev.filter((c) => c.id !== id));
    setCardFileErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function handleCardFilesChange(cardId, e) {
    const input = e.target;
    const selected = copyFileList(input.files);
    if (selected.length === 0) return;

    const valid = selected.filter((file) => file.size <= MAX_FILE_BYTES);
    const skipped = selected.length - valid.length;

    if (valid.length === 0) {
      setCardFileErrors((prev) => ({
        ...prev,
        [cardId]: `Each image must be ${MAX_FILE_MB}MB or smaller.`,
      }));
      input.value = "";
      return;
    }

    let trimmed = false;

    setCards((prev) =>
      prev.map((card) => {
        if (card.id !== cardId) return card;
        const nextFiles = [
          ...card.files,
          ...valid.map((file) => ({ id: crypto.randomUUID(), file })),
        ];
        if (nextFiles.length > MAX_PHOTOS_PER_CARD) {
          trimmed = true;
          return { ...card, files: nextFiles.slice(0, MAX_PHOTOS_PER_CARD) };
        }
        return { ...card, files: nextFiles };
      })
    );

    if (skipped > 0) {
      setCardFileErrors((prev) => ({
        ...prev,
        [cardId]: `${skipped} file${skipped === 1 ? "" : "s"} skipped (over ${MAX_FILE_MB}MB). ${valid.length} added.`,
      }));
    } else if (trimmed) {
      setCardFileErrors((prev) => ({
        ...prev,
        [cardId]: `Only the first ${MAX_PHOTOS_PER_CARD} images were kept.`,
      }));
    } else {
      setCardFileErrors((prev) => {
        const next = { ...prev };
        delete next[cardId];
        return next;
      });
    }

    input.value = "";
  }

  function removeCardFile(cardId, fileId) {
    setCards((prev) =>
      prev.map((card) =>
        card.id === cardId
          ? { ...card, files: card.files.filter((f) => f.id !== fileId) }
          : card
      )
    );
    setCardFileErrors((prev) => {
      const next = { ...prev };
      delete next[cardId];
      return next;
    });
  }

  const filledContacts = contacts.filter((c) => c.value.trim() !== "");
  const completeCards = cards.filter(isCardComplete);
  const hasIncompleteCard = cards.some(
    (card) => !isCardEmpty(card) && !isCardComplete(card)
  );

  const isFormComplete =
    customerName.trim() !== "" &&
    deliveryMethod !== "" &&
    filledContacts.length >= 1 &&
    completeCards.length >= 1 &&
    !hasIncompleteCard;

  const validationMessage = getFirstMissingFieldMessage({
    customerName,
    deliveryMethod,
    contacts,
    cards,
  });

  async function handleSubmit(e) {
    e.preventDefault();
    if (honeypot) return;

    if (!isSupabaseConfigured) {
      setStatus("error");
      setErrorMessage(
        "Form is not configured. Missing Supabase environment variables."
      );
      return;
    }

    if (!isFormComplete) {
      setStatus("error");
      setErrorMessage("Please complete all required fields before submitting.");
      return;
    }

    setStatus("uploading");
    setErrorMessage("");

    const orderId = crypto.randomUUID();
    const cardsPayload = [];

    try {
      for (const card of completeCards) {
        const cardId = crypto.randomUUID();
        const images = [];

        for (let i = 0; i < card.files.length; i += 1) {
          const { file } = card.files[i];
          const path = `order-${orderId}/card-${cardId}/customer-${i + 1}-${sanitizeFilename(file.name)}`;
          const { error: uploadError } = await supabase.storage
            .from("card-photos")
            .upload(path, file, { upsert: false });

          if (uploadError) throw uploadError;
          images.push({ storage_path: path, image_type: "customer" });
        }

        cardsPayload.push({
          id: cardId,
          card_name: card.cardName.trim(),
          set_name: card.setName.trim() || null,
          description: card.description.trim(),
          images,
        });
      }

      setStatus("submitting");

      const payload = {
        id: orderId,
        customer_name: customerName.trim(),
        delivery_method: deliveryMethod,
        contacts: filledContacts.map((c) => ({
          contact_type: c.contactType,
          value: c.value.trim(),
        })),
        cards: cardsPayload,
      };

      const { error: rpcError } = await supabase.rpc("create_order", {
        p_payload: payload,
      });

      if (rpcError) throw rpcError;

      setStatus("success");
      setCustomerName("");
      setDeliveryMethod("");
      setContacts([emptyContact()]);
      setCards([emptyCard()]);
      setCardFileErrors({});
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

      <section className="space-y-6">
        <h2 className="text-xl font-bold text-ink">Customer information</h2>

        <div>
          <label htmlFor="customer_name" className="mb-1 block text-lg font-bold text-ink">
            Name <span className="text-berry">*</span>
          </label>
          <input
            id="customer_name"
            name="customer_name"
            type="text"
            required
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Your preferred name"
            className={fieldClassName()}
          />
        </div>

        <fieldset className="space-y-3">
          <legend className="text-lg font-bold text-ink">
            Delivery method <span className="text-berry">*</span>
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

        <div className="space-y-3">
          <p className="text-lg font-bold text-ink">
            Contact methods <span className="text-berry">*</span>
          </p>
          <p className="font-secondary text-sm text-ink/70">
            Add at least one way we can reach you about your quote.
          </p>
          {contacts.map((contact, index) => (
            <div
              key={contact.id}
              className="flex flex-col gap-2 rounded-xl border-2 border-ink/10 bg-cream/80 p-3 sm:flex-row sm:items-end"
            >
              <div className="sm:w-40">
                <label
                  htmlFor={`contact_type_${contact.id}`}
                  className="mb-1 block font-secondary text-xs text-ink/70"
                >
                  Type
                </label>
                <select
                  id={`contact_type_${contact.id}`}
                  value={contact.contactType}
                  onChange={(e) =>
                    updateContact(contact.id, { contactType: e.target.value })
                  }
                  className={fieldClassName()}
                >
                  {CONTACT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={`contact_value_${contact.id}`}
                  className="mb-1 block font-secondary text-xs text-ink/70"
                >
                  {index === 0 ? "Value" : `Contact ${index + 1}`}
                </label>
                <input
                  id={`contact_value_${contact.id}`}
                  type="text"
                  value={contact.value}
                  onChange={(e) =>
                    updateContact(contact.id, { value: e.target.value })
                  }
                  placeholder={
                    contact.contactType === "phone"
                      ? "(555) 555-5555"
                      : "@yourusername"
                  }
                  className={fieldClassName()}
                />
              </div>
              <button
                type="button"
                onClick={() => removeContact(contact.id)}
                className="rounded-full border-2 border-ink/15 px-3 py-2 text-sm font-semibold text-ink/70 transition-colors duration-150 sm:hover:border-blush sm:hover:text-ink"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addContact}
            className="inline-flex items-center rounded-full bg-blush px-4 py-2 text-sm font-semibold text-night transition-colors duration-150 sm:hover:bg-blush/80"
          >
            + Add contact method
          </button>
        </div>
      </section>

      <section className="space-y-6 border-t border-ink/10 pt-10">
        <div>
          <h2 className="text-xl font-bold text-ink">Cards</h2>
          <p className="mt-1 font-secondary text-sm text-ink/70">
            Add up to 10 cards. For more than 10 cards, submit as 1 card entry
            with a photo of the entire bulk lot and a combined description.
          </p>
        </div>

        {cards.length === 0 && (
          <p className="font-secondary text-sm text-ink/60">
            No cards yet. Add a card to continue.
          </p>
        )}

        {cards.map((card, index) => {
          const inputId = `card_photos_${card.id}`;
          return (
            <div
              key={card.id}
              className="space-y-4 rounded-2xl border-2 border-ink/10 bg-cream/80 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-ink">Card {index + 1}</h3>
                <button
                  type="button"
                  onClick={() => removeCard(card.id)}
                  className="rounded-full border-2 border-ink/15 px-3 py-1 text-sm font-semibold text-ink/70 transition-colors duration-150 sm:hover:border-blush sm:hover:text-ink"
                >
                  Remove card
                </button>
              </div>

              <div>
                <label
                  htmlFor={`card_name_${card.id}`}
                  className="mb-1 block font-secondary text-sm font-semibold text-ink"
                >
                  Card name <span className="text-berry">*</span>
                </label>
                <input
                  id={`card_name_${card.id}`}
                  type="text"
                  value={card.cardName}
                  onChange={(e) =>
                    updateCard(card.id, { cardName: e.target.value })
                  }
                  placeholder="e.g. Charizard"
                  className={fieldClassName()}
                />
              </div>

              <div>
                <label
                  htmlFor={`set_name_${card.id}`}
                  className="mb-1 block font-secondary text-sm font-semibold text-ink"
                >
                  Set
                </label>
                <input
                  id={`set_name_${card.id}`}
                  type="text"
                  value={card.setName}
                  onChange={(e) =>
                    updateCard(card.id, { setName: e.target.value })
                  }
                  placeholder="e.g. Base Set, Holo"
                  className={fieldClassName()}
                />
              </div>

              <div>
                <label
                  htmlFor={`description_${card.id}`}
                  className="mb-1 block font-secondary text-sm font-semibold text-ink"
                >
                  Description <span className="text-berry">*</span>
                </label>
                <p className="mb-2 font-secondary text-sm text-ink/70">
                  Note the damage and where it is (e.g. crease on left edge,
                  scratches on holo).
                </p>
                <textarea
                  id={`description_${card.id}`}
                  rows={4}
                  required
                  value={card.description}
                  onChange={(e) =>
                    updateCard(card.id, { description: e.target.value })
                  }
                  placeholder="Describe the repair needed..."
                  className={fieldClassName()}
                />
              </div>

              <div>
                <p className="mb-1 font-secondary text-sm font-semibold text-ink">
                  Photos <span className="text-berry">*</span>
                </p>
                <p className="mb-2 font-secondary text-sm text-ink/70">
                  Clear photos of the front and back (up to {MAX_PHOTOS_PER_CARD}{" "}
                  per card).
                </p>
                <input
                  id={inputId}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleCardFilesChange(card.id, e)}
                  className="sr-only"
                />
                {cardFileErrors[card.id] && (
                  <p className="mb-2 rounded-2xl border-2 border-blush bg-blush/40 px-4 py-2 text-sm font-semibold text-ink">
                    {cardFileErrors[card.id]}
                  </p>
                )}
                <label
                  htmlFor={inputId}
                  className="inline-flex cursor-pointer items-center rounded-full bg-blush px-4 py-2 text-sm font-semibold text-night transition-colors duration-150 sm:hover:bg-blush/80"
                >
                  Browse files
                </label>
                <CardPhotoPreviews
                  files={card.files}
                  onRemove={(fileId) => removeCardFile(card.id, fileId)}
                />
              </div>
            </div>
          );
        })}

        <div className="space-y-2">
          <button
            type="button"
            onClick={addCard}
            disabled={cards.length >= MAX_CARDS}
            className="inline-flex items-center rounded-full bg-lavender px-4 py-2 text-sm font-semibold text-night transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 sm:hover:bg-lavender/80"
          >
            + Add Card
          </button>
          {cards.length >= MAX_CARDS && (
            <p className="font-secondary text-sm text-ink/70">
              Maximum of {MAX_CARDS} cards. For larger lots, use one card entry
              with a photo of the entire lot and a description.
            </p>
          )}
        </div>
      </section>

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

      <div className="space-y-2">
        {!isBusy && !isFormComplete && validationMessage && (
          <p className="text-center text-sm font-semibold text-berry" role="status">
            {validationMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={isBusy || !isSupabaseConfigured || !isFormComplete}
          className="w-full rounded-full bg-lavender px-6 py-3 font-bold text-night shadow-cozy transition-all duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-0.5 active:shadow-cozy-sm sm:hover:-translate-y-1 sm:hover:bg-lavender/80 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)]"
        >
          {isBusy ? (
            <span className="inline-block animate-soft-bounce">
              {status === "uploading" ? "Uploading photos..." : "Submitting..."}
            </span>
          ) : (
            "Submit quote request"
          )}
        </button>
      </div>
    </form>
  );
}

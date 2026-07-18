"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Button from "@/components/Button";
import { StagedCardPhotoPreviews } from "@/components/CardPhotoPreviews";
import { useAuth } from "@/contexts/AuthContext";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { CONTACT_TYPES } from "@/lib/contacts";
import { capture } from "@/lib/posthog";

const MAX_CARDS = 10;
const MAX_PHOTOS_PER_CARD = 4;
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

function fieldClassName(invalid = false) {
  return invalid
    ? "w-full scroll-mt-24 rounded-xl border-2 border-berry bg-cream px-4 py-2 text-ink outline-none focus:border-berry"
    : "w-full scroll-mt-24 rounded-xl border-2 border-ink/15 bg-cream px-4 py-2 text-ink outline-none focus:border-blush";
}

function optionClassName(invalid = false) {
  return invalid
    ? "flex cursor-pointer items-start gap-3 rounded-xl border-2 border-berry bg-cream/80 px-4 py-3"
    : "flex cursor-pointer items-start gap-3 rounded-xl border-2 border-ink/10 bg-cream/80 px-4 py-3";
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

function emptyContactValues() {
  return CONTACT_TYPES.reduce((acc, type) => ({ ...acc, [type.value]: "" }), {});
}

// The first card is rendered during SSR, so it needs a stable ID that matches on
// the server and client. Dynamically added cards use random UUIDs.
function initialCard() {
  return {
    id: "card-initial",
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

function cardFieldErrors(card) {
  return {
    cardName: card.cardName.trim() === "",
    description: card.description.trim() === "",
    files: card.files.length === 0,
  };
}

function getFieldErrors({ customerName, email, deliveryMethod, cards }) {
  const errors = {
    customerName: customerName.trim() === "",
    email: email.trim() === "" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    deliveryMethod: deliveryMethod === "",
    cards: {},
    noCards: cards.length === 0,
  };

  const incompleteCards = cards.filter(
    (card) => !isCardEmpty(card) && !isCardComplete(card)
  );

  for (const card of incompleteCards) {
    errors.cards[card.id] = cardFieldErrors(card);
  }

  if (!cards.some(isCardComplete) && incompleteCards.length === 0) {
    const firstEmpty = cards.find(isCardEmpty);
    if (firstEmpty) {
      errors.cards[firstEmpty.id] = cardFieldErrors(firstEmpty);
    }
  }

  return errors;
}

function hasFieldErrors(errors) {
  if (!errors) return false;
  if (errors.customerName || errors.email || errors.deliveryMethod) {
    return true;
  }
  if (errors.noCards) return true;
  return Object.keys(errors.cards).length > 0;
}

function getFirstErrorElement(errors, cards) {
  if (!errors) return null;

  if (errors.customerName) {
    return document.getElementById("customer_name");
  }
  if (errors.email) {
    return document.getElementById("customer_email");
  }
  if (errors.deliveryMethod) {
    return document.getElementById("delivery_method");
  }
  if (errors.noCards) {
    return document.getElementById("cards_empty");
  }

  for (const card of cards) {
    const cardErrors = errors.cards[card.id];
    if (!cardErrors) continue;
    if (cardErrors.cardName) {
      return document.getElementById(`card_name_${card.id}`);
    }
    if (cardErrors.description) {
      return document.getElementById(`description_${card.id}`);
    }
    if (cardErrors.files) {
      return (
        document.querySelector(`label[for="card_photos_${card.id}"]`) ??
        document.getElementById(`card_photos_${card.id}`)
      );
    }
  }

  return null;
}

function scrollToFirstError(errors, cards) {
  const element = getFirstErrorElement(errors, cards);
  if (!element) return;

  element.scrollIntoView({ behavior: "smooth", block: "center" });

  const focusTarget =
    element.matches("input, textarea, select, button")
      ? element
      : element.querySelector("input, textarea, select, button");

  if (focusTarget && typeof focusTarget.focus === "function") {
    focusTarget.focus({ preventScroll: true });
  }
}

export default function QuoteForm() {
  const router = useRouter();
  const { user: authUser } = useAuth();
  const user = isCustomerAuthEnabled() ? authUser : null;
  const profileLoadedRef = useRef(false);
  const formRef = useRef(null);
  const formStartedRef = useRef(false);
  const customerInfoCompletedRef = useRef(false);
  const cardDetailsCompletedRef = useRef(false);
  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [contactValues, setContactValues] = useState(emptyContactValues);
  const [lockedTypes, setLockedTypes] = useState({});
  const [preferredContactId, setPreferredContactId] = useState("email");
  const [cards, setCards] = useState([initialCard()]);
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState(null);
  const [cardFileErrors, setCardFileErrors] = useState({});

  function onFormInteraction() {
    if (formStartedRef.current) return;
    formStartedRef.current = true;
    capture("quote_form_started");
  }

  useEffect(() => {
    if (customerInfoCompletedRef.current) return;
    const hasEmail = email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (customerName.trim() && hasEmail && deliveryMethod) {
      customerInfoCompletedRef.current = true;
      capture("quote_form_step_completed", { step: "customer_info" });
    }
  }, [customerName, email, deliveryMethod]);

  useEffect(() => {
    if (cardDetailsCompletedRef.current) return;
    if (cards.some(isCardComplete)) {
      cardDetailsCompletedRef.current = true;
      capture("quote_form_step_completed", { step: "card_details" });
    }
  }, [cards]);

  // Logged-in customers use their account email; keep it in sync and locked.
  useEffect(() => {
    if (user?.email) setEmail(user.email);
  }, [user]);

  // Pre-fill name and saved contact methods from the customer's profile (once).
  useEffect(() => {
    if (!user || !supabase || profileLoadedRef.current) return;
    profileLoadedRef.current = true;
    supabase
      .from("customer_profiles")
      .select("full_name, contacts")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        if (data.full_name) setCustomerName(data.full_name);
        if (Array.isArray(data.contacts) && data.contacts.length > 0) {
          const values = emptyContactValues();
          const locked = {};
          for (const c of data.contacts) {
            if (c && c.contact_type in values) {
              values[c.contact_type] = c.value ?? "";
              locked[c.contact_type] = true;
            }
          }
          setContactValues(values);
          setLockedTypes(locked);
        }
      });
  }, [user]);

  function clearFieldError(key) {
    setFieldErrors((prev) => {
      if (!prev || !prev[key]) return prev;
      return { ...prev, [key]: false };
    });
  }

  function clearCardFieldError(cardId, key) {
    setFieldErrors((prev) => {
      if (!prev?.cards?.[cardId]?.[key]) return prev;
      const card = { ...prev.cards[cardId], [key]: false };
      const cards = { ...prev.cards };
      if (!card.cardName && !card.description && !card.files) {
        delete cards[cardId];
      } else {
        cards[cardId] = card;
      }
      return { ...prev, cards, noCards: false };
    });
  }

  function updateContactValue(type, value) {
    onFormInteraction();
    setContactValues((prev) => ({ ...prev, [type]: value }));
  }

  function updateCard(id, patch) {
    onFormInteraction();
    if (patch.cardName !== undefined) clearCardFieldError(id, "cardName");
    if (patch.description !== undefined) {
      clearCardFieldError(id, "description");
    }
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  }

  function addCard() {
    setFieldErrors((prev) =>
      prev ? { ...prev, noCards: false } : prev
    );
    setCards((prev) => {
      if (prev.length >= MAX_CARDS) return prev;
      return [...prev, emptyCard()];
    });
  }

  function removeCard(id) {
    setCards((prev) => prev.filter((c) => c.id !== id));
    setFieldErrors((prev) => {
      if (!prev?.cards?.[id]) return prev;
      const cards = { ...prev.cards };
      delete cards[id];
      return { ...prev, cards };
    });
    setCardFileErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function handleCardFilesChange(cardId, e) {
    onFormInteraction();
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

    clearCardFieldError(cardId, "files");

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

  const completeCards = cards.filter(isCardComplete);

  const filledContactTypes = CONTACT_TYPES.filter(
    (type) => (contactValues[type.value] ?? "").trim() !== ""
  );

  const preferredOptions = [
    { id: "email", label: email.trim() ? `Email (${email.trim()})` : "Email" },
    ...filledContactTypes.map((type) => ({
      id: type.value,
      label: `${type.label} (${contactValues[type.value].trim()})`,
    })),
  ];
  const preferredOptionIds = new Set(preferredOptions.map((o) => o.id));
  const effectivePreferredId = preferredOptionIds.has(preferredContactId)
    ? preferredContactId
    : "email";

  async function handleSubmit(e) {
    e.preventDefault();
    if (honeypot) return;

    if (!isSupabaseConfigured) {
      capture("quote_form_error", { error_type: "config_missing" });
      setStatus("error");
      setErrorMessage(
        "Form is not configured. Missing Supabase environment variables."
      );
      return;
    }

    const errors = getFieldErrors({
      customerName,
      email,
      deliveryMethod,
      cards,
    });

    if (hasFieldErrors(errors)) {
      capture("quote_form_error", { error_type: "validation_failed" });
      setFieldErrors(errors);
      setStatus("idle");
      setErrorMessage("");
      requestAnimationFrame(() => {
        scrollToFirstError(errors, cards);
      });
      return;
    }

    setFieldErrors(null);
    setStatus("uploading");
    setErrorMessage("");

    capture("quote_form_submit_attempted", {
      card_count: completeCards.length,
      delivery_method: deliveryMethod,
      contact_method_count: filledContactTypes.length,
    });

    const orderId = crypto.randomUUID();
    const cardsPayload = [];
    let phase = "upload";

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
      phase = "insert";

      let preferredType = "email";
      let preferredValue = email.trim().toLowerCase();
      if (effectivePreferredId !== "email") {
        preferredType = effectivePreferredId;
        preferredValue = contactValues[effectivePreferredId].trim();
      }

      const payload = {
        id: orderId,
        customer_name: customerName.trim(),
        customer_email: email.trim().toLowerCase(),
        delivery_method: deliveryMethod,
        preferred_contact_type: preferredType,
        preferred_contact_value: preferredValue,
        contacts: filledContactTypes.map((type) => ({
          contact_type: type.value,
          value: contactValues[type.value].trim(),
        })),
        cards: cardsPayload,
      };

      const { error: rpcError } = await supabase.rpc("create_order", {
        p_payload: payload,
      });

      if (rpcError) throw rpcError;

      // Logged-in submit: make sure the new order is linked to this account now,
      // not just on next login.
      if (user) {
        try {
          await supabase.rpc("claim_my_orders");
        } catch (err) {
          console.error("Failed to link order to account:", err);
        }
      }

      // Snapshot the entered details so that, if this visitor creates an account
      // afterwards, their name + contacts are saved to their profile.
      if (!user && isCustomerAuthEnabled()) {
        try {
          localStorage.setItem(
            "pokepatch_pending_profile",
            JSON.stringify({
              email: email.trim().toLowerCase(),
              full_name: customerName.trim(),
              contacts: filledContactTypes.map((type) => ({
                contact_type: type.value,
                value: contactValues[type.value].trim(),
              })),
            })
          );
        } catch {
          // Ignore storage errors (e.g. private mode); profile save is best-effort.
        }
      }

      capture("quote_form_submitted", {
        card_count: completeCards.length,
        delivery_method: deliveryMethod,
        contact_method_count: filledContactTypes.length,
      });

      setStatus("success");
      setCustomerName("");
      setEmail("");
      setDeliveryMethod("");
      setContactValues(emptyContactValues());
      setLockedTypes({});
      setPreferredContactId("email");
      setCards([emptyCard()]);
      setFieldErrors(null);
      setCardFileErrors({});
      formRef.current?.reset();
      router.push("/thank-you");
    } catch (err) {
      capture("quote_form_error", {
        error_type:
          phase === "upload"
            ? "storage_upload_failed"
            : "supabase_insert_failed",
      });
      setStatus("error");
      setErrorMessage(
        err?.message ?? "Something went wrong. Please try again in a moment."
      );
    }
  }

  const isBusy = status === "uploading" || status === "submitting";

  const showValidationError = hasFieldErrors(fieldErrors);

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
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

      {showValidationError && (
        <p
          className="rounded-2xl border-2 border-berry bg-berry/20 px-4 py-3 text-sm font-semibold text-ink"
          role="alert"
        >
          Please fill out all required fields
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
            value={customerName}
            onChange={(e) => {
              onFormInteraction();
              clearFieldError("customerName");
              setCustomerName(e.target.value);
            }}
            placeholder="Your preferred name"
            className={fieldClassName(fieldErrors?.customerName)}
            aria-invalid={fieldErrors?.customerName || undefined}
          />
        </div>

        <div>
          <label htmlFor="customer_email" className="mb-1 block text-lg font-bold text-ink">
            Email <span className="text-berry">*</span>
          </label>
          <p className="mb-2 text-sm text-ink/70">
            {user
              ? "We'll send your quote and updates to your account email."
              : "We'll send your quote and updates to this email."}
          </p>
          <input
            id="customer_email"
            name="customer_email"
            type="email"
            value={email}
            onChange={(e) => {
              onFormInteraction();
              clearFieldError("email");
              setEmail(e.target.value);
            }}
            placeholder="you@example.com"
            className={fieldClassName(fieldErrors?.email)}
            aria-invalid={fieldErrors?.email || undefined}
            disabled={!!user}
            readOnly={!!user}
          />
          {user && (
            <p className="mt-1 text-xs text-ink/60">
              Using your account email.{" "}
              <Link href="/account" className="font-semibold text-blush hover:underline">
                Manage account
              </Link>
            </p>
          )}
          {fieldErrors?.email && (
            <p className="mt-1 text-sm text-berry">
              Please enter a valid email address
            </p>
          )}
        </div>

        <fieldset id="delivery_method" className="space-y-3 scroll-mt-24">
          <legend className="text-lg font-bold text-ink">
            Delivery method <span className="text-berry">*</span>
          </legend>
          <p className="text-sm text-ink/70">
            If you choose local drop-off, we&apos;ll provide the address after we
            review your submission.
          </p>
          <label className={optionClassName(fieldErrors?.deliveryMethod)}>
            <input
              type="radio"
              name="delivery_method"
              value="local_dropoff"
              checked={deliveryMethod === "local_dropoff"}
              onChange={(e) => {
                onFormInteraction();
                clearFieldError("deliveryMethod");
                setDeliveryMethod(e.target.value);
              }}
              className="mt-1"
            />
            <span className="text-sm text-ink">
              📍 Local Drop-Off (North San Jose)
            </span>
          </label>
          <label className={optionClassName(fieldErrors?.deliveryMethod)}>
            <input
              type="radio"
              name="delivery_method"
              value="shipping"
              checked={deliveryMethod === "shipping"}
              onChange={(e) => {
                onFormInteraction();
                clearFieldError("deliveryMethod");
                setDeliveryMethod(e.target.value);
              }}
              className="mt-1"
            />
            <span className="text-sm text-ink">📦 Shipping</span>
          </label>
        </fieldset>

        <div className="space-y-3">
          <p className="text-lg font-bold text-ink">Other forms of contact</p>
          <p className="text-sm text-ink/70">
            Optional. Share any of these so we can reach you.
          </p>
          {CONTACT_TYPES.map((type) => {
            const value = contactValues[type.value] ?? "";
            const locked = !!lockedTypes[type.value];
            return (
              <div key={type.value}>
                <label
                  htmlFor={`contact_${type.value}`}
                  className="mb-1 block text-xs text-ink/70"
                >
                  {type.label}
                </label>
                {locked ? (
                  <div className="rounded-xl border-2 border-ink/10 bg-cream/60 px-4 py-2">
                    <p className="text-sm text-ink/80">{value}</p>
                  </div>
                ) : (
                  <input
                    id={`contact_${type.value}`}
                    type="text"
                    value={value}
                    onChange={(e) => updateContactValue(type.value, e.target.value)}
                    placeholder={
                      type.value === "phone" ? "(555) 555-5555" : "@yourusername"
                    }
                    className={fieldClassName()}
                  />
                )}
              </div>
            );
          })}
          {Object.keys(lockedTypes).length > 0 && (
            <p className="text-xs text-ink/60">
              Saved contact methods come from your account.{" "}
              <Link
                href="/account"
                className="font-semibold text-blush hover:underline"
              >
                Manage account
              </Link>
            </p>
          )}
        </div>

        <div className="space-y-3">
          <label
            htmlFor="preferred_contact"
            className="block text-lg font-bold text-ink"
          >
            Preferred contact method <span className="text-berry">*</span>
          </label>
          <p className="text-sm text-ink/70">
            How would you prefer we reach you about your quote?
          </p>
          <select
            id="preferred_contact"
            value={effectivePreferredId}
            onChange={(e) => {
              onFormInteraction();
              setPreferredContactId(e.target.value);
            }}
            className={fieldClassName()}
          >
            {preferredOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="space-y-6 border-t border-ink/10 pt-10">
        <div>
          <h2 className="text-xl font-bold text-ink">Cards</h2>
          <p className="mt-1 text-sm text-ink/70">
            Add up to 10 cards. For more than 10 cards, submit as 1 card entry
            with a photo of the entire bulk lot and a combined description.
          </p>
        </div>

        {cards.length === 0 && (
          <p
            id="cards_empty"
            className={
              fieldErrors?.noCards
                ? "scroll-mt-24 rounded-xl border-2 border-berry bg-berry/10 px-4 py-3 text-sm text-ink"
                : "scroll-mt-24 text-sm text-ink/60"
            }
          >
            No cards yet. Add a card to continue.
          </p>
        )}

        {cards.map((card, index) => {
          const inputId = `card_photos_${card.id}`;
          const cardErrors = fieldErrors?.cards?.[card.id];
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
                  className="mb-1 block text-sm font-semibold text-ink"
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
                  className={fieldClassName(cardErrors?.cardName)}
                  aria-invalid={cardErrors?.cardName || undefined}
                />
              </div>

              <div>
                <label
                  htmlFor={`set_name_${card.id}`}
                  className="mb-1 block text-sm font-semibold text-ink"
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
                  className="mb-1 block text-sm font-semibold text-ink"
                >
                  Description <span className="text-berry">*</span>
                </label>
                <p className="mb-2 text-sm text-ink/70">
                  Note the damage and where it is (e.g. crease on left edge,
                  scratches on holo).
                </p>
                <textarea
                  id={`description_${card.id}`}
                  rows={4}
                  value={card.description}
                  onChange={(e) =>
                    updateCard(card.id, { description: e.target.value })
                  }
                  placeholder="Describe the repair needed..."
                  className={fieldClassName(cardErrors?.description)}
                  aria-invalid={cardErrors?.description || undefined}
                />
              </div>

              <div>
                <p className="mb-1 text-sm font-semibold text-ink">
                  Photos <span className="text-berry">*</span>
                </p>
                <p className="mb-2 text-sm text-ink/70">
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
                  className={
                    cardErrors?.files
                      ? "inline-flex scroll-mt-24 cursor-pointer items-center rounded-full border-2 border-berry bg-berry/20 px-4 py-2 text-sm font-semibold text-ink"
                      : "inline-flex scroll-mt-24 cursor-pointer items-center rounded-full bg-blush px-4 py-2 text-sm font-semibold text-night transition-colors duration-150 sm:hover:bg-blush/80"
                  }
                >
                  Browse files
                </label>
                <StagedCardPhotoPreviews
                  files={card.files}
                  onRemove={(fileId) => removeCardFile(card.id, fileId)}
                  caption={`${card.files.length} file${
                    card.files.length === 1 ? "" : "s"
                  } selected${
                    card.files.length >= MAX_PHOTOS_PER_CARD
                      ? ` (max ${MAX_PHOTOS_PER_CARD})`
                      : ""
                  }`}
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
            <p className="text-sm text-ink/70">
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
        {showValidationError && (
          <p
            className="rounded-2xl border-2 border-berry bg-berry/20 px-4 py-3 text-sm font-semibold text-ink"
            role="alert"
          >
            Please fill out all required fields
          </p>
        )}

        <Button type="submit" fullWidth disabled={isBusy || !isSupabaseConfigured}>
          {isBusy ? (
            <span className="inline-block animate-soft-bounce">
              {status === "uploading" ? "Uploading photos..." : "Submitting..."}
            </span>
          ) : (
            "Submit quote request"
          )}
        </Button>
      </div>
    </form>
  );
}

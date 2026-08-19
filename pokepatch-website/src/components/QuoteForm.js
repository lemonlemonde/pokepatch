"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Button from "@/components/Button";
import { StagedCardPhotoPreviews } from "@/components/CardPhotoPreviews";
import QuoteLoginDialog from "@/components/QuoteLoginDialog";
import { useAuth } from "@/contexts/AuthContext";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { CONTACT_TYPES } from "@/lib/contacts";
import { sanitizeFilename } from "@/lib/customerOrderMedia";
import { compressImageForUpload, makeThumbForUpload } from "@/lib/imageCompression";
import { uploadImageWithThumb } from "@/lib/uploadWithThumb";
import { capture } from "@/lib/posthog";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";
import { fieldClassName, optionClassName } from "@/lib/formStyles";
import { DAMAGE_TAGS, normalizeDamageTags } from "@/lib/gallery";
import { priorityServicePricingHint, CARD_WHITENING_WARNING } from "@/lib/servicePricing";
import {
  AccountFieldNote,
  copyFileList,
  emptyContactValues,
  hasAdditionalContact,
  isQuoteCardComplete as isCardComplete,
  isQuoteCardEmpty as isCardEmpty,
} from "@/lib/quoteDraftHelpers";

const MAX_CARDS = 25;
const MAX_PHOTOS_PER_CARD = 4;

const HEARD_ABOUT_OPTIONS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "discord", label: "Discord" },
  { value: "card_show", label: "Card show" },
  { value: "friend", label: "Friend" },
  { value: "other", label: "Other" },
];

function emptyCard() {
  return {
    id: crypto.randomUUID(),
    cardName: "",
    setName: "",
    damageTags: [],
    description: "",
    files: [],
  };
}

// The first card is rendered during SSR, so it needs a stable ID that matches on
// the server and client. Dynamically added cards use random UUIDs.
function initialCard() {
  return {
    id: "card-initial",
    cardName: "",
    setName: "",
    damageTags: [],
    description: "",
    files: [],
  };
}

function cardFieldErrors(card) {
  return {
    cardName: card.cardName.trim() === "",
    damageTags: normalizeDamageTags(card.damageTags).length === 0,
    files: card.files.length === 0,
  };
}

function getFieldErrors({
  firstName,
  lastName,
  email,
  deliveryMethod,
  contactValues,
  cards,
}) {
  const errors = {
    firstName: firstName.trim() === "",
    lastName: lastName.trim() === "",
    email: email.trim() === "" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    deliveryMethod: deliveryMethod === "",
    contacts: !hasAdditionalContact(contactValues),
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
  if (
    errors.firstName ||
    errors.lastName ||
    errors.email ||
    errors.deliveryMethod ||
    errors.contacts
  ) {
    return true;
  }
  if (errors.noCards) return true;
  return Object.keys(errors.cards).length > 0;
}

function getFirstErrorElement(errors, cards) {
  if (!errors) return null;

  if (errors.firstName) {
    return document.getElementById("customer_first_name");
  }
  if (errors.lastName) {
    return document.getElementById("customer_last_name");
  }
  if (errors.email) {
    return document.getElementById("customer_email");
  }
  if (errors.deliveryMethod) {
    return document.getElementById("delivery_method");
  }
  if (errors.contacts) {
    const firstType = CONTACT_TYPES[0]?.value;
    return (
      (firstType ? document.getElementById(`contact_${firstType}`) : null) ??
      document.getElementById("additional_contacts")
    );
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
    if (cardErrors.damageTags) {
      return document.getElementById(`card_damage_${card.id}`);
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
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [contactValues, setContactValues] = useState(emptyContactValues);
  const [lockedTypes, setLockedTypes] = useState({});
  const [lockedName, setLockedName] = useState({ firstName: false, lastName: false });
  const [preferredContactId, setPreferredContactId] = useState("email");
  const [heardAbout, setHeardAbout] = useState("");
  const [heardAboutOther, setHeardAboutOther] = useState("");
  const [isPriority, setIsPriority] = useState(false);
  const [cards, setCards] = useState([initialCard()]);
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState(null);
  const [cardFileErrors, setCardFileErrors] = useState({});
  const [formStarted, setFormStarted] = useState(false);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  // Set when the visitor chose "continue as guest" on an email that already has
  // an account. Blocks submission until they change the email or log in.
  const [guestBlockedEmail, setGuestBlockedEmail] = useState("");
  const [loginNotice, setLoginNotice] = useState("");
  // Emails already checked against email_has_account this session, so a second
  // submit attempt doesn't re-hit the RPC.
  const checkedEmailsRef = useRef(new Map());

  function onFormInteraction() {
    if (!formStarted) setFormStarted(true);
    if (formStartedRef.current) return;
    formStartedRef.current = true;
    capture("quote_form_started");
  }

  useEffect(() => {
    if (customerInfoCompletedRef.current) return;
    const hasEmail = email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (
      firstName.trim() &&
      lastName.trim() &&
      hasEmail &&
      deliveryMethod &&
      hasAdditionalContact(contactValues)
    ) {
      customerInfoCompletedRef.current = true;
      capture("quote_form_step_completed", { step: "customer_info" });
    }
  }, [firstName, lastName, email, deliveryMethod, contactValues]);

  useEffect(() => {
    if (cardDetailsCompletedRef.current) return;
    if (cards.some(isCardComplete)) {
      cardDetailsCompletedRef.current = true;
      capture("quote_form_step_completed", { step: "card_details" });
    }
  }, [cards]);

  const quoteLeaveGuardActive =
    formStarted &&
    status !== "success" &&
    status !== "uploading" &&
    status !== "submitting";
  const { dialog: unsavedChangesDialog } = useUnsavedChangesGuard(
    quoteLeaveGuardActive
  );

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
      .select("first_name, last_name, contacts, preferred_contact_type")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const nameLocked = { firstName: false, lastName: false };
        const profileFirst = (data.first_name ?? "").trim();
        const profileLast = (data.last_name ?? "").trim();
        if (profileFirst) {
          setFirstName(profileFirst);
          nameLocked.firstName = true;
        }
        if (profileLast) {
          setLastName(profileLast);
          nameLocked.lastName = true;
        }
        setLockedName(nameLocked);
        if (Array.isArray(data.contacts) && data.contacts.length > 0) {
          const knownTypes = emptyContactValues();
          const saved = {};
          const locked = {};
          for (const c of data.contacts) {
            if (c && c.contact_type in knownTypes) {
              saved[c.contact_type] = c.value ?? "";
              locked[c.contact_type] = true;
            }
          }
          // Merge rather than replace: someone who logs in mid-form keeps the
          // contact methods they just typed for any type the account doesn't
          // already have. Where both have a value, the account wins.
          setContactValues((prev) => ({ ...prev, ...saved }));
          setLockedTypes(locked);
        }
        // Preferred contact method saved on the account (written back by
        // create_order when a previous order first supplied it).
        const savedPreferred = (data.preferred_contact_type ?? "").trim();
        if (savedPreferred) setPreferredContactId(savedPreferred);
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
      if (!card.cardName && !card.files && !card.damageTags) {
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
    if (value.trim() !== "") clearFieldError("contacts");
  }

  function updateCard(id, patch) {
    onFormInteraction();
    if (patch.cardName !== undefined) clearCardFieldError(id, "cardName");
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  }

  function toggleCardDamage(id, tagId) {
    onFormInteraction();
    const card = cards.find((entry) => entry.id === id);
    if (!card) return;
    const current = card.damageTags ?? [];
    const next = current.includes(tagId)
      ? current.filter((damageId) => damageId !== tagId)
      : [...current, tagId];
    const damageTags = normalizeDamageTags(next);
    if (damageTags.length > 0) clearCardFieldError(id, "damageTags");
    setCards((prev) =>
      prev.map((entry) =>
        entry.id === id ? { ...entry, damageTags } : entry
      )
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

    // Accept any image; compression runs on submit. Reject only non-images.
    const images = selected.filter(
      (file) => file.type && file.type.startsWith("image/")
    );
    const skipped = selected.length - images.length;

    if (images.length === 0) {
      setCardFileErrors((prev) => ({
        ...prev,
        [cardId]: "Please choose image files (JPEG, PNG, or WebP).",
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
          ...images.map((file) => ({ id: crypto.randomUUID(), file })),
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
        [cardId]: `${skipped} file${skipped === 1 ? "" : "s"} skipped (not an image). ${images.length} added.`,
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

  // True once the visitor has been told this email belongs to an account and
  // chose to continue as a guest anyway. They have to change it or log in.
  const emailBlocked =
    guestBlockedEmail !== "" &&
    email.trim().toLowerCase() === guestBlockedEmail;

  // Returns true when the submission should stop and the login prompt opens.
  async function shouldPromptLogin(normalizedEmail) {
    if (user || !isCustomerAuthEnabled() || !supabase) return false;

    const cached = checkedEmailsRef.current.get(normalizedEmail);
    if (cached !== undefined) return cached;

    try {
      const { data, error } = await supabase.rpc("email_has_account", {
        p_email: normalizedEmail,
      });
      if (error) throw error;
      const hasAccount = data === true;
      checkedEmailsRef.current.set(normalizedEmail, hasAccount);
      return hasAccount;
    } catch (err) {
      // Throttled or offline: fail open so a lookup problem can never stop
      // someone from sending in their cards.
      console.error("Failed to check for an existing account:", err);
      return false;
    }
  }

  function handleLoginPromptSuccess() {
    setLoginPromptOpen(false);
    setGuestBlockedEmail("");
    setStatus("idle");
    // The account details land via the profile effect above once `user` flips.
    setLoginNotice(
      "You're logged in. We filled in your account details — give them a look, then submit."
    );
  }

  function focusEmailField() {
    requestAnimationFrame(() => {
      const field = document.getElementById("customer_email");
      if (!field) return;
      field.scrollIntoView({ behavior: "smooth", block: "center" });
      field.focus({ preventScroll: true });
    });
  }

  function handleLoginPromptGuest() {
    setLoginPromptOpen(false);
    setStatus("idle");
    setLoginNotice("");
    setGuestBlockedEmail(email.trim().toLowerCase());
    focusEmailField();
  }

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
      firstName,
      lastName,
      email,
      deliveryMethod,
      contactValues,
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

    const normalizedEmail = email.trim().toLowerCase();

    if (emailBlocked) {
      focusEmailField();
      return;
    }

    setStatus("checking");
    setErrorMessage("");
    setLoginNotice("");

    if (await shouldPromptLogin(normalizedEmail)) {
      capture("quote_form_existing_account_prompt");
      setLoginPromptOpen(true);
      return;
    }

    setStatus("uploading");

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
          const { file: uploadFile, error: compressError } =
            await compressImageForUpload(file);
          if (compressError || !uploadFile) {
            throw new Error(compressError || "Couldn't process this image.");
          }
          const { file: thumbFile } = await makeThumbForUpload(uploadFile);
          const path = `order-${orderId}/card-${cardId}/customer-${i + 1}-${sanitizeFilename(uploadFile.name)}`;
          await uploadImageWithThumb(
            supabase,
            "card-photos",
            path,
            uploadFile,
            thumbFile
          );
          images.push({ storage_path: path, image_type: "customer" });
        }

        cardsPayload.push({
          id: cardId,
          card_name: card.cardName.trim(),
          set_name: card.setName.trim() || null,
          description: card.description.trim(),
          damage_tags: normalizeDamageTags(card.damageTags),
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

      const heardAboutOption = HEARD_ABOUT_OPTIONS.find(
        (option) => option.value === heardAbout
      );
      const heardAboutSource =
        heardAbout === "other"
          ? heardAboutOther.trim()
          : (heardAboutOption?.label ?? "");

      const payload = {
        id: orderId,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        customer_email: email.trim().toLowerCase(),
        delivery_method: deliveryMethod,
        heard_about_source: heardAboutSource,
        preferred_contact_type: preferredType,
        preferred_contact_value: preferredValue,
        is_priority: isPriority,
        contacts: filledContactTypes.map((type) => ({
          contact_type: type.value,
          value: contactValues[type.value].trim(),
        })),
        cards: cardsPayload,
      };

      const { data: orderResult, error: rpcError } = await supabase.rpc("create_order", {
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
              first_name: firstName.trim(),
              last_name: lastName.trim(),
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
        is_priority: isPriority,
      });

      const displayId = orderResult?.display_id;
      const thankYouPath =
        displayId != null
          ? `/thank-you?order=${encodeURIComponent(String(displayId))}`
          : "/thank-you";

      setStatus("success");
      setGuestBlockedEmail("");
      setLoginNotice("");
      setFormStarted(false);
      formStartedRef.current = false;
      setFirstName("");
      setLastName("");
      setEmail("");
      setDeliveryMethod("");
      setIsPriority(false);
      setContactValues(emptyContactValues());
      setLockedTypes({});
      setPreferredContactId("email");
      setCards([emptyCard()]);
      setFieldErrors(null);
      setCardFileErrors({});
      formRef.current?.reset();
      router.push(thankYouPath);
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

  const isBusy =
    status === "checking" || status === "uploading" || status === "submitting";

  const showValidationError = hasFieldErrors(fieldErrors);

  return (
    <>
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="marketing-panel animate-fade-up space-y-10 p-6 [animation-delay:150ms]"
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
        <p className="rounded-2xl border-2 border-error bg-error/20 px-4 py-3 text-sm font-semibold text-error">
          {errorMessage}
        </p>
      )}

      <section className="space-y-6">
        <h2 className="text-xl font-bold text-ink">Customer information</h2>

        <div>
          <label htmlFor="customer_first_name" className="mb-1 block text-sm font-bold text-ink">
            First name <span className="text-error">*</span>
          </label>
          <input
            id="customer_first_name"
            name="customer_first_name"
            type="text"
            value={firstName}
            onChange={(e) => {
              onFormInteraction();
              clearFieldError("firstName");
              setFirstName(e.target.value);
            }}
            placeholder="First name"
            className={fieldClassName(fieldErrors?.firstName, lockedName.firstName)}
            aria-invalid={fieldErrors?.firstName || undefined}
            disabled={lockedName.firstName}
            readOnly={lockedName.firstName}
            title={
              lockedName.firstName
                ? "Saved on your account. Edit it in account settings."
                : undefined
            }
          />
          {lockedName.firstName && (
            <AccountFieldNote>Your name comes from your account.</AccountFieldNote>
          )}
        </div>

        <div>
          <label htmlFor="customer_last_name" className="mb-1 block text-sm font-bold text-ink">
            Last name <span className="text-error">*</span>
          </label>
          <input
            id="customer_last_name"
            name="customer_last_name"
            type="text"
            value={lastName}
            onChange={(e) => {
              onFormInteraction();
              clearFieldError("lastName");
              setLastName(e.target.value);
            }}
            placeholder="Last name"
            className={fieldClassName(fieldErrors?.lastName, lockedName.lastName)}
            aria-invalid={fieldErrors?.lastName || undefined}
            disabled={lockedName.lastName}
            readOnly={lockedName.lastName}
            title={
              lockedName.lastName
                ? "Saved on your account. Edit it in account settings."
                : undefined
            }
          />
          {lockedName.lastName && (
            <AccountFieldNote>Your name comes from your account.</AccountFieldNote>
          )}
        </div>

        <div>
          <label htmlFor="customer_email" className="mb-1 block text-sm font-bold text-ink">
            Email <span className="text-error">*</span>
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
            className={fieldClassName(fieldErrors?.email || emailBlocked, !!user)}
            aria-invalid={fieldErrors?.email || emailBlocked || undefined}
            disabled={!!user}
            readOnly={!!user}
          />
          {emailBlocked && (
            <p className="mt-1 text-sm text-error" role="alert">
              This email already belongs to an account. Log in to use it, or
              enter a different email to order as a guest.{" "}
              <button
                type="button"
                onClick={() => setLoginPromptOpen(true)}
                className="font-semibold underline"
              >
                Log in
              </button>
            </p>
          )}
          {loginNotice && (
            <p className="mt-1 text-sm font-semibold text-ink/80">
              {loginNotice}
            </p>
          )}
          {user && (
            <p className="mt-1 text-xs text-ink/60">
              Using your account email.{" "}
              <Link href="/account" className="font-semibold text-ink hover:underline">
                Manage account
              </Link>
            </p>
          )}
          {fieldErrors?.email && (
            <p className="mt-1 text-sm text-error">
              Please enter a valid email address
            </p>
          )}
        </div>

        <fieldset id="delivery_method" className="space-y-3 scroll-mt-24">
          <legend className="text-sm font-bold text-ink">
            Delivery method <span className="text-error">*</span>
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

        <div id="additional_contacts" className="scroll-mt-24 space-y-3">
          <p className="text-sm font-bold text-ink">
            Other forms of contact <span className="text-error">*</span>
          </p>
          <p className="text-sm text-ink/70">
            Provide at least one so we can reach you (phone, Discord, or
            Instagram).
          </p>
          {fieldErrors?.contacts && (
            <p className="text-sm text-error" role="alert">
              Please enter at least one additional contact method
            </p>
          )}
          {CONTACT_TYPES.map((type) => {
            const value = contactValues[type.value] ?? "";
            const locked = !!lockedTypes[type.value];
            const showError = fieldErrors?.contacts && value.trim() === "";
            return (
              <div key={type.value}>
                <label
                  htmlFor={`contact_${type.value}`}
                  className="mb-1 block text-sm font-bold text-ink"
                >
                  {type.label}
                </label>
                <input
                  id={`contact_${type.value}`}
                  type="text"
                  value={value}
                  onChange={(e) => updateContactValue(type.value, e.target.value)}
                  placeholder={
                    type.value === "phone" ? "(555) 555-5555" : "@yourusername"
                  }
                  className={fieldClassName(showError, locked)}
                  aria-invalid={showError || undefined}
                  disabled={locked}
                  readOnly={locked}
                  title={
                    locked
                      ? "Saved on your account. Edit it in account settings."
                      : undefined
                  }
                />
                {locked && (
                  <AccountFieldNote>
                    Saved contact methods come from your account.
                  </AccountFieldNote>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-3">
          <label
            htmlFor="preferred_contact"
            className="block text-sm font-bold text-ink"
          >
            Preferred contact method
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
            Add up to {MAX_CARDS} cards. For more than {MAX_CARDS} cards,
            submit as 1 card entry with a photo of the entire bulk lot and a
            combined description, submit a separate order, or reach out.
          </p>
        </div>

        {cards.length === 0 && (
          <p
            id="cards_empty"
            className={
              fieldErrors?.noCards
                ? "scroll-mt-24 rounded-xl border-2 border-error bg-error/10 px-4 py-3 text-sm text-ink"
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
              className="marketing-panel space-y-4 p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-ink">Card {index + 1}</h3>
                <button
                  type="button"
                  onClick={() => removeCard(card.id)}
                  className="text-sm font-semibold text-ink/45 transition-colors hover:text-ink"
                >
                  Remove card
                </button>
              </div>

              <div>
                <label
                  htmlFor={`card_name_${card.id}`}
                  className="mb-1 block text-sm font-bold text-ink"
                >
                  Card name <span className="text-error">*</span>
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
                  className="mb-1 block text-sm font-bold text-ink"
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

              <div id={`card_damage_${card.id}`}>
                <p className="mb-1 text-sm font-bold text-ink">
                  Damage <span className="text-error">*</span>
                </p>
                <p className="mb-2 text-sm text-ink/70">
                  Select at least one damage type that applies.
                </p>
                <div
                  className={
                    cardErrors?.damageTags
                      ? "flex flex-wrap gap-2 rounded-lg border border-error bg-error/10 p-2"
                      : "flex flex-wrap gap-2"
                  }
                  role="group"
                  aria-label="Damage types"
                  aria-invalid={cardErrors?.damageTags || undefined}
                >
                  {DAMAGE_TAGS.map((tag) => {
                    const selected = (card.damageTags ?? []).includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleCardDamage(card.id, tag.id)}
                        className={
                          selected
                            ? "rounded-lg border border-ink/45 bg-ink/20 px-3 py-1.5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition-colors duration-150"
                            : "rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-sm font-semibold text-ink transition-colors duration-150 hover:border-ink/35 hover:bg-ink/10"
                        }
                      >
                        {tag.label}
                      </button>
                    );
                  })}
                </div>
                {(card.damageTags ?? []).includes("whitening") ? (
                  <p
                    className="mt-3 rounded-lg border border-ink/25 bg-ink/10 px-3 py-2.5 text-sm leading-relaxed text-ink/75"
                    role="note"
                  >
                    <span className="font-semibold text-ink">Note. </span>
                    {CARD_WHITENING_WARNING}
                  </p>
                ) : null}
              </div>

              <div>
                <label
                  htmlFor={`description_${card.id}`}
                  className="mb-1 block text-sm font-bold text-ink"
                >
                  Description
                </label>
                <p className="mb-2 text-sm text-ink/70">
                  Optional notes about the damage and where it is (e.g. crease
                  on left edge, scratches on holo).
                </p>
                <textarea
                  id={`description_${card.id}`}
                  rows={4}
                  value={card.description}
                  onChange={(e) =>
                    updateCard(card.id, { description: e.target.value })
                  }
                  placeholder="Describe the repair needed..."
                  className={fieldClassName()}
                />
              </div>

              <div>
                <p className="mb-1 text-sm font-bold text-ink">
                  Photos <span className="text-error">*</span>
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
                  <p className="mb-2 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm font-semibold text-ink">
                    {cardFileErrors[card.id]}
                  </p>
                )}
                <label
                  htmlFor={inputId}
                  className={
                    cardErrors?.files
                      ? "inline-flex scroll-mt-24 cursor-pointer items-center rounded-full border border-error bg-error/15 px-4 py-2 text-sm font-semibold text-ink"
                      : "inline-flex scroll-mt-24 cursor-pointer items-center rounded-full border border-ink/20 bg-transparent px-4 py-2 text-sm font-semibold text-ink transition-colors duration-150 sm:hover:border-ink/40 sm:hover:bg-ink/5"
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
            className="inline-flex items-center rounded-full border border-ink/20 bg-transparent px-4 py-2 text-sm font-semibold text-ink transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 sm:hover:border-ink/40 sm:hover:bg-ink/5"
          >
            + Add Card
          </button>
          {cards.length >= MAX_CARDS && (
            <p className="text-sm text-ink/70">
              Maximum of {MAX_CARDS} cards. For larger lots, use one card entry
              with a photo of the entire lot and a description, submit a
              separate order, or reach out.
            </p>
          )}
        </div>
      </section>

      <div className="space-y-3">
        <label htmlFor="heard_about_source" className="block">
          <span className="text-sm font-bold text-ink">
            How did you hear about us?
          </span>
        </label>
        <select
          id="heard_about_source"
          value={heardAbout}
          onChange={(e) => {
            onFormInteraction();
            setHeardAbout(e.target.value);
            if (e.target.value !== "other") setHeardAboutOther("");
          }}
          className={fieldClassName()}
        >
          <option value="">Select an option</option>
          {HEARD_ABOUT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {heardAbout === "other" && (
          <input
            type="text"
            value={heardAboutOther}
            onChange={(e) => {
              onFormInteraction();
              setHeardAboutOther(e.target.value);
            }}
            placeholder="Tell us where you heard about us"
            className={fieldClassName()}
          />
        )}
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-bold text-ink">Priority service</h2>
          <p className="mt-1 text-sm text-ink/60">
            Optional faster handling for your whole order.
          </p>
        </div>
        <label
          className={`${optionClassName()} ${
            isPriority
              ? "border-ink/35 bg-ink/[0.08] ring-1 ring-ink/20"
              : ""
          }`.trim()}
        >
          <input
            type="checkbox"
            checked={isPriority}
            onChange={(e) => {
              onFormInteraction();
              setIsPriority(e.target.checked);
            }}
            className="mt-1 h-4 w-4 shrink-0 accent-ink"
          />
          <span className="text-sm leading-relaxed text-ink/80">
            <span className="flex flex-wrap items-center gap-2 font-bold text-ink">
              <span>Prioritize my order</span>
              {isPriority ? (
                <span className="rounded-full border border-ink/25 bg-ink/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink">
                  Active
                </span>
              ) : null}
            </span>
            <span className="mt-1 block text-ink/65">
              {priorityServicePricingHint(completeCards.length)}
            </span>
          </span>
        </label>
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
            className="rounded-2xl border-2 border-error bg-error/15 px-4 py-3 text-sm font-semibold text-ink"
            role="alert"
          >
            Please fill out all required fields
          </p>
        )}

        <Button
          type="submit"
          fullWidth
          disabled={isBusy || emailBlocked || !isSupabaseConfigured}
        >
          {isBusy ? (
            <span className="inline-block animate-soft-bounce">
              {status === "checking"
                ? "Checking your email..."
                : status === "uploading"
                  ? "Uploading photos..."
                  : "Submitting..."}
            </span>
          ) : (
            "Submit quote request"
          )}
        </Button>
      </div>
    </form>
    {loginPromptOpen && (
      <QuoteLoginDialog
        email={email.trim().toLowerCase()}
        onLoggedIn={handleLoginPromptSuccess}
        onGuest={handleLoginPromptGuest}
      />
    )}
    {unsavedChangesDialog}
    </>
  );
}

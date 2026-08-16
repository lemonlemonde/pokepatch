"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CardPhotoPreviewGrid,
  StagedCardPhotoPreviews,
} from "@/components/CardPhotoPreviews";
import Button from "@/components/Button";
import { useAuth } from "@/contexts/AuthContext";
import { CONTACT_TYPES } from "@/lib/contacts";
import {
  CARD_PHOTOS_BUCKET,
  sanitizeFilename,
  signPaths,
} from "@/lib/customerOrderMedia";
import { DAMAGE_TAGS, normalizeDamageTags } from "@/lib/damageTags";
import { fieldClassName, optionClassName } from "@/lib/formStyles";
import {
  compressImageForUpload,
  makeThumbForUpload,
  thumbPath,
} from "@/lib/imageCompression";
import {
  CARD_WHITENING_WARNING,
  priorityServicePricingHint,
} from "@/lib/servicePricing";
import { supabase } from "@/lib/supabaseClient";
import { uploadImageWithThumb } from "@/lib/uploadWithThumb";

const MAX_CARDS = 25;
const MAX_PHOTOS_PER_CARD = 4;

function AccountFieldNote({ children }) {
  return (
    <p className="mt-1 text-xs text-ink/60">
      {children}{" "}
      <Link href="/account" className="font-semibold text-ink hover:underline">
        Manage account
      </Link>
    </p>
  );
}

function emptyContactValues() {
  return CONTACT_TYPES.reduce(
    (acc, type) => ({ ...acc, [type.value]: "" }),
    {}
  );
}

function draftFromOrder(order) {
  const contactValues = emptyContactValues();
  for (const contact of order?.contacts ?? []) {
    if (
      contact?.contact_type &&
      contactValues[contact.contact_type] !== undefined
    ) {
      contactValues[contact.contact_type] = contact.value ?? "";
    }
  }

  const preferred =
    order?.preferred_contact_type &&
    order.preferred_contact_type !== "email" &&
    CONTACT_TYPES.some((type) => type.value === order.preferred_contact_type)
      ? order.preferred_contact_type
      : "email";

  const cards = (order?.cards ?? []).map((card) => ({
    id: card.id,
    cardName: card.card_name ?? "",
    setName: card.set_name ?? "",
    damageTags: normalizeDamageTags(card.damage_tags),
    description: card.description ?? "",
    existingImages: (card.images ?? [])
      .filter((image) => (image.image_type ?? "customer") === "customer")
      .map((image) => ({
        id: image.id,
        storage_path: image.storage_path,
      })),
    newFiles: [],
  }));

  // Filled order contacts start locked (order-only). Account profile load may
  // reclassify them as account-saved; empty types stay editable so new ones can
  // be added — matching QuoteForm’s “can’t edit saved contacts here” rule.
  const lockedTypes = {};
  const lockReasons = {};
  for (const type of CONTACT_TYPES) {
    if ((contactValues[type.value] ?? "").trim()) {
      lockedTypes[type.value] = true;
      lockReasons[type.value] = "orderOnly";
    }
  }

  return {
    deliveryMethod: order?.delivery_method ?? "",
    isPriority: Boolean(order?.is_priority),
    contactValues,
    preferredContactId: preferred,
    cards: cards.length > 0 ? cards : [newEmptyCard()],
    lockedTypes,
    lockReasons,
  };
}

function newEmptyCard() {
  return {
    id: crypto.randomUUID(),
    cardName: "",
    setName: "",
    damageTags: [],
    description: "",
    existingImages: [],
    newFiles: [],
  };
}

function copyFileList(fileList) {
  if (!fileList) return [];
  const copied = [];
  for (let i = 0; i < fileList.length; i += 1) {
    copied.push(fileList[i]);
  }
  return copied;
}

function hasAdditionalContact(contactValues) {
  return CONTACT_TYPES.some(
    (type) => (contactValues[type.value] ?? "").trim() !== ""
  );
}

function isCardComplete(card) {
  return (
    card.cardName.trim() !== "" &&
    normalizeDamageTags(card.damageTags).length > 0 &&
    card.existingImages.length + card.newFiles.length > 0
  );
}

function isCardEmpty(card) {
  return (
    card.cardName.trim() === "" &&
    card.setName.trim() === "" &&
    normalizeDamageTags(card.damageTags).length === 0 &&
    card.description.trim() === "" &&
    card.existingImages.length === 0 &&
    card.newFiles.length === 0
  );
}

export default function CustomerOrderEditor({ order, onSaved, onCanceled }) {
  const { user } = useAuth();
  const profileLoadedRef = useRef(false);
  const [seed] = useState(() => draftFromOrder(order));
  const [draft, setDraft] = useState(seed);
  // account = saved on profile (QuoteForm parity); orderOnly = on this order
  // but not on the account — neither is editable here.
  const [lockedTypes, setLockedTypes] = useState(seed.lockedTypes);
  const [lockReasons, setLockReasons] = useState(seed.lockReasons);
  const [thumbUrls, setThumbUrls] = useState({});
  const [fieldErrors, setFieldErrors] = useState(null);
  const [cardFileErrors, setCardFileErrors] = useState({});
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    if (!user || !supabase || profileLoadedRef.current) return;
    profileLoadedRef.current = true;

    supabase
      .from("customer_profiles")
      .select("contacts, preferred_contact_type")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const accountByType = {};
        if (Array.isArray(data?.contacts)) {
          for (const contact of data.contacts) {
            const type = contact?.contact_type;
            const value = String(contact?.value ?? "").trim();
            if (!type || !(type in emptyContactValues()) || !value) continue;
            accountByType[type] = value;
          }
        }

        setDraft((current) => {
          const nextContacts = { ...current.contactValues };
          // Account values win for types saved on the profile.
          for (const [type, value] of Object.entries(accountByType)) {
            nextContacts[type] = value;
          }
          const savedPreferred = String(
            data?.preferred_contact_type ?? ""
          ).trim();
          return {
            ...current,
            contactValues: nextContacts,
            preferredContactId: savedPreferred || current.preferredContactId,
          };
        });

        const nextLocks = {};
        const nextReasons = {};
        for (const type of Object.keys(accountByType)) {
          nextLocks[type] = true;
          nextReasons[type] = "account";
        }
        for (const type of CONTACT_TYPES) {
          const orderValue = String(
            (order.contacts ?? []).find((c) => c.contact_type === type.value)
              ?.value ?? ""
          ).trim();
          if (orderValue && !accountByType[type.value]) {
            nextLocks[type.value] = true;
            nextReasons[type.value] = "orderOnly";
          }
        }
        setLockedTypes(nextLocks);
        setLockReasons(nextReasons);
      });
  }, [user, order.contacts]);

  const existingPathsKey = useMemo(
    () =>
      draft.cards
        .flatMap((card) =>
          card.existingImages.map((image) => image.storage_path)
        )
        .join("|"),
    [draft.cards]
  );

  useEffect(() => {
    let active = true;
    const paths = existingPathsKey
      ? existingPathsKey.split("|").filter(Boolean)
      : [];
    signPaths(paths, { preferThumb: true }).then((map) => {
      if (active) setThumbUrls(map);
    });
    return () => {
      active = false;
    };
  }, [existingPathsKey]);

  const completeCards = draft.cards.filter(isCardComplete);
  const preferredOptions = [
    { id: "email", label: "Email" },
    ...CONTACT_TYPES.filter(
      (type) => (draft.contactValues[type.value] ?? "").trim() !== ""
    ).map((type) => ({ id: type.value, label: type.label })),
  ];
  const preferredOptionIds = new Set(preferredOptions.map((o) => o.id));
  const effectivePreferredId = preferredOptionIds.has(draft.preferredContactId)
    ? draft.preferredContactId
    : "email";

  function updateContactValue(type, value) {
    if (lockedTypes[type]) return;
    setDraft((current) => ({
      ...current,
      contactValues: { ...current.contactValues, [type]: value },
    }));
  }

  function updateCard(cardId, patch) {
    setDraft((current) => ({
      ...current,
      cards: current.cards.map((card) =>
        card.id === cardId ? { ...card, ...patch } : card
      ),
    }));
  }

  function toggleCardDamage(cardId, tagId) {
    const card = draft.cards.find((row) => row.id === cardId);
    if (!card) return;
    const selected = card.damageTags.includes(tagId);
    const next = selected
      ? card.damageTags.filter((id) => id !== tagId)
      : [...card.damageTags, tagId];
    updateCard(cardId, { damageTags: normalizeDamageTags(next) });
  }

  function validate() {
    const errors = {
      deliveryMethod: !draft.deliveryMethod,
      contacts: !hasAdditionalContact(draft.contactValues),
      noCards: !draft.cards.some(isCardComplete),
    };
    const cardErrors = {};
    for (const card of draft.cards) {
      if (isCardEmpty(card)) continue;
      cardErrors[card.id] = {
        cardName: card.cardName.trim() === "",
        damageTags: normalizeDamageTags(card.damageTags).length === 0,
        files: card.existingImages.length + card.newFiles.length < 1,
      };
    }
    const hasCardFieldError = Object.values(cardErrors).some(
      (row) => row.cardName || row.damageTags || row.files
    );
    setFieldErrors({ ...errors, cards: cardErrors });
    return (
      !errors.deliveryMethod &&
      !errors.contacts &&
      !errors.noCards &&
      !hasCardFieldError
    );
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!supabase || status === "saving") return;
    if (!validate()) {
      setErrorMessage("Please fill out all required fields");
      return;
    }

    setStatus("saving");
    setErrorMessage("");

    const removedPaths = [];
    const beforePaths = new Set(
      (order.cards ?? []).flatMap((card) =>
        (card.images ?? [])
          .filter((image) => (image.image_type ?? "customer") === "customer")
          .map((image) => image.storage_path)
      )
    );

    try {
      const cardsPayload = [];
      for (const card of completeCards) {
        const images = card.existingImages.map((image) => ({
          id: image.id,
          storage_path: image.storage_path,
          image_type: "customer",
        }));

        for (let i = 0; i < card.newFiles.length; i += 1) {
          const { file } = card.newFiles[i];
          const { file: uploadFile, error: compressError } =
            await compressImageForUpload(file);
          if (compressError || !uploadFile) {
            throw new Error(compressError || "Couldn't process this image.");
          }
          const { file: thumbFile } = await makeThumbForUpload(uploadFile);
          const path = `order-${order.id}/card-${card.id}/customer-${Date.now()}-${
            i + 1
          }-${sanitizeFilename(uploadFile.name)}`;
          await uploadImageWithThumb(
            supabase,
            CARD_PHOTOS_BUCKET,
            path,
            uploadFile,
            thumbFile
          );
          images.push({ storage_path: path, image_type: "customer" });
        }

        cardsPayload.push({
          id: card.id,
          card_name: card.cardName.trim(),
          set_name: card.setName.trim() || null,
          description: card.description.trim() || null,
          damage_tags: normalizeDamageTags(card.damageTags),
          images,
        });
      }

      const keptPaths = new Set(
        cardsPayload.flatMap((card) =>
          (card.images ?? []).map((image) => image.storage_path)
        )
      );
      for (const path of beforePaths) {
        if (!keptPaths.has(path)) removedPaths.push(path);
      }

      let preferredType = "email";
      let preferredValue = order.customer_email ?? "";
      if (effectivePreferredId !== "email") {
        preferredType = effectivePreferredId;
        preferredValue = draft.contactValues[preferredType].trim();
      }

      const payload = {
        delivery_method: draft.deliveryMethod,
        is_priority: draft.isPriority,
        preferred_contact_type: preferredType,
        preferred_contact_value: preferredValue,
        contacts: CONTACT_TYPES.filter(
          (type) => (draft.contactValues[type.value] ?? "").trim() !== ""
        ).map((type) => ({
          contact_type: type.value,
          value: draft.contactValues[type.value].trim(),
        })),
        cards: cardsPayload,
      };

      const { data, error } = await supabase.rpc("update_my_order", {
        p_order_id: order.id,
        p_payload: payload,
      });
      if (error) throw error;

      if (removedPaths.length > 0) {
        try {
          await supabase.storage.from(CARD_PHOTOS_BUCKET).remove([
            ...removedPaths,
            ...removedPaths.map((path) => thumbPath(path)),
          ]);
        } catch {
          // RLS may block deletes; orphaned objects are acceptable.
        }
      }

      setStatus("idle");
      onSaved?.(data);
    } catch (err) {
      setStatus("idle");
      setErrorMessage(err.message || "Failed to save changes");
    }
  }

  async function handleCancelOrder() {
    if (!supabase || status === "canceling") return;
    setStatus("canceling");
    setErrorMessage("");
    try {
      const { data, error } = await supabase.rpc("cancel_my_order", {
        p_order_id: order.id,
      });
      if (error) throw error;
      onCanceled?.(data);
    } catch (err) {
      setStatus("idle");
      setConfirmCancel(false);
      setErrorMessage(err.message || "Failed to cancel order");
    }
  }

  const busy = status === "saving" || status === "canceling";
  const showValidationError = Boolean(
    fieldErrors &&
      (fieldErrors.deliveryMethod ||
        fieldErrors.contacts ||
        fieldErrors.noCards ||
        Object.values(fieldErrors.cards ?? {}).some(
          (row) => row.cardName || row.damageTags || row.files
        ))
  );

  return (
    <form onSubmit={handleSave} noValidate className="space-y-10">
      {errorMessage ? (
        <p className="rounded-2xl border-2 border-error bg-error/20 px-4 py-3 text-sm font-semibold text-error">
          {errorMessage}
        </p>
      ) : null}

      <section className="space-y-6">
        <h2 className="text-xl font-bold text-ink">Customer information</h2>

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
              checked={draft.deliveryMethod === "local_dropoff"}
              disabled={busy}
              onChange={() =>
                setDraft((current) => ({
                  ...current,
                  deliveryMethod: "local_dropoff",
                }))
              }
              className="mt-1"
            />
            <span className="text-sm text-ink">
              Local Drop-Off (North San Jose)
            </span>
          </label>
          <label className={optionClassName(fieldErrors?.deliveryMethod)}>
            <input
              type="radio"
              name="delivery_method"
              value="shipping"
              checked={draft.deliveryMethod === "shipping"}
              disabled={busy}
              onChange={() =>
                setDraft((current) => ({
                  ...current,
                  deliveryMethod: "shipping",
                }))
              }
              className="mt-1"
            />
            <span className="text-sm text-ink">Shipping</span>
          </label>
        </fieldset>

        <div id="additional_contacts" className="scroll-mt-24 space-y-3">
          <p className="text-sm font-bold text-ink">
            Other forms of contact <span className="text-error">*</span>
          </p>
          <p className="text-sm text-ink/70">
            Provide at least one so we can reach you (phone, Discord, or
            Instagram). Saved account contacts can&apos;t be edited here.
          </p>
          {fieldErrors?.contacts ? (
            <p className="text-sm text-error" role="alert">
              Please enter at least one additional contact method
            </p>
          ) : null}
          {CONTACT_TYPES.map((type) => {
            const value = draft.contactValues[type.value] ?? "";
            const locked = !!lockedTypes[type.value];
            const showError = fieldErrors?.contacts && value.trim() === "";
            const reason = lockReasons[type.value];
            return (
              <div key={type.value}>
                <label
                  htmlFor={`edit_contact_${type.value}`}
                  className="mb-1 block text-sm font-bold text-ink"
                >
                  {type.label}
                </label>
                <input
                  id={`edit_contact_${type.value}`}
                  type="text"
                  value={value}
                  onChange={(event) =>
                    updateContactValue(type.value, event.target.value)
                  }
                  placeholder={
                    type.value === "phone" ? "(555) 555-5555" : "@yourusername"
                  }
                  className={fieldClassName(showError, locked)}
                  aria-invalid={showError || undefined}
                  disabled={busy || locked}
                  readOnly={locked}
                  title={
                    locked
                      ? reason === "account"
                        ? "Saved on your account. Edit it in account settings."
                        : "This contact is only on this order and can’t be edited here."
                      : undefined
                  }
                />
                {locked && reason === "account" ? (
                  <AccountFieldNote>
                    Saved contact methods come from your account.
                  </AccountFieldNote>
                ) : null}
                {locked && reason === "orderOnly" ? (
                  <p className="mt-1 text-xs text-ink/60">
                    This contact is only on this order, so it can&apos;t be
                    edited here.{" "}
                    <Link
                      href="/account"
                      className="font-semibold text-ink hover:underline"
                    >
                      Add it to your account
                    </Link>{" "}
                    to manage it going forward.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="space-y-3">
          <label
            htmlFor="edit_preferred_contact"
            className="block text-sm font-bold text-ink"
          >
            Preferred contact method
          </label>
          <p className="text-sm text-ink/70">
            How would you prefer we reach you about your order?
          </p>
          <select
            id="edit_preferred_contact"
            value={effectivePreferredId}
            disabled={busy}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                preferredContactId: event.target.value,
              }))
            }
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
            Add up to {MAX_CARDS} cards. For more than {MAX_CARDS} cards, submit
            as 1 card entry with a photo of the entire bulk lot and a combined
            description, submit a separate order, or reach out.
          </p>
        </div>

        {draft.cards.length === 0 ? (
          <p
            className={
              fieldErrors?.noCards
                ? "scroll-mt-24 rounded-xl border-2 border-error bg-error/10 px-4 py-3 text-sm text-ink"
                : "scroll-mt-24 text-sm text-ink/60"
            }
          >
            No cards yet. Add a card to continue.
          </p>
        ) : null}

        {draft.cards.map((card, index) => {
          const inputId = `edit_card_photos_${card.id}`;
          const cardErrors = fieldErrors?.cards?.[card.id];
          const photoCount =
            card.existingImages.length + card.newFiles.length;
          return (
            <div
              key={card.id}
              className="marketing-panel space-y-4 p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-ink">Card {index + 1}</h3>
                {draft.cards.length > 1 ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        cards: current.cards.filter((row) => row.id !== card.id),
                      }))
                    }
                    className="text-sm font-semibold text-ink/45 transition-colors hover:text-ink disabled:opacity-40"
                  >
                    Remove card
                  </button>
                ) : null}
              </div>

              <div>
                <label
                  htmlFor={`edit_card_name_${card.id}`}
                  className="mb-1 block text-sm font-bold text-ink"
                >
                  Card name <span className="text-error">*</span>
                </label>
                <input
                  id={`edit_card_name_${card.id}`}
                  type="text"
                  value={card.cardName}
                  disabled={busy}
                  onChange={(event) =>
                    updateCard(card.id, { cardName: event.target.value })
                  }
                  placeholder="e.g. Charizard"
                  className={fieldClassName(cardErrors?.cardName)}
                  aria-invalid={cardErrors?.cardName || undefined}
                />
              </div>

              <div>
                <label
                  htmlFor={`edit_set_name_${card.id}`}
                  className="mb-1 block text-sm font-bold text-ink"
                >
                  Set
                </label>
                <input
                  id={`edit_set_name_${card.id}`}
                  type="text"
                  value={card.setName}
                  disabled={busy}
                  onChange={(event) =>
                    updateCard(card.id, { setName: event.target.value })
                  }
                  placeholder="e.g. Base Set, Holo"
                  className={fieldClassName()}
                />
              </div>

              <div id={`edit_card_damage_${card.id}`}>
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
                >
                  {DAMAGE_TAGS.map((tag) => {
                    const selected = (card.damageTags ?? []).includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        disabled={busy}
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
                  htmlFor={`edit_description_${card.id}`}
                  className="mb-1 block text-sm font-bold text-ink"
                >
                  Description
                </label>
                <p className="mb-2 text-sm text-ink/70">
                  Optional notes about the damage and where it is (e.g. crease
                  on left edge, scratches on holo).
                </p>
                <textarea
                  id={`edit_description_${card.id}`}
                  rows={4}
                  value={card.description}
                  disabled={busy}
                  onChange={(event) =>
                    updateCard(card.id, { description: event.target.value })
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
                  disabled={busy || photoCount >= MAX_PHOTOS_PER_CARD}
                  onChange={(event) => {
                    const incoming = copyFileList(event.target.files).filter(
                      (file) => file.type.startsWith("image/")
                    );
                    if (incoming.length === 0) {
                      setCardFileErrors((prev) => ({
                        ...prev,
                        [card.id]: "Please choose image files only.",
                      }));
                      event.target.value = "";
                      return;
                    }
                    setCardFileErrors((prev) => {
                      const next = { ...prev };
                      delete next[card.id];
                      return next;
                    });
                    const room = MAX_PHOTOS_PER_CARD - photoCount;
                    updateCard(card.id, {
                      newFiles: [
                        ...card.newFiles,
                        ...incoming.slice(0, room).map((file) => ({
                          id: crypto.randomUUID(),
                          file,
                        })),
                      ],
                    });
                    event.target.value = "";
                  }}
                  className="sr-only"
                />
                {cardFileErrors[card.id] ? (
                  <p className="mb-2 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm font-semibold text-ink">
                    {cardFileErrors[card.id]}
                  </p>
                ) : null}
                {photoCount < MAX_PHOTOS_PER_CARD ? (
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
                ) : null}

                {card.existingImages.length > 0 ? (
                  <CardPhotoPreviewGrid
                    className="mt-3"
                    items={card.existingImages.map((image, imageIndex) => ({
                      id: String(image.id ?? image.storage_path),
                      src: thumbUrls[image.storage_path] ?? null,
                      alt: `Card photo ${imageIndex + 1}`,
                      label: `Photo ${imageIndex + 1}`,
                    }))}
                    onRemove={(itemId) => {
                      updateCard(card.id, {
                        existingImages: card.existingImages.filter(
                          (image) =>
                            String(image.id ?? image.storage_path) !== itemId
                        ),
                      });
                    }}
                    caption={`${card.existingImages.length} current photo${
                      card.existingImages.length === 1 ? "" : "s"
                    }`}
                  />
                ) : null}

                {card.newFiles.length > 0 ? (
                  <StagedCardPhotoPreviews
                    files={card.newFiles}
                    onRemove={(fileId) =>
                      updateCard(card.id, {
                        newFiles: card.newFiles.filter(
                          (file) => file.id !== fileId
                        ),
                      })
                    }
                    caption={`${card.newFiles.length} new file${
                      card.newFiles.length === 1 ? "" : "s"
                    } selected${
                      photoCount >= MAX_PHOTOS_PER_CARD
                        ? ` (max ${MAX_PHOTOS_PER_CARD})`
                        : ""
                    }`}
                  />
                ) : null}
              </div>
            </div>
          );
        })}

        <div className="space-y-2">
          <button
            type="button"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                cards: [...current.cards, newEmptyCard()],
              }))
            }
            disabled={busy || draft.cards.length >= MAX_CARDS}
            className="inline-flex items-center rounded-full border border-ink/20 bg-transparent px-4 py-2 text-sm font-semibold text-ink transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 sm:hover:border-ink/40 sm:hover:bg-ink/5"
          >
            + Add Card
          </button>
          {draft.cards.length >= MAX_CARDS ? (
            <p className="text-sm text-ink/70">
              Maximum of {MAX_CARDS} cards. For larger lots, use one card entry
              with a photo of the entire lot and a description, submit a
              separate order, or reach out.
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-bold text-ink">Priority service</h2>
          <p className="mt-1 text-sm text-ink/60">
            Optional faster handling for your whole order.
          </p>
        </div>
        <label
          className={`${optionClassName()} ${
            draft.isPriority
              ? "border-ink/35 bg-ink/[0.08] ring-1 ring-ink/20"
              : ""
          }`.trim()}
        >
          <input
            type="checkbox"
            checked={draft.isPriority}
            disabled={busy}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                isPriority: event.target.checked,
              }))
            }
            className="mt-1 h-4 w-4 shrink-0 accent-ink"
          />
          <span className="text-sm leading-relaxed text-ink/80">
            <span className="flex flex-wrap items-center gap-2 font-bold text-ink">
              <span>Prioritize my order</span>
              {draft.isPriority ? (
                <span className="rounded-full border border-ink/25 bg-ink/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink">
                  Active
                </span>
              ) : null}
            </span>
            <span className="mt-1 block text-ink/65">
              {priorityServicePricingHint(Math.max(1, completeCards.length))}
            </span>
          </span>
        </label>
      </section>

      <div className="space-y-3 border-t border-ink/10 pt-6">
        {showValidationError ? (
          <p
            className="rounded-2xl border-2 border-error bg-error/15 px-4 py-3 text-sm font-semibold text-error"
            role="alert"
          >
            Please fill out all required fields
          </p>
        ) : null}

        <Button type="submit" fullWidth disabled={busy}>
          {status === "saving" ? "Saving…" : "Save changes"}
        </Button>

        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmCancel(true)}
          className="w-full rounded-full border border-error/40 px-4 py-2 text-sm font-semibold text-error transition hover:bg-error/10 disabled:opacity-40"
        >
          Cancel order
        </button>
      </div>

      {confirmCancel ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-ink/15 bg-cream p-5 shadow-xl">
            <h3 className="font-display text-lg font-bold text-ink">
              Cancel this order?
            </h3>
            <p className="mt-2 text-sm text-ink/70">
              This can&apos;t be undone. You&apos;ll need to submit a new request
              if you change your mind.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmCancel(false)}
                className="rounded-lg border border-ink/15 px-3 py-2 text-sm font-semibold text-ink/80"
              >
                Keep order
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleCancelOrder}
                className="rounded-lg bg-error px-3 py-2 text-sm font-bold text-cream disabled:opacity-40"
              >
                {status === "canceling" ? "Canceling…" : "Yes, cancel"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}

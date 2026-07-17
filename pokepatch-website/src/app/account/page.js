"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { CONTACT_TYPES } from "@/lib/contacts";
import SectionHeading from "@/components/SectionHeading";

function fieldClassName() {
  return "w-full rounded-xl border-2 border-ink/15 bg-cream px-4 py-2 text-ink outline-none focus:border-blush";
}

function emptyContactValues() {
  return CONTACT_TYPES.reduce((acc, type) => ({ ...acc, [type.value]: "" }), {});
}

export default function AccountPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [fullName, setFullName] = useState("");
  const [contactValues, setContactValues] = useState(() => emptyContactValues());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login?redirect=/account");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user || !supabase) return;
    setLoading(true);
    supabase
      .from("customer_profiles")
      .select("full_name, contacts")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (loadError) throw loadError;
        if (data) {
          setFullName(data.full_name ?? "");
          if (Array.isArray(data.contacts)) {
            const values = emptyContactValues();
            for (const c of data.contacts) {
              if (c && c.contact_type in values) {
                values[c.contact_type] = c.value ?? "";
              }
            }
            setContactValues(values);
          }
        }
      })
      .catch((err) => {
        setError(err.message || "Failed to load your profile");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [user]);

  function updateContactValue(type, value) {
    setContactValues((prev) => ({ ...prev, [type]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!user || !supabase) return;

    setSaving(true);
    setError("");
    setSuccess("");

    const cleanedContacts = CONTACT_TYPES.filter(
      (type) => (contactValues[type.value] ?? "").trim() !== ""
    ).map((type) => ({
      contact_type: type.value,
      value: contactValues[type.value].trim(),
    }));

    try {
      const { error: saveError } = await supabase
        .from("customer_profiles")
        .upsert(
          {
            user_id: user.id,
            full_name: fullName.trim() || null,
            contacts: cleanedContacts,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (saveError) throw saveError;
      setSuccess("Your profile has been saved.");
    } catch (err) {
      setError(err.message || "Failed to save your profile");
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="font-secondary text-ink/70">Loading...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="animate-fade-up">
        <SectionHeading subtitle="Save your details so you don't have to re-enter them">
          Account
        </SectionHeading>
      </div>

      <div className="pixel-border animate-fade-up space-y-6 rounded-2xl bg-cream/60 p-6 [animation-delay:150ms]">
        {error && (
          <p className="rounded-2xl border-2 border-berry bg-berry/20 px-4 py-3 text-sm font-semibold text-ink">
            {error}
          </p>
        )}

        {success && (
          <p className="rounded-2xl border-2 border-mint bg-mint/40 px-4 py-3 text-sm font-semibold text-ink">
            {success}
          </p>
        )}

        {loading ? (
          <p className="py-8 text-center font-secondary text-ink/70">
            Loading your profile...
          </p>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <label className="mb-1 block text-sm font-bold text-ink">
                Email
              </label>
              <input
                type="email"
                value={user.email ?? ""}
                disabled
                readOnly
                className={`${fieldClassName()} opacity-70`}
              />
              <p className="mt-1 font-secondary text-xs text-ink/60">
                Your account email can&apos;t be changed here.
              </p>
            </div>

            <div>
              <label
                htmlFor="full_name"
                className="mb-1 block text-sm font-bold text-ink"
              >
                Name
              </label>
              <input
                id="full_name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your preferred name"
                className={fieldClassName()}
              />
            </div>

            <div className="space-y-3">
              <p className="text-sm font-bold text-ink">Contact methods</p>
              <p className="font-secondary text-sm text-ink/70">
                Save the ways we can reach you. We&apos;ll pre-fill these on the
                quote form.
              </p>
              {CONTACT_TYPES.map((type) => (
                <div key={type.value}>
                  <label
                    htmlFor={`contact_${type.value}`}
                    className="mb-1 block font-secondary text-xs text-ink/70"
                  >
                    {type.label}
                  </label>
                  <input
                    id={`contact_${type.value}`}
                    type="text"
                    value={contactValues[type.value] ?? ""}
                    onChange={(e) =>
                      updateContactValue(type.value, e.target.value)
                    }
                    placeholder={
                      type.value === "phone" ? "(555) 555-5555" : "@yourusername"
                    }
                    className={fieldClassName()}
                  />
                </div>
              ))}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-full bg-lavender px-6 py-3 font-bold text-night shadow-cozy transition-all duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-0.5 active:shadow-cozy-sm sm:hover:-translate-y-1 sm:hover:bg-lavender/80 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)]"
            >
              {saving ? "Saving..." : "Save profile"}
            </button>
          </form>
        )}

        <div className="flex justify-between border-t border-ink/10 pt-4 text-center">
          <Link
            href="/my-orders"
            className="font-secondary text-sm text-ink/70 hover:text-ink hover:underline"
          >
            My orders
          </Link>
          <Link
            href="/"
            className="font-secondary text-sm text-ink/70 hover:text-ink hover:underline"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

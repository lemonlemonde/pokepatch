"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { supabase } from "@/lib/supabaseClient";
import { CONTACT_TYPES } from "@/lib/contacts";
import LoadingSpinner from "@/components/LoadingSpinner";
import SectionHeading from "@/components/SectionHeading";

function fieldClassName() {
  return "w-full rounded-xl border-2 border-ink/15 bg-cream px-4 py-2 text-ink outline-none focus:border-blush disabled:cursor-not-allowed disabled:opacity-60";
}

function emptyContactValues() {
  return CONTACT_TYPES.reduce((acc, type) => ({ ...acc, [type.value]: "" }), {});
}

export default function AccountPage() {
  const router = useRouter();
  const customerAuthEnabled = isCustomerAuthEnabled();
  const { user, loading: authLoading, signOut } = useAuth();

  const [fullName, setFullName] = useState("");
  const [contactValues, setContactValues] = useState(() => emptyContactValues());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!customerAuthEnabled) {
      router.replace("/");
      return;
    }
    if (!authLoading && !user) {
      router.push("/login?redirect=/account");
    }
  }, [customerAuthEnabled, user, authLoading, router]);

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

  useEffect(() => {
    if (!success) return;
    const timeout = setTimeout(() => setSuccess(""), 2500);
    return () => clearTimeout(timeout);
  }, [success]);

  function updateContactValue(type, value) {
    setContactValues((prev) => ({ ...prev, [type]: value }));
  }

  function handleEdit() {
    setError("");
    setSuccess("");
    setEditing(true);
  }

  async function handleSignOut() {
    try {
      await signOut();
      router.push("/");
    } catch {
      setError("Failed to sign out");
    }
  }

  async function handleSave(e) {
    if (e) e.preventDefault();
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
      setEditing(false);
    } catch (err) {
      setError(err.message || "Failed to save your profile");
    } finally {
      setSaving(false);
    }
  }

  if (!customerAuthEnabled || authLoading || !user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LoadingSpinner />
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

      <div className="pixel-border animate-fade-up relative space-y-6 rounded-2xl bg-cream/60 p-6 [animation-delay:150ms]">
        {!loading && (
          <button
            type="button"
            onClick={editing ? () => handleSave() : handleEdit}
            disabled={editing && saving}
            className="absolute right-6 top-6 z-10 rounded-full border-2 border-lavender bg-lavender px-3 py-1 text-xs font-bold text-night transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 sm:hover:bg-lavender/80"
          >
            {editing ? (saving ? "Saving..." : "Save") : "Edit"}
          </button>
        )}
        {error && (
          <p className="rounded-2xl border-2 border-error bg-error/15 px-4 py-3 text-sm font-semibold text-ink">
            {error}
          </p>
        )}

        {loading ? (
          <LoadingSpinner label="Loading your profile…" />
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
              <p className="mt-1 text-xs text-ink/60">
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
                disabled={!editing}
                className={fieldClassName()}
              />
            </div>

            <div className="space-y-3">
              <p className="text-sm font-bold text-ink">Contact methods</p>
              {CONTACT_TYPES.map((type) => (
                <div key={type.value}>
                  <label
                    htmlFor={`contact_${type.value}`}
                    className="mb-1 block text-xs text-ink/70"
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
                    disabled={!editing}
                    className={fieldClassName()}
                  />
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="w-full rounded-full border-2 border-berry px-6 py-3 font-bold text-berry transition-colors duration-150 sm:hover:bg-berry sm:hover:text-cream"
            >
              Sign out
            </button>
          </form>
        )}
      </div>

      {success && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="animate-fade-up flex items-center gap-2 rounded-full border-2 border-mint bg-mint px-5 py-2.5 text-sm font-bold text-night shadow-cozy">
            <span aria-hidden="true">✓</span>
            {success}
          </div>
        </div>
      )}
    </div>
  );
}

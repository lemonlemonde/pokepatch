"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { isCustomerAuthEnabled } from "@/lib/customerAuth";
import { supabase } from "@/lib/supabaseClient";
import { CONTACT_TYPES } from "@/lib/contacts";
import LoadingSpinner from "@/components/LoadingSpinner";
import SectionHeading from "@/components/SectionHeading";
import Button from "@/components/Button";
import { fieldClassName } from "@/lib/formStyles";

const MIN_PASSWORD_LENGTH = 6;

function emptyContactValues() {
  return CONTACT_TYPES.reduce((acc, type) => ({ ...acc, [type.value]: "" }), {});
}

export default function AccountPage() {
  const router = useRouter();
  const customerAuthEnabled = isCustomerAuthEnabled();
  const { user, loading: authLoading, signOut, updatePassword } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contactValues, setContactValues] = useState(() => emptyContactValues());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordFieldErrors, setPasswordFieldErrors] = useState({});

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
    if (!user || !supabase) return undefined;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      setLoading(true);
      supabase
        .from("customer_profiles")
        .select("first_name, last_name, contacts")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data, error: loadError }) => {
          if (cancelled) return;
          if (loadError) throw loadError;
          if (data) {
            setFirstName(data.first_name ?? "");
            setLastName(data.last_name ?? "");
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
          if (!cancelled) {
            setError(err.message || "Failed to load your profile");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [user]);

  useEffect(() => {
    if (!success) return;
    const timeout = setTimeout(() => setSuccess(""), 2500);
    return () => clearTimeout(timeout);
  }, [success]);

  useEffect(() => {
    if (!passwordSuccess) return;
    const timeout = setTimeout(() => setPasswordSuccess(""), 2500);
    return () => clearTimeout(timeout);
  }, [passwordSuccess]);

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

    if (!firstName.trim() || !lastName.trim()) {
      setError("First and last name are required.");
      return;
    }

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
            first_name: firstName.trim() || null,
            last_name: lastName.trim() || null,
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

  async function handlePasswordSave(e) {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    const errors = {};
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      errors.newPassword = true;
    }
    if (newPassword !== confirmPassword) {
      errors.confirmPassword = true;
    }
    setPasswordFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setPasswordError("Please check the password fields.");
      return;
    }

    setPasswordSaving(true);
    try {
      await updatePassword(newPassword);
      setPasswordSuccess("Your password has been updated.");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordFieldErrors({});
    } catch (err) {
      setPasswordError(err.message || "Failed to update password.");
    } finally {
      setPasswordSaving(false);
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
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10 sm:px-6 sm:py-16">
      <div className="animate-fade-up">
        <SectionHeading
          note="Account"
          subtitle="Saved so you don't have to re-enter them on every quote."
        >
          Your details
        </SectionHeading>
      </div>

      <div className="marketing-panel animate-fade-up relative space-y-6 p-6 [animation-delay:150ms]">
        {!loading && (
          <button
            type="button"
            onClick={editing ? () => handleSave() : handleEdit}
            disabled={editing && saving}
            className="absolute right-6 top-6 z-10 rounded-full border border-lavender/40 bg-lavender px-3 py-1 text-xs font-medium text-night transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 sm:hover:bg-lavender/80"
          >
            {editing ? (saving ? "Saving..." : "Save") : "Edit"}
          </button>
        )}
        {error && (
          <p className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-ink">
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
                This is your login email and can&apos;t be changed here. Need a
                different address? Email{" "}
                <a
                  href="mailto:pokepatch.cards@gmail.com"
                  className="font-semibold text-ink hover:underline"
                >
                  pokepatch.cards@gmail.com
                </a>
                .
              </p>
            </div>

            <div>
              <label
                htmlFor="first_name"
                className="mb-1 block text-sm font-bold text-ink"
              >
                First name <span className="text-error">*</span>
              </label>
              <input
                id="first_name"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                disabled={!editing}
                className={fieldClassName()}
              />
            </div>

            <div>
              <label
                htmlFor="last_name"
                className="mb-1 block text-sm font-bold text-ink"
              >
                Last name <span className="text-error">*</span>
              </label>
              <input
                id="last_name"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
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
              className="w-full rounded-full border border-ink/25 px-6 py-3 font-medium text-ink transition-colors duration-150 sm:hover:bg-ink sm:hover:text-cream"
            >
              Sign out
            </button>
          </form>
        )}
      </div>

      <div className="marketing-panel animate-fade-up space-y-4 p-6 [animation-delay:200ms]">
        <h2 className="text-lg font-bold text-ink">Change password</h2>
        <p className="text-sm text-ink/60">
          Set a new password for this account. You&apos;ll stay signed in.
        </p>

        {passwordError ? (
          <p className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-ink">
            {passwordError}
          </p>
        ) : null}

        <form onSubmit={handlePasswordSave} className="space-y-4">
          <div>
            <label
              htmlFor="new_password"
              className="mb-1 block text-sm font-bold text-ink"
            >
              New password <span className="text-error">*</span>
            </label>
            <input
              id="new_password"
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setPasswordFieldErrors((prev) => ({
                  ...prev,
                  newPassword: false,
                }));
              }}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              className={fieldClassName(passwordFieldErrors.newPassword)}
              disabled={passwordSaving}
              required
            />
            {passwordFieldErrors.newPassword ? (
              <p className="mt-1 text-sm text-error">
                Password must be at least {MIN_PASSWORD_LENGTH} characters
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="confirm_new_password"
              className="mb-1 block text-sm font-bold text-ink"
            >
              Confirm new password <span className="text-error">*</span>
            </label>
            <input
              id="confirm_new_password"
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setPasswordFieldErrors((prev) => ({
                  ...prev,
                  confirmPassword: false,
                }));
              }}
              placeholder="Confirm your new password"
              className={fieldClassName(passwordFieldErrors.confirmPassword)}
              disabled={passwordSaving}
              required
            />
            {passwordFieldErrors.confirmPassword ? (
              <p className="mt-1 text-sm text-error">Passwords do not match</p>
            ) : null}
          </div>

          <Button type="submit" fullWidth disabled={passwordSaving}>
            {passwordSaving ? (
              <span className="inline-block animate-soft-bounce">
                Updating password...
              </span>
            ) : (
              "Update password"
            )}
          </Button>
        </form>
      </div>

      {(success || passwordSuccess) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="animate-fade-up flex items-center gap-2 rounded-full border border-mint/40 bg-mint px-5 py-2.5 text-sm font-medium text-night">
            <span aria-hidden="true">✓</span>
            {success || passwordSuccess}
          </div>
        </div>
      )}
    </div>
  );
}

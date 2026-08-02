"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  getAuthEmailRedirectTo,
  isCustomerAuthEnabled,
} from "@/lib/customerAuth";
import { supabase } from "@/lib/supabaseClient";

const AuthContext = createContext({});

const PENDING_PROFILE_KEY = "pokepatch_pending_profile";

const authDisabledError = () => {
  throw new Error("Customer auth is disabled");
};

// If a visitor filled out the quote form and then created an account, save the
// name + contacts they entered to their profile. Only applies when the snapshot
// email matches the account and the user doesn't already have a profile.
async function savePendingProfile(sessionUser) {
  if (!supabase || !sessionUser || typeof window === "undefined") return;

  let pending;
  try {
    const raw = window.localStorage.getItem(PENDING_PROFILE_KEY);
    if (!raw) return;
    pending = JSON.parse(raw);
  } catch {
    return;
  }

  try {
    const snapshotEmail = pending?.email?.toLowerCase();
    if (
      snapshotEmail &&
      sessionUser.email &&
      snapshotEmail !== sessionUser.email.toLowerCase()
    ) {
      return;
    }

    const contacts = Array.isArray(pending?.contacts) ? pending.contacts : [];
    if (!pending?.first_name && !pending?.last_name && contacts.length === 0) {
      window.localStorage.removeItem(PENDING_PROFILE_KEY);
      return;
    }

    const { data: existing } = await supabase
      .from("customer_profiles")
      .select("user_id")
      .eq("user_id", sessionUser.id)
      .maybeSingle();

    if (!existing) {
      await supabase.from("customer_profiles").upsert(
        {
          user_id: sessionUser.id,
          first_name: pending.first_name || null,
          last_name: pending.last_name || null,
          contacts,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    }

    window.localStorage.removeItem(PENDING_PROFILE_KEY);
  } catch (err) {
    console.error("Failed to save pending profile:", err);
  }
}

// Backfill first/last name on the profile from the most recent order placed
// under this email, when the profile doesn't already have a name. Covers
// account creation outside the same browser session as the quote form (the
// pending-profile localStorage snapshot above only covers same-session).
async function syncProfileNameFromOrders() {
  if (!supabase) return;
  try {
    const { error } = await supabase.rpc("sync_profile_name_from_latest_order");
    if (error) {
      console.error("Failed to sync profile name from orders:", error);
    }
  } catch (err) {
    console.error("Failed to sync profile name from orders:", err);
  }
}

// Links any unclaimed orders (matched by email) to the current account.
async function claimOrders() {
  if (!supabase) return;
  try {
    const { error } = await supabase.rpc("claim_my_orders");
    if (error) {
      console.error("Failed to claim orders:", error);
    }
  } catch (err) {
    console.error("Failed to claim orders:", err);
  }
}

// Run in sequence (not raced) since both may create the profile row —
// letting the same-session localStorage snapshot (with contacts) win first.
async function syncProfileOnSignIn(sessionUser) {
  await savePendingProfile(sessionUser);
  await syncProfileNameFromOrders();
}

export function AuthProvider({ children }) {
  const enabled = isCustomerAuthEnabled();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled || !supabase) {
      setLoading(false);
      return;
    }

    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user) syncProfileOnSignIn(session.user);
    });

    // Listen for auth changes. Claim orders on any sign-in (including the
    // email-confirmation redirect, which never goes through signIn()).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        syncProfileOnSignIn(session.user);
        if (event === "SIGNED_IN") claimOrders();
      }
    });

    return () => subscription.unsubscribe();
  }, [enabled]);

  const signUp = async (email, password, firstName, lastName) => {
    if (!enabled) authDisabledError();
    if (!supabase) throw new Error("Supabase not configured");

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: getAuthEmailRedirectTo("/my-orders"),
        // Stored as JWT user_metadata immediately, even before email
        // confirmation — sync_profile_name_from_latest_order reads it from
        // there on first sign-in to fill in customer_profiles.
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        },
      },
    });

    if (error) throw error;

    // Claim orders now when signup returns a session (email confirmation off).
    // When confirmation is on, orders are claimed on the SIGNED_IN event after
    // the user confirms via email.
    if (data.session) await claimOrders();

    return data;
  };

  const signIn = async (email, password) => {
    if (!enabled) authDisabledError();
    if (!supabase) throw new Error("Supabase not configured");

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    if (data.session) await claimOrders();

    return data;
  };

  const signOut = async () => {
    if (!enabled) return;
    if (!supabase) throw new Error("Supabase not configured");
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const value = {
    user: enabled ? user : null,
    loading: enabled ? loading : false,
    signUp,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const AuthContext = createContext({});

const PENDING_PROFILE_KEY = "pokepatch_pending_profile";

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
    if (!pending?.full_name && contacts.length === 0) {
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
          full_name: pending.full_name || null,
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

// Links any unclaimed orders (matched by email) to the current account.
async function claimOrders() {
  if (!supabase) return;
  try {
    await supabase.rpc("claim_my_orders");
  } catch (err) {
    console.error("Failed to claim orders:", err);
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user) savePendingProfile(session.user);
    });

    // Listen for auth changes. Claim orders on any sign-in (including the
    // email-confirmation redirect, which never goes through signIn()).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        savePendingProfile(session.user);
        if (event === "SIGNED_IN") claimOrders();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email, password) => {
    if (!supabase) throw new Error("Supabase not configured");
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) throw error;

    // Claim orders now when signup returns a session (email confirmation off).
    if (data.session) await claimOrders();

    return data;
  };

  const signIn = async (email, password) => {
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
    if (!supabase) throw new Error("Supabase not configured");
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const value = {
    user,
    loading,
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

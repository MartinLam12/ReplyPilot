"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export interface UserProfile {
  name: string;
  email: string;
}

interface UserContextValue {
  user: UserProfile;
  authUser: User | null;
  isLoggedIn: boolean;
  initials: string;
  loading: boolean;
  signOut: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const supabase = (() => {
    try { return createClient(); } catch { return null; }
  })();

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    supabase.auth.getUser().then(({ data: { user } }: { data: { user: User | null } }) => {
      setAuthUser(user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: { user: User } | null) => {
      setAuthUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = useCallback(async () => {
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // Proceed with local navigation even if the server-side revocation
        // call fails. The middleware will catch any lingering session on the
        // next protected request.
      }
    }
    window.location.href = "/";
  }, [supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  const profile: UserProfile = {
    name: authUser?.user_metadata?.name || "",
    email: authUser?.email || "",
  };

  const initials = profile.name
    ? profile.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : profile.email ? profile.email[0].toUpperCase() : "?";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <UserContext.Provider value={{ user: profile, authUser, isLoggedIn: !!authUser, initials, loading, signOut }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}

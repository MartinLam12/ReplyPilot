"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

export interface UserProfile {
  name: string;
  email: string;
  businessName: string;
}

const DEFAULT_PROFILE: UserProfile = { name: "", email: "", businessName: "" };
const PROFILE_KEY = "clearpath_user_profile";

function loadProfile(): UserProfile {
  try {
    const stored = localStorage.getItem(PROFILE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return DEFAULT_PROFILE;
}

interface UserContextValue {
  user: UserProfile;
  setUser: (profile: UserProfile) => void;
  updateUser: (partial: Partial<UserProfile>) => void;
  isLoggedIn: boolean;
  initials: string;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfileState] = useState<UserProfile>(() => {
    if (typeof window === "undefined") return DEFAULT_PROFILE;
    return loadProfile();
  });

  const setUser = useCallback((p: UserProfile) => {
    setProfileState(p);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  }, []);

  const updateUser = useCallback((partial: Partial<UserProfile>) => {
    setProfileState((prev) => {
      const next = { ...prev, ...partial };
      localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const initials = profile.name
    ? profile.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "";

  return (
    <UserContext.Provider value={{ user: profile, setUser, updateUser, isLoggedIn: true, initials }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}

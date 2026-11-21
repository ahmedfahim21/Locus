"use client";

import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { api, supabase, type Me, type Route } from "./api";

/** undefined while Supabase restores the session, null when signed out. */
export function useAuthSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error("[auth] getSession failed", error);
      setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

type Loaded<T> = { data: T | null; error: string | null; loading: boolean; reload: () => Promise<void> };

function useLoad<T>(path: string | null): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);

  const reload = useCallback(async () => {
    if (path === null) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (err) {
      console.error(`[api] GET ${path} failed`, err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}

export const useMe = () => useLoad<Me>("/me");

/** The rider's route; only requested once the recipient has a home. */
export const useRoute = (hasHome: boolean, version: string) => useLoad<Route>(hasHome ? `/me/route?v=${encodeURIComponent(version)}` : null);

"use client";

import { PlayCircle, SignOut } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/api";
import { AppearanceSwitch } from "./AppearanceSwitch";

/**
 * The signed-in user's menu, top right on every signed-in page: who you are,
 * appearance, the demo call, and sign out.
 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<{ email: string | null; name: string | null } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error("[auth] getSession failed", error);
      const u = data.session?.user;
      setUser(u ? { email: u.email ?? null, name: (u.user_metadata?.full_name as string | undefined) ?? null } : null);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;
  const initial = (user.name ?? user.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div className="account" ref={root}>
      <button
        type="button"
        className="avatar pressable"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account and settings"
        onClick={() => setOpen((v) => !v)}
      >
        {initial}
      </button>
      {open && (
        <div className="account-menu rise" role="menu">
          <div className="account-who">
            <span className="avatar" aria-hidden="true">{initial}</span>
            <div className="cell-main">
              {user.name && <span>{user.name}</span>}
              <span className="cell-sub">{user.email}</span>
            </div>
          </div>
          <div className="account-row">
            <span>Appearance</span>
            <AppearanceSwitch />
          </div>
          <Link className="account-item" href="/replay" role="menuitem" onClick={() => setOpen(false)}>
            <PlayCircle size={18} />
            Hear a demo call
          </Link>
          <button className="account-item danger" type="button" role="menuitem" onClick={() => void supabase.auth.signOut().then(() => window.location.assign("/"))}>
            <SignOut size={18} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

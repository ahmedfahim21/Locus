"use client";

import type { Session } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { useAuthSession } from "../lib/hooks";
import { Landing } from "./Landing";

/** Shows the signed-out landing (with sign-in) until there's a session. */
export function RequireAuth({ children }: { children: (session: Session) => ReactNode }) {
  const session = useAuthSession();
  if (session === undefined) {
    return (
      <main className="page" aria-busy="true">
        <div className="skeleton" style={{ width: 120, height: 28 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </main>
    );
  }
  if (!session) return <Landing />;
  return <>{children(session)}</>;
}

"use client";

import { Suspense } from "react";
import { RequireAuth } from "../../components/RequireAuth";
import { Setup } from "../../components/setup/Setup";

export default function SetupPage() {
  return (
    <RequireAuth>
      {() => (
        <Suspense fallback={<main className="page"><div className="skeleton" style={{ height: 360 }} /></main>}>
          <Setup />
        </Suspense>
      )}
    </RequireAuth>
  );
}

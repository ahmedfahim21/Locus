"use client";

import { Home } from "../components/Home";
import { RequireAuth } from "../components/RequireAuth";

export default function Page() {
  return <RequireAuth>{() => <Home />}</RequireAuth>;
}

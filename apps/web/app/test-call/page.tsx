"use client";

import { RequireAuth } from "../../components/RequireAuth";
import { TestCall } from "../../components/TestCall";

export default function TestCallPage() {
  return <RequireAuth>{() => <TestCall />}</RequireAuth>;
}

"use client";

import { use } from "react";
import { CallView } from "../../../components/CallView";
import { RequireAuth } from "../../../components/RequireAuth";

export default function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <RequireAuth>{() => <CallView id={id} />}</RequireAuth>;
}

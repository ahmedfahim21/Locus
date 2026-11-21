import { CaretLeft } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";

export function TopBar({ back, children }: { back?: { href: string; label: string }; children?: ReactNode }) {
  return (
    <header className="topbar">
      {back ? (
        <Link href={back.href} className="btn compact" aria-label={back.label}>
          <CaretLeft size={16} />
          {back.label}
        </Link>
      ) : (
        <Link href="/" className="wordmark">
          <span className="wordmark-dot" aria-hidden="true" />
          Locus
        </Link>
      )}
      {children && <div className="row">{children}</div>}
    </header>
  );
}

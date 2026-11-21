import { CaretLeft } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./Logo";

export function TopBar({ back, children }: { back?: { href: string; label: string }; children?: ReactNode }) {
  return (
    <header className="topbar">
      {back ? (
        <Link href={back.href} className="btn compact" aria-label={back.label}>
          <CaretLeft size={16} />
          {back.label}
        </Link>
      ) : (
        <Link href="/" className="wordmark" aria-label="Locus home">
          <Logo size={28} />
        </Link>
      )}
      {children && <div className="row">{children}</div>}
    </header>
  );
}

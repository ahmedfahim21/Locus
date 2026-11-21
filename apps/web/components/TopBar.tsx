import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";

export function TopBar({ back, children }: { back?: { href: string; label: string }; children?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="row" style={{ gap: 12 }}>
        {back && (
          <Link href={back.href} className="btn ghost icon compact" aria-label={back.label} style={{ width: 40 }}>
            <ArrowLeft size={18} />
          </Link>
        )}
        <Link href="/" className="wordmark">
          Locus<span className="deva">लोकस</span>
        </Link>
      </div>
      {children && <div className="row">{children}</div>}
    </header>
  );
}

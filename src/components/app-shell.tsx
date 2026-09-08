import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ children, navigation = true }: { children: ReactNode; navigation?: boolean }) {
  return (
    <main id="main-content" className="shell">
      <header className="brand-bar" aria-label="PointView">
        <Link className="brand-home" href="/" aria-label="PointView home">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span className="brand-name">PointView</span>
        </Link>
        {navigation ? (
          <nav className="primary-nav" aria-label="Primary navigation">
            <Link href="/feedback">My feedback</Link>
          </nav>
        ) : null}
        <span className="environment-badge">Private</span>
      </header>
      {children}
    </main>
  );
}

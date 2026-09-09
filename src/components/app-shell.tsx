import Link from "next/link";
import type { ReactNode } from "react";

type AdministrationSection = "providers" | "sources" | "accounts" | "operations";
type AdministrationRole = "ADMIN" | "OWNER";

const administrationLinks: Array<{
  href: string;
  label: string;
  section: AdministrationSection;
  ownerOnly?: boolean;
}> = [
  { href: "/admin/settings", label: "AI providers", section: "providers", ownerOnly: true },
  { href: "/admin/source-apps", label: "Source apps", section: "sources", ownerOnly: true },
  { href: "/admin/accounts", label: "Accounts", section: "accounts" },
  { href: "/admin/operations", label: "Operations", section: "operations" },
];

export function AppShell({
  children,
  navigation = true,
  administration,
}: {
  children: ReactNode;
  navigation?: boolean;
  administration?: { current: AdministrationSection; role: AdministrationRole };
}) {
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
      {administration ? (
        <nav className="administration-nav" aria-label="Administration">
          {administrationLinks
            .filter((link) => !link.ownerOnly || administration.role === "OWNER")
            .map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={link.section === administration.current ? "page" : undefined}
              >
                {link.label}
              </Link>
            ))}
        </nav>
      ) : null}
      {children}
    </main>
  );
}

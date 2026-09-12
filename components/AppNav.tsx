"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { REVIEW_QUEUE } from "@/lib/fixtures";

const TABS = [
  { href: "/day", label: "DAY" },
  { href: "/day/merged", label: "DAY · MERGED" },
  { href: "/workout", label: "WORKOUT" },
  { href: "/trends", label: "TRENDS" },
  { href: "/components", label: "COMPONENTS" },
] as const;

/** Desktop chrome. On the phone the composer is the navigation. */
export function AppNav() {
  const path = usePathname();
  return (
    <div
      style={{
        height: 48,
        borderBottom: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        background: "var(--bg-bar)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", gap: 22, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>tricky</span>
        {TABS.map((t) => {
          const active = path === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: active ? "var(--text-1)" : "var(--text-3)",
                borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                paddingBottom: 3,
                textDecoration: "none",
              }}
            >
              {t.label}
            </Link>
          );
        })}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" }}>
          REVIEW · {REVIEW_QUEUE.count}
        </span>
      </div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" }}>
        kg · kcal
      </span>
    </div>
  );
}

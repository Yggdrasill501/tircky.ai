"use client";

import type { ReactNode } from "react";
import { AppNav } from "./AppNav";

/**
 * Two jobs, two devices. The phone layout is the logging surface and stays
 * dark; the desktop layout is the review surface and switches to the light
 * theme, which is where the design puts the denser tables.
 */
export function Shell({
  phone,
  desktop,
  breakpoint = 1100,
}: {
  phone: ReactNode;
  desktop: ReactNode;
  breakpoint?: number;
}) {
  return (
    <>
      <style>{`
        .tk-phone { display: flex; }
        .tk-desktop { display: none; }
        @media (min-width: ${breakpoint}px) {
          .tk-phone { display: none; }
          .tk-desktop { display: flex; }
        }
      `}</style>

      <div
        className="tk-phone"
        data-theme="dark"
        style={{
          flexDirection: "column",
          minHeight: "100dvh",
          background: "var(--bg-screen)",
        }}
      >
        {phone}
      </div>

      <div
        className="tk-desktop"
        data-theme="light"
        style={{
          flexDirection: "column",
          height: "100dvh",
          background: "var(--bg-canvas)",
          color: "var(--text-1)",
        }}
      >
        <AppNav />
        {desktop}
      </div>
    </>
  );
}

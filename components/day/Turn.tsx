"use client";

import type { ReactNode } from "react";
import { fmt, fmtTight } from "@/lib/measure";
import { macro, type FoodEntry } from "@/lib/nutrition";
import { ProvenanceMark } from "@/components/primitives/ProvenanceMark";

/**
 * One utterance and everything it resolved to, tied together by a rule down the
 * left. The rule is what makes the merged timeline readable: it shows that
 * these rows are the consequence of that sentence, without repeating it.
 */
export function Turn({
  said,
  photo,
  note,
  children,
}: {
  said?: string;
  photo?: boolean;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {said && (
        <span
          style={{
            alignSelf: "flex-end",
            maxWidth: "78%",
            padding: "9px 13px",
            borderRadius: "15px 15px 3px 15px",
            background: "var(--bg-input)",
            color: "var(--text-1)",
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          {said}
        </span>
      )}

      {photo && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            alignSelf: "flex-end",
            padding: "7px 12px",
            borderRadius: 15,
            background: "var(--bg-input)",
          }}
        >
          <span className="num" style={{ fontSize: 10, color: "var(--text-3)" }}>
            PHOTO
          </span>
          <span
            style={{
              width: 46,
              height: 34,
              borderRadius: 4,
              background:
                "repeating-linear-gradient(135deg, var(--line-frame) 0 4px, var(--bg-card) 4px 8px)",
            }}
          />
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          borderLeft: "2px solid var(--line)",
          paddingLeft: 12,
          gap: 2,
        }}
      >
        {children}
        {note && (
          <span className="num" style={{ fontSize: 10, color: "var(--text-4)", padding: "4px 0" }}>
            {note}
          </span>
        )}
      </div>
    </div>
  );
}

export function TurnRow({ entry, showTime }: { entry: FoodEntry; showTime?: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr auto",
        gap: 8,
        alignItems: "baseline",
        padding: "5px 0",
      }}
    >
      <span className="num" style={{ fontSize: 11, color: "var(--text-4)" }}>
        {showTime ? entry.time : ""}
      </span>
      <span style={{ display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 }}>
        <span style={{ fontSize: 14, color: "var(--text-1)" }}>{entry.name}</span>
        <ProvenanceMark of={entry.provenance} />
      </span>
      <span className="num" style={{ fontSize: 12, color: "var(--text-1)" }}>
        {fmtTight(entry.grams, "g")} · {fmt(macro(entry, "kcal"))}
      </span>
    </div>
  );
}

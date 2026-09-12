"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmt, sum } from "@/lib/measure";
import { macro, type FoodEntry } from "@/lib/nutrition";
import { CHAT_RESOLUTION_ORDER, CHAT_UTTERANCE } from "@/lib/fixtures";

/**
 * The signature interaction: say something, watch structured rows appear.
 *
 * Items stream in one at a time because that is what the agent actually does —
 * it resolves each against the food database in turn (specs/agent, § Turn
 * Lifecycle). Showing the work is both faster-feeling than a spinner and more
 * honest about where the numbers come from.
 */
export function ChatPane({
  entries,
  onReplayRef,
}: {
  entries: readonly FoodEntry[];
  onReplayRef?: (replay: () => void) => void;
}) {
  const resolved = CHAT_RESOLUTION_ORDER.map((id) => entries.find((e) => e.id === id)).filter(
    (e): e is FoodEntry => e != null,
  );

  const [shown, setShown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const replay = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    setShown(0);
    timer.current = setInterval(() => {
      setShown((n) => {
        const next = n + 1;
        if (next >= resolved.length && timer.current) clearInterval(timer.current);
        return Math.min(next, resolved.length);
      });
    }, 650);
  }, [resolved.length]);

  useEffect(() => {
    const start = setTimeout(replay, 700);
    return () => {
      clearTimeout(start);
      if (timer.current) clearInterval(timer.current);
    };
  }, [replay]);

  useEffect(() => onReplayRef?.(replay), [onReplayRef, replay]);

  const done = shown >= resolved.length;
  const visible = resolved.slice(0, shown);
  const cardKcal = fmt(sum(visible.map((e) => macro(e, "kcal"))));

  const toolLine =
    shown === 0
      ? "searching foods…"
      : !done
        ? `resolving item ${shown + 1} of ${resolved.length}…`
        : `logged ${resolved.length} items to 12:40`;

  return (
    <div
      style={{
        flex: 1,
        padding: "18px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        justifyContent: "flex-end",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          alignSelf: "flex-end",
          maxWidth: "78%",
          padding: "10px 14px",
          borderRadius: "16px 16px 4px 16px",
          background: "var(--bg-input)",
          color: "var(--text-1)",
          fontSize: 14,
          lineHeight: 1.45,
        }}
      >
        {CHAT_UTTERANCE}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          className="num"
          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-3)" }}
        >
          <span
            className={done ? undefined : "tk-blink"}
            style={{ width: 5, height: 5, borderRadius: 3, background: "var(--accent)" }}
          />
          <span>{toolLine}</span>
        </div>

        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-card)",
            background: "var(--bg-card)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--line-hair)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>
              Lunch · 12:40
            </span>
            <span className="num" style={{ fontSize: 11, color: "var(--text-2)" }}>
              {done ? `${cardKcal} kcal` : "…"}
            </span>
          </div>

          {visible.map((e) => (
            <div
              key={e.id}
              className="tk-in"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 10,
                alignItems: "baseline",
                padding: "9px 14px",
                borderBottom: "1px solid var(--line-hair)",
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, color: "var(--text-1)" }}>{e.name}</span>
                <span
                  className="num"
                  style={{ fontSize: 10, color: "var(--text-4)" }}
                >
                  {e.resolvedFrom}
                </span>
              </span>
              <span
                className="num"
                style={{ display: "flex", gap: 12, alignItems: "baseline", fontSize: 12 }}
              >
                <span style={{ color: "var(--text-1)" }}>{fmt(e.grams, "g")}</span>
                <span style={{ minWidth: 38, textAlign: "right", color: "var(--text-1)" }}>
                  {fmt(macro(e, "kcal"))}
                </span>
              </span>
            </div>
          ))}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "9px 14px",
            }}
          >
            <span className="num" style={{ fontSize: 10, color: "var(--text-4)" }}>
              {done ? "tap any row to correct" : "resolving"}
            </span>
            <button
              type="button"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--accent)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              UNDO MEAL
            </button>
          </div>
        </div>

        {done && (
          <div style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.5 }}>
            Rice was ambiguous — I used cooked jasmine at 130 kcal/100 g. Tap the row if it was raw
            weight.
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { RoundButton } from "@/components/primitives/PhoneFrame";

/**
 * 1c — the workout logger, built to gym constraints.
 *
 * Nothing under 48px, one thumb, last session prefilled. This is the screen
 * where a precise tap target fails in the only place it gets used, so the set
 * cells are 52px and the weight stepper has its own hit areas inside that.
 */
const NEXT = [
  { name: "Incline DB press", plan: "3 × 10 · last 30 kg" },
  { name: "Overhead press", plan: "4 × 5 · last 47.5 kg" },
  { name: "Cable fly", plan: "3 × 12 · last 22.5 kg" },
];

const DONE_SETS = [
  { n: 1, kg: "82.5", reps: "6", rpe: "8" },
  { n: 2, kg: "75.0", reps: "8", rpe: "8" },
];

export default function WorkoutPage() {
  const [bench, setBench] = useState(75);
  const [setsDone, setSetsDone] = useState(2);

  return (
    <div
      data-theme="dark"
      style={{
        minHeight: "100dvh",
        background: "var(--bg-screen)",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 430, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            padding: "16px 20px 12px",
            borderBottom: "1px solid var(--line-hair)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <span style={{ color: "var(--text-1)", fontSize: 16, fontWeight: 600 }}>Push A</span>
          <span className="num" style={{ fontSize: 12, color: "var(--text-2)" }}>
            38:14 · {setsDone} sets
          </span>
        </div>

        <div
          className="scroll-y"
          style={{ flex: 1, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ color: "var(--text-1)", fontSize: 18, fontWeight: 600 }}>Bench press</span>
            <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>
              last: 80 × 6 @8
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "28px 1fr 1fr 1fr 56px",
              gap: 8,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.06em",
              color: "var(--text-4)",
            }}
          >
            <span>#</span>
            <span>KG</span>
            <span>REPS</span>
            <span>RPE</span>
            <span />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {DONE_SETS.map((s) => (
              <div
                key={s.n}
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px 1fr 1fr 1fr 56px",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <span className="num" style={{ fontSize: 13, color: "var(--text-4)" }}>
                  {s.n}
                </span>
                <Cell>{s.kg}</Cell>
                <Cell>{s.reps}</Cell>
                <Cell>{s.rpe}</Cell>
                <div
                  style={{
                    height: 52,
                    borderRadius: "var(--radius-control)",
                    background: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--on-accent)",
                  }}
                >
                  DONE
                </div>
              </div>
            ))}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "28px 1fr 1fr 1fr 56px",
                gap: 8,
                alignItems: "center",
              }}
            >
              <span className="num" style={{ fontSize: 13, color: "var(--text-1)" }}>
                {setsDone + 1}
              </span>
              <div
                style={{
                  height: 52,
                  borderRadius: "var(--radius-control)",
                  background: "var(--bg-input)",
                  border: "1px solid var(--line-active)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 6px",
                }}
              >
                <Step label="−" onClick={() => setBench((b) => Math.max(20, b - 2.5))} />
                <span className="num" style={{ fontSize: 17, color: "var(--text-1)" }}>
                  {bench.toFixed(1)}
                </span>
                <Step label="+" onClick={() => setBench((b) => b + 2.5)} />
              </div>
              <Cell active>8</Cell>
              <Cell active muted>
                —
              </Cell>
              <button
                type="button"
                onClick={() => setSetsDone((n) => n + 1)}
                style={{
                  height: 52,
                  borderRadius: "var(--radius-control)",
                  background: "var(--bg-input)",
                  border: "1px solid var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--accent)",
                  cursor: "pointer",
                }}
              >
                LOG
              </button>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 14px",
              borderRadius: "var(--radius-control)",
              background: "var(--bg-card)",
              border: "1px solid var(--line-hair)",
            }}
          >
            <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>
              REST SINCE SET {setsDone}
            </span>
            <span className="num" style={{ fontSize: 16, color: "var(--text-1)" }}>
              2:41
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.1em",
                color: "var(--text-4)",
                paddingBottom: 8,
              }}
            >
              NEXT
            </span>
            {NEXT.map((x) => (
              <div
                key={x.name}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "11px 0",
                  borderTop: "1px solid var(--line-hair)",
                }}
              >
                <span style={{ fontSize: 14, color: "var(--text-2)" }}>{x.name}</span>
                <span className="num" style={{ fontSize: 12, color: "var(--text-4)" }}>
                  {x.plan}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            padding: "12px 18px 22px",
            borderTop: "1px solid var(--line-hair)",
            background: "var(--bg-bar)",
            display: "flex",
            gap: 10,
          }}
        >
          <div
            style={{
              flex: 1,
              height: 48,
              borderRadius: 24,
              background: "var(--bg-input)",
              border: "1px solid var(--line-strong)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-2)",
              fontSize: 14,
            }}
          >
            Say a set
          </div>
          <RoundButton label="MIC" primary size={48} />
        </div>
      </div>
    </div>
  );
}

function Cell({
  children,
  active,
  muted,
}: {
  children: React.ReactNode;
  active?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        height: 52,
        borderRadius: "var(--radius-control)",
        background: active ? "var(--bg-input)" : "var(--bg-tile)",
        border: `1px solid ${active ? "var(--line-active)" : "var(--line)"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-mono)",
        fontSize: active ? 17 : 16,
        color: muted ? "var(--text-3)" : active ? "var(--text-1)" : "var(--text-2)",
      }}
    >
      {children}
    </div>
  );
}

function Step({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label === "+" ? "Increase weight" : "Decrease weight"}
      style={{
        width: 40,
        height: 44,
        background: "none",
        border: "none",
        fontFamily: "var(--font-mono)",
        fontSize: 18,
        color: "var(--text-2)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

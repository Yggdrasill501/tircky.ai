"use client";

import { Shell } from "@/components/Shell";
import { Composer } from "@/components/primitives/PhoneFrame";
import { DayHeader } from "@/components/day/DayHeader";
import { DayLedger } from "@/components/day/DayLedger";
import { ChatPane } from "@/components/chat/ChatPane";
import { DayTable } from "@/components/day/DayTable";
import { DAY_LABEL, DAY_NUMBER, REVIEW_QUEUE } from "@/lib/fixtures";
import { useDay } from "@/lib/useDay";

/**
 * Take 1a — "Ledger + chat".
 *
 * The day view is the record; the composer opens the conversation over it.
 * Chat is where entries are made, the ledger is where they live.
 */
export default function DayPage() {
  const { entries, totals, targets, setQuantity, setPortionFor } = useDay();

  return (
    <Shell
      phone={
        <>
          <div
            className="scroll-y"
            style={{
              flex: 1,
              padding: "18px 22px 0",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <DayHeader
              label={DAY_LABEL}
              dayNumber={DAY_NUMBER}
              totals={totals}
              targets={targets}
            />
            <DayLedger entries={entries} onQuantity={setQuantity} onPortion={setPortionFor} />
          </div>
          <Composer placeholder="Say or type what you ate…" />
        </>
      }
      desktop={
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 380px",
            overflow: "hidden",
          }}
        >
          <div
            className="scroll-y"
            style={{ padding: "26px 30px", display: "flex", flexDirection: "column", gap: 24 }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
              <span style={{ fontSize: 20, fontWeight: 600 }}>{DAY_LABEL}</span>
              <span
                className="num"
                style={{ fontSize: 11, color: "var(--text-3)" }}
              >
                ‹ Thu · Sat ›
              </span>
            </div>

            <DayTable entries={entries} totals={totals} targets={targets} onQuantity={setQuantity} />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 16px",
                background: "var(--bg-card)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-control)",
                flexWrap: "wrap",
              }}
            >
              <span className="label">REVIEW QUEUE</span>
              <span style={{ fontSize: 13 }}>{REVIEW_QUEUE.summary}</span>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--accent-hi)",
                }}
              >
                OPEN →
              </span>
            </div>
          </div>

          <div
            data-theme="dark"
            style={{
              borderLeft: "1px solid var(--line)",
              background: "var(--bg-screen)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--line-hair)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                Conversation
              </span>
              <span className="num" style={{ fontSize: 10, color: "var(--text-3)" }}>
                ⌘K
              </span>
            </div>
            <ChatPane entries={entries} />
            <Composer placeholder="Log or ask…" camera={false} height={38} />
          </div>
        </div>
      }
    />
  );
}

"use client";

import { Shell } from "@/components/Shell";
import { Composer } from "@/components/primitives/PhoneFrame";
import { MacroMeter } from "@/components/primitives/MacroMeter";
import { PortionRange } from "@/components/primitives/PortionRange";
import { Turn, TurnRow } from "@/components/day/Turn";
import { fmt } from "@/lib/measure";
import { macro } from "@/lib/nutrition";
import { DAY_LABEL, REVIEW_QUEUE, TRAINING } from "@/lib/fixtures";
import { useDay } from "@/lib/useDay";

/**
 * Take 1b — "The day is the conversation".
 *
 * One scrolling column: what you said and what it resolved to are the same
 * timeline. Totals pin to the top; there is no separate chat screen.
 */
export default function MergedDayPage() {
  const { entries, totals, targets, setPortionFor } = useDay();
  const find = (id: string) => entries.find((e) => e.id === id);

  const salmon = find("sal");
  const pinned = (
    <div
      style={{
        padding: "14px 22px 12px",
        borderBottom: "1px solid var(--line-hair)",
        background: "var(--bg-bar)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>{DAY_LABEL}</span>
        <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>
          ‹ ›
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span
          className="num"
          style={{ fontSize: 26, color: "var(--text-1)", letterSpacing: "-0.02em" }}
        >
          {fmt(totals.kcalLeft)}
        </span>
        <span
          className="num"
          style={{ fontSize: 10, color: "var(--text-3)", letterSpacing: "0.06em" }}
        >
          KCAL LEFT
        </span>
        <span
          className="num"
          style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-2)" }}
        >
          {fmt(totals.protein)} / {targets.protein} P
        </span>
      </div>
      <MacroMeter label="ENERGY" value={totals.kcal} target={targets.kcal} height={3} showValue={false} />
    </div>
  );

  const timeline = (
    <>
      <Turn said="greek yogurt 200 and a handful of blueberries">
        {[find("yog"), find("blu")].map(
          (e, i) => e && <TurnRow key={e.id} entry={e} showTime={i === 0} />,
        )}
      </Turn>

      <Turn said="chicken thigh 210g, jasmine rice, some broccoli" note="rice read as cooked weight · undo meal">
        {[find("chk"), find("rice"), find("bro")].map(
          (e, i) => e && <TurnRow key={e.id} entry={e} showTime={i === 0} />,
        )}
      </Turn>

      {salmon?.portionBounds && (
        <Turn photo>
          <TurnRow entry={salmon} showTime />
          <div style={{ paddingTop: 4 }}>
            <PortionRange
              min={salmon.portionBounds.min}
              max={salmon.portionBounds.max}
              step={salmon.portionBounds.step}
              grams={salmon.grams}
              kcal={macro(salmon, "kcal")}
              anchor={salmon.note}
              compact
              onChange={(g) => setPortionFor(salmon.id, g)}
            />
          </div>
          <span className="num" style={{ fontSize: 10, color: "var(--text-4)", paddingTop: 2 }}>
            portion estimated from photo · drag to set
          </span>
        </Turn>
      )}

      <Turn>
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
            {TRAINING.time}
          </span>
          <span style={{ fontSize: 14, color: "var(--text-1)" }}>
            {TRAINING.title} — {TRAINING.hardSets} hard sets
          </span>
          <span className="num" style={{ fontSize: 12, color: "var(--text-2)" }}>
            {TRAINING.duration}
          </span>
        </div>
        {TRAINING.topSets.map((s) => (
          <div
            key={s.exercise}
            style={{
              display: "grid",
              gridTemplateColumns: "44px 1fr auto",
              gap: 8,
              alignItems: "baseline",
              padding: "5px 0",
            }}
          >
            <span />
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>
              {s.exercise}, {s.detail}
            </span>
            <span className="num" style={{ fontSize: 12, color: "var(--text-1)" }}>
              {s.value}
            </span>
          </div>
        ))}
      </Turn>
    </>
  );

  return (
    <Shell
      phone={
        <>
          {pinned}
          <div
            className="scroll-y"
            style={{ flex: 1, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 }}
          >
            {timeline}
          </div>
          <Composer placeholder="Say or type…" />
        </>
      }
      desktop={
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 300px",
            overflow: "hidden",
          }}
        >
          <div
            className="scroll-y"
            style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 18 }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <span
                className="num"
                style={{ fontSize: 30, color: "var(--text-1)", letterSpacing: "-0.02em" }}
              >
                {fmt(totals.kcalLeft)}
              </span>
              <span
                className="num"
                style={{ fontSize: 11, color: "var(--text-3)", letterSpacing: "0.06em" }}
              >
                KCAL LEFT · {fmt(totals.protein)} / {targets.protein} P
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{timeline}</div>
          </div>

          <div
            style={{
              borderLeft: "1px solid var(--line)",
              background: "var(--bg-card)",
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              overflow: "auto",
            }}
          >
            <span className="label">TODAY</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <MacroMeter label="PROTEIN" value={totals.protein} target={targets.protein} />
              <MacroMeter label="CARBS" value={totals.carb} target={targets.carb} />
              <MacroMeter label="FAT" value={totals.fat} target={targets.fat} />
            </div>
            <div style={{ height: 1, background: "var(--track)" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                ["Sleep", "7h 12m"],
                ["Resting HR", "52 bpm"],
                ["Bodyweight", "81.4 kg"],
                ["Hard sets, 7 d", "74"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 13, color: "var(--text-2)" }}>{k}</span>
                  <span className="num" style={{ fontSize: 13, color: "var(--text-1)" }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ height: 1, background: "var(--track)" }} />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: 12,
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-control)",
              }}
            >
              <span className="label">REVIEW</span>
              <span style={{ fontSize: 13, color: "var(--text-1)", lineHeight: 1.4 }}>
                {REVIEW_QUEUE.count} items waiting — 1 photo estimate, 2 from the 11 Sep chat import
              </span>
            </div>
          </div>
        </div>
      }
    />
  );
}

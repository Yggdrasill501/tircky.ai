import { AppNav } from "@/components/AppNav";
import { Sparkline, TrendChart } from "@/components/trends/TrendChart";

/**
 * 1d — Trends and insufficiency.
 *
 * The load-bearing idea: a metric that cannot be computed says what it is
 * waiting for. Not a greyed number, not an empty box — a number a reader can
 * see is a number they will act on, whatever the styling.
 */
const POINTS = [
  [14, 34], [58, 46], [102, 28], [146, 54], [190, 40], [234, 62], [278, 48],
  [322, 70], [366, 56], [410, 80], [454, 66], [498, 88], [542, 74], [586, 96],
  [630, 82], [674, 104], [718, 90], [762, 110], [806, 98], [828, 112],
] as const satisfies readonly (readonly [number, number])[];

const E1RM_POINTS =
  "8,58 36,54 64,56 92,48 120,50 148,42 176,44 204,38 232,40 260,32 288,34 316,26 344,28 372,18";

const TILES = [
  { label: "RESTING HR · 30 D", value: "52 bpm", meta: "n = 30 · −2 vs prior 30 d" },
  { label: "HRV · 30 D", value: "58 ms", meta: "n = 28 · 2 nights unworn" },
  { label: "SLEEP · 30 D", value: "7h 04m", meta: "n = 29 · sd 48 min" },
];

export default function TrendsPage() {
  return (
    <div
      data-theme="light"
      style={{
        minHeight: "100dvh",
        background: "var(--bg-canvas)",
        color: "var(--text-1)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <AppNav />
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 22, maxWidth: 1000, width: "100%", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 18, fontWeight: 600 }}>Trends</span>
          <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>
            30 D · 90 D · 1 Y
          </span>
        </div>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Bodyweight</span>
            <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>
              n = 20 over 30 d · fitted −0.31 kg/wk · goal −0.40
            </span>
          </div>
          <TrendChart points={POINTS} fit={[14, 36, 828, 104]} goal={[14, 36, 828, 118]} />
          <div
            className="num"
            style={{ display: "flex", gap: 22, fontSize: 10, color: "var(--text-3)", flexWrap: "wrap" }}
          >
            <span>— fitted</span>
            <span style={{ color: "var(--chart-goal)" }}>- - goal rate</span>
            <span>· daily measurement</span>
          </div>
        </Card>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 }}>
          <Card>
            <span style={{ fontSize: 14, fontWeight: 600 }}>e1RM — Bench press</span>
            <span className="num" style={{ fontSize: 26 }}>98.1 kg</span>
            <span className="num" style={{ fontSize: 11, color: "var(--text-3)" }}>
              +3.4 kg over 8 weeks · n = 14 sessions
            </span>
            <Sparkline points={E1RM_POINTS} />
          </Card>

          <Card dashed>
            <span style={{ fontSize: 14, fontWeight: 600 }}>e1RM — Overhead press</span>
            <span className="num" style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.5 }}>
              Not enough sessions to fit a line.
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
              <div
                className="num"
                style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-3)" }}
              >
                <span>6 of 10 sessions</span>
                <span>≈ 12 days at current frequency</span>
              </div>
              <div style={{ height: 4, background: "var(--track)", borderRadius: 2, display: "flex", overflow: "hidden" }}>
                <div style={{ width: "60%", background: "var(--text-4)" }} />
              </div>
            </div>
            <span className="num" style={{ fontSize: 11, color: "var(--text-3)", marginTop: "auto" }}>
              Last 6 sets are recorded and will be used when the tenth lands.
            </span>
          </Card>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 18 }}>
          {TILES.map((t) => (
            <Card key={t.label} gap={5} padding={16}>
              <span className="label">{t.label}</span>
              <span className="num" style={{ fontSize: 22 }}>{t.value}</span>
              <span className="num" style={{ fontSize: 10, color: "var(--text-3)" }}>{t.meta}</span>
            </Card>
          ))}
          <Card dashed gap={5} padding={16}>
            <span className="label">SLEEP vs e1RM</span>
            <span style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.4 }}>
              13 of 20 paired observations
            </span>
            <span className="num" style={{ fontSize: 10, color: "var(--text-3)" }}>
              no correlation reported yet
            </span>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({
  children,
  dashed,
  gap = 10,
  padding = 20,
}: {
  children: React.ReactNode;
  dashed?: boolean;
  gap?: number;
  padding?: number;
}) {
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: `1px ${dashed ? "dashed var(--line-dashed)" : "solid var(--line)"}`,
        borderRadius: "var(--radius-card)",
        padding,
        display: "flex",
        flexDirection: "column",
        gap,
      }}
    >
      {children}
    </div>
  );
}

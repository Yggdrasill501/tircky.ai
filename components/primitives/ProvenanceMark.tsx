import type { Provenance } from "@/lib/nutrition";

/**
 * One small mark, absent for the default case.
 *
 * Six sources times every row would be badge soup, so hand-entry — the case
 * that needs no explanation — carries no mark at all. The rest get a lowercase
 * mono word, never a coloured pill and never an icon.
 */
const WORD: Record<Provenance, string | null> = {
  manual: null,
  said: "said",
  scanned: "scanned",
  photo: "photo",
  imported: "imported",
  health: "health",
};

export function ProvenanceMark({ of, review }: { of: Provenance; review?: boolean }) {
  const word = review ? "needs review" : WORD[of];
  if (!word) return null;
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        letterSpacing: "0.06em",
        color: "var(--text-4)",
        whiteSpace: "nowrap",
      }}
    >
      {word}
    </span>
  );
}

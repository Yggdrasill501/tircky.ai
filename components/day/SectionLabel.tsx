export function SectionLabel({ children, right }: { children: string; right?: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        paddingBottom: 6,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.1em",
          color: "var(--text-3)",
        }}
      >
        {children}
      </span>
      {right && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-5)" }}>
          {right}
        </span>
      )}
    </div>
  );
}

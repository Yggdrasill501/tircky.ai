import type { ReactNode } from "react";

/**
 * 390 × 844 with a 36px radius, matching the design's frame.
 *
 * No painted status bar: on a real device the system draws its own on top, and
 * a fake one underneath it looks doubled up. The left slot carries the real
 * clock only because these are presentation frames on a canvas.
 */
export function PhoneFrame({
  children,
  label,
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <div
      data-theme="dark"
      style={{
        width: 390,
        height: 844,
        borderRadius: "var(--radius-device)",
        overflow: "hidden",
        background: "var(--bg-screen)",
        border: "1px solid var(--line-frame)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function Composer({
  placeholder,
  camera = true,
  height = 44,
}: {
  placeholder: string;
  camera?: boolean;
  height?: number;
}) {
  const r = height / 2;
  return (
    <div
      style={{
        padding: "12px 18px 22px",
        borderTop: "1px solid var(--line-hair)",
        background: "var(--bg-bar)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          height,
          borderRadius: r,
          background: "var(--bg-input)",
          border: "1px solid var(--line-strong)",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          color: "var(--text-3)",
          fontSize: 14,
        }}
      >
        {placeholder}
      </div>
      {camera && <RoundButton label="CAM" />}
      <RoundButton label="MIC" primary size={height} />
    </div>
  );
}

export function RoundButton({
  label,
  primary = false,
  size = 44,
}: {
  label: string;
  primary?: boolean;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        background: primary ? "var(--accent)" : "var(--bg-input)",
        border: primary ? "none" : "1px solid var(--line-strong)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: primary ? "var(--on-accent)" : "var(--text-2)",
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  );
}

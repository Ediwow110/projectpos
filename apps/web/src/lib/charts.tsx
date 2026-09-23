import type { JSX } from "react";

export interface TrendPoint {
  bucket: string;
  value: number;
}

export function TrendChart({ points, width = 560, height = 160, label }: {
  points: TrendPoint[];
  width?: number;
  height?: number;
  label: string;
}): JSX.Element {
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = Math.round(i * step);
    const y = Math.round(height - 12 - (p.value / max) * (height - 24));
    return `${x},${y}`;
  });
  const area = `0,${height} ${coords.join(" ")} ${width},${height}`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <desc>{points.map((p) => `${p.bucket}: ${p.value}`).join(", ")}</desc>
      <polygon points={area} fill="currentColor" opacity={0.12} stroke="none" />
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface BarDatum {
  label: string;
  value: number;
}

export function BarChart({ bars, width = 560, rowHeight = 22 }: {
  bars: BarDatum[];
  width?: number;
  rowHeight?: number;
}): JSX.Element {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const height = Math.max(rowHeight, bars.length * rowHeight);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Bar chart"
    >
      <title>Bar chart</title>
      <desc>{bars.map((b) => `${b.label}: ${b.value}`).join(", ")}</desc>
      {bars.map((b, i) => {
        const w = Math.round((b.value / max) * (width - 160));
        const y = i * rowHeight;
        return (
          <g key={b.label}>
            <text x={0} y={y + 15} fontSize={12}>{b.label}</text>
            <rect x={150} y={y + 3} width={Math.max(w, 2)} height={14} fill="currentColor" opacity={0.75} />
            <text x={150 + Math.max(w, 2) + 6} y={y + 15} fontSize={12}>{b.value}</text>
          </g>
        );
      })}
    </svg>
  );
}

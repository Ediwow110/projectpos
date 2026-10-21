import React from "react";
import type { JSX } from "react";

export interface TrendPoint {
  bucket: string;
  value: number;
}

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

export interface GroupedBarDatum {
  label: string;
  primary: number;
  secondary: number;
}

export interface DonutSegment {
  label: string;
  value: number;
  color?: string;
}

const PALETTE = ["#f35d3f", "#ff9a81", "#d6cbc1", "#e6ddd5", "#3468d4", "#1f8a5b"];

function safeValue(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function EmptyChart({ label }: { label: string }): JSX.Element {
  return (
    <div role="img" aria-label={label} className="grid min-h-36 place-items-center rounded-xl bg-[#fcf8f3] px-4 text-center">
      <p className="text-xs text-[var(--color-atlas-muted-strong)]">No chart data available</p>
    </div>
  );
}

export function TrendChart({
  points,
  width = 560,
  height = 160,
  label,
}: {
  points: TrendPoint[];
  width?: number;
  height?: number;
  label: string;
}): JSX.Element {
  if (points.length === 0) return <EmptyChart label={label} />;
  const values = points.map((p) => safeValue(p.value));
  const max = Math.max(1, ...values);
  const step = points.length > 1 ? width / (points.length - 1) : width / 2;
  const coords = values.map((value, i) => {
    const x = points.length > 1 ? Math.round(i * step) : Math.round(width / 2);
    const y = Math.round(height - 12 - (value / max) * (height - 24));
    return { x, y };
  });
  const areaPoints = "0," + height + " " + coords.map((p) => p.x + "," + p.y).join(" ") + " " + width + "," + height;
  const linePoints = coords.map((p) => p.x + "," + p.y).join(" ");
  return (
    <svg width="100%" height={height} viewBox={"0 0 " + width + " " + height} role="img" aria-label={label}>
      <title>{label}</title>
      <desc>{points.map((p, i) => p.bucket + ": " + values[i]).join(", ")}</desc>
      <polygon points={areaPoints} fill="currentColor" opacity={0.08} stroke="none" />
      <polyline points={linePoints} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function VerticalBarChart({
  bars,
  label,
  width = 560,
  height = 180,
}: {
  bars: BarDatum[];
  label: string;
  width?: number;
  height?: number;
}): JSX.Element {
  if (bars.length === 0) return <EmptyChart label={label} />;
  const values = bars.map((bar) => safeValue(bar.value));
  const max = Math.max(1, ...values);
  const gap = 8;
  const usableWidth = width - 24;
  const barWidth = Math.max(6, (usableWidth - gap * (bars.length - 1)) / bars.length);
  const chartHeight = height - 36;
  return (
    <svg width="100%" height={height} viewBox={"0 0 " + width + " " + height} role="img" aria-label={label}>
      <title>{label}</title>
      <desc>{bars.map((bar, i) => bar.label + ": " + values[i]).join(", ")}</desc>
      {bars.map((bar, i) => {
        const barHeight = Math.max(2, (values[i] / max) * chartHeight);
        const x = 12 + i * (barWidth + gap);
        const y = chartHeight - barHeight + 8;
        return (
          <g key={bar.label + i}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx={Math.min(5, barWidth / 2)} fill={bar.color ?? (i === bars.length - 1 ? "#f35d3f" : "#f1e9e1")} />
            {bars.length <= 12 ? <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" fontSize={8} fill="#9a8d83">{bar.label}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

export function GroupedBarChart({
  groups,
  label,
  width = 560,
  height = 180,
  primaryColor = "#f35d3f",
  secondaryColor = "#d8cdc3",
}: {
  groups: GroupedBarDatum[];
  label: string;
  width?: number;
  height?: number;
  primaryColor?: string;
  secondaryColor?: string;
}): JSX.Element {
  if (groups.length === 0) return <EmptyChart label={label} />;
  const max = Math.max(1, ...groups.flatMap((g) => [safeValue(g.primary), safeValue(g.secondary)]));
  const chartHeight = height - 34;
  const groupWidth = Math.max(20, (width - 24) / groups.length);
  const barWidth = Math.max(5, Math.min(14, groupWidth * 0.32));
  return (
    <svg width="100%" height={height} viewBox={"0 0 " + width + " " + height} role="img" aria-label={label}>
      <title>{label}</title>
      <desc>{groups.map((g) => g.label + ": " + safeValue(g.primary) + " / " + safeValue(g.secondary)).join(", ")}</desc>
      {groups.map((group, i) => {
        const primary = safeValue(group.primary);
        const secondary = safeValue(group.secondary);
        const h1 = Math.max(2, (primary / max) * chartHeight);
        const h2 = Math.max(2, (secondary / max) * chartHeight);
        const center = 12 + groupWidth * i + groupWidth / 2;
        return (
          <g key={group.label + i}>
            <rect x={center - barWidth - 2} y={chartHeight - h1 + 8} width={barWidth} height={h1} rx={4} fill={primaryColor} />
            <rect x={center + 2} y={chartHeight - h2 + 8} width={barWidth} height={h2} rx={4} fill={secondaryColor} />
            {groups.length <= 12 ? <text x={center} y={height - 7} textAnchor="middle" fontSize={8} fill="#9a8d83">{group.label}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

export function HorizontalBarChart({
  bars,
  label,
  width = 560,
  rowHeight = 34,
}: {
  bars: BarDatum[];
  label: string;
  width?: number;
  rowHeight?: number;
}): JSX.Element {
  if (bars.length === 0) return <EmptyChart label={label} />;
  const values = bars.map((bar) => safeValue(bar.value));
  const max = Math.max(1, ...values);
  const height = Math.max(rowHeight, bars.length * rowHeight);
  const labelWidth = Math.min(150, Math.max(90, width * 0.24));
  const valueWidth = 56;
  const trackWidth = Math.max(40, width - labelWidth - valueWidth - 16);
  return (
    <svg width="100%" height={height} viewBox={"0 0 " + width + " " + height} role="img" aria-label={label}>
      <title>{label}</title>
      <desc>{bars.map((bar, i) => bar.label + ": " + values[i]).join(", ")}</desc>
      {bars.map((bar, i) => {
        const y = i * rowHeight;
        const fillWidth = Math.max(2, (values[i] / max) * trackWidth);
        return (
          <g key={bar.label + i}>
            <text x={0} y={y + 18} fontSize={10} fontWeight={600} fill="#2a241f">{bar.label}</text>
            <rect x={labelWidth} y={y + 8} width={trackWidth} height={8} rx={4} fill="#efe7df" />
            <rect x={labelWidth} y={y + 8} width={fillWidth} height={8} rx={4} fill={bar.color ?? "#f35d3f"} />
            <text x={labelWidth + trackWidth + 8} y={y + 18} fontSize={9} fill="#746960">{values[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function DonutChart({
  segments,
  label,
  size = 176,
  centerLabel,
}: {
  segments: DonutSegment[];
  label: string;
  size?: number;
  centerLabel?: string;
}): JSX.Element {
  const normalized = segments.map((segment) => ({ ...segment, value: safeValue(segment.value) }));
  const total = normalized.reduce((sum, segment) => sum + segment.value, 0);
  if (segments.length === 0 || total <= 0) return <EmptyChart label={label} />;
  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 176 176" role="img" aria-label={label}>
      <title>{label}</title>
      <desc>{normalized.map((segment) => segment.label + ": " + segment.value).join(", ")}</desc>
      <g transform="rotate(-90 88 88)">
        {normalized.map((segment, i) => {
          const length = (segment.value / total) * circumference;
          const circle = (
            <circle
              key={segment.label + i}
              cx="88"
              cy="88"
              r={radius}
              fill="none"
              stroke={segment.color ?? PALETTE[i % PALETTE.length]}
              strokeWidth="24"
              strokeDasharray={length + " " + (circumference - length)}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return circle;
        })}
      </g>
      <circle cx="88" cy="88" r="45" fill="#ffffff" />
      {centerLabel ? <text x="88" y="91" textAnchor="middle" fontSize="16" fontWeight="700" fill="#17130f">{centerLabel}</text> : null}
    </svg>
  );
}

export function HeatmapChart({
  rows,
  columns,
  values,
  label,
}: {
  rows: string[];
  columns: string[];
  values: number[][];
  label: string;
}): JSX.Element {
  if (rows.length === 0 || columns.length === 0) return <EmptyChart label={label} />;
  const flattened = values.flat().map(safeValue);
  const max = Math.max(1, ...flattened);
  const cell = 18;
  const gap = 5;
  const left = 44;
  const top = 12;
  const width = left + columns.length * (cell + gap) + 8;
  const height = top + rows.length * (cell + gap) + 30;
  const colors = ["#f5efe9", "#fde1d8", "#ffc5b4", "#ff9278", "#f35d3f"];
  return (
    <svg width="100%" height={height} viewBox={"0 0 " + width + " " + height} role="img" aria-label={label}>
      <title>{label}</title>
      <desc>{rows.map((row, r) => row + ": " + columns.map((col, c) => col + " " + safeValue(values[r]?.[c] ?? 0)).join(", ")).join("; ")}</desc>
      {rows.map((row, r) => <text key={row} x={0} y={top + r * (cell + gap) + 13} fontSize={8} fontWeight={600} fill="#6b6058">{row}</text>)}
      {columns.map((column, c) => <text key={column} x={left + c * (cell + gap) + cell / 2} y={height - 5} textAnchor="middle" fontSize={7} fill="#9a8d83">{column}</text>)}
      {rows.flatMap((row, r) =>
        columns.map((column, c) => {
          const value = safeValue(values[r]?.[c] ?? 0);
          const index = Math.min(colors.length - 1, Math.floor((value / max) * (colors.length - 1)));
          return <rect key={row + column} x={left + c * (cell + gap)} y={top + r * (cell + gap)} width={cell} height={cell} rx={4} fill={colors[index]} />;
        }),
      )}
    </svg>
  );
}

export function BarChart({ bars, width = 560, rowHeight = 22 }: { bars: BarDatum[]; width?: number; rowHeight?: number }): JSX.Element {
  return <HorizontalBarChart bars={bars} width={width} rowHeight={rowHeight} label="Bar chart" />;
}

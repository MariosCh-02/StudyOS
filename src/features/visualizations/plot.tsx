/** Small SVG plotting helpers shared by the visualizations (no chart library needed). */
import { useId, type ReactNode } from "react";

export interface Scale {
  (v: number): number;
  invert: (px: number) => number;
  domain: [number, number];
}

export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = (r1 - r0) / (d1 - d0 || 1);
  const f = ((v: number) => r0 + (v - d0) * k) as Scale;
  f.invert = (px: number) => d0 + (px - r0) / k;
  f.domain = domain;
  return f;
}

/** "Nice" tick values for an axis. */
export function ticks([a, b]: [number, number], count = 5): number[] {
  const span = b - a;
  if (!(span > 0)) return [a];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count + 0.5) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export const fmt = (v: number, digits = 2) => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(1) : Number(v.toFixed(digits)).toString());

export const MARGIN = { top: 12, right: 12, bottom: 28, left: 40 };

interface AxesProps {
  x: Scale;
  y: Scale;
  width: number;
  height: number;
  xLabel?: string;
  yLabel?: string;
  /** Hide gridlines (e.g. under a heatmap). */
  plain?: boolean;
}

/** Recessive axes and gridlines in text/border tokens. */
export function Axes({ x, y, width, height, xLabel, yLabel, plain }: AxesProps) {
  const left = MARGIN.left;
  const bottom = height - MARGIN.bottom;
  return (
    <g fontSize={10} fill="var(--subtle)">
      {!plain &&
        ticks(y.domain).map((t) => (
          <line key={`gy${t}`} x1={left} x2={width - MARGIN.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
        ))}
      <line x1={left} x2={width - MARGIN.right} y1={bottom} y2={bottom} stroke="var(--border)" />
      <line x1={left} x2={left} y1={MARGIN.top} y2={bottom} stroke="var(--border)" />
      {ticks(x.domain).map((t) => (
        <text key={`x${t}`} x={x(t)} y={bottom + 14} textAnchor="middle">
          {fmt(t)}
        </text>
      ))}
      {ticks(y.domain).map((t) => (
        <text key={`y${t}`} x={left - 6} y={y(t) + 3} textAnchor="end">
          {fmt(t)}
        </text>
      ))}
      {xLabel && (
        <text x={width - MARGIN.right} y={height - 2} textAnchor="end" fill="var(--muted)">
          {xLabel}
        </text>
      )}
      {yLabel && (
        <text x={left + 4} y={MARGIN.top + 2} fill="var(--muted)">
          {yLabel}
        </text>
      )}
    </g>
  );
}

export function ClipRect({ width, height, children }: { width: number; height: number; children: (clipId: string) => ReactNode }) {
  const id = useId().replace(/:/g, "");
  return (
    <>
      <defs>
        <clipPath id={id}>
          <rect x={MARGIN.left} y={MARGIN.top} width={width - MARGIN.left - MARGIN.right} height={height - MARGIN.top - MARGIN.bottom} />
        </clipPath>
      </defs>
      {children(`url(#${id})`)}
    </>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}

export function Slider({ label, value, min, max, step, onChange, format = (v) => fmt(v, 3) }: SliderProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-medium text-fg tabular-nums">{format(value)}</span>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-[var(--accent)]" />
    </div>
  );
}

/** Point marker: circle for class 0, square for class 1 (identity never relies on colour alone). */
export function Marker({ x, y, cls, r = 5, title }: { x: number; y: number; cls: 0 | 1; r?: number; title?: string }) {
  const fill = cls === 0 ? "var(--chart-1)" : "var(--chart-2)";
  return cls === 0 ? (
    <circle cx={x} cy={y} r={r} fill={fill} stroke="var(--surface)" strokeWidth={2}>
      {title && <title>{title}</title>}
    </circle>
  ) : (
    <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1.5} fill={fill} stroke="var(--surface)" strokeWidth={2}>
      {title && <title>{title}</title>}
    </rect>
  );
}

export function ClassLegend({ labels = ["Class A", "Class B"] }: { labels?: [string, string] }) {
  return (
    <div className="flex gap-4 text-xs text-muted">
      {labels.map((l, i) => (
        <span key={l} className="flex items-center gap-1.5">
          <svg width={12} height={12} aria-hidden>
            <Marker x={6} y={6} cls={i as 0 | 1} r={4} />
          </svg>
          {l}
        </span>
      ))}
    </div>
  );
}

export function VizFrame({ title, controls, children, footer }: { title?: string; controls: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <figure className="my-4 rounded-xl border border-border bg-surface p-4 not-prose">
      {title && <figcaption className="mb-3 text-sm font-semibold">{title}</figcaption>}
      <div className="grid grid-cols-[1fr_15rem] gap-4">
        <div className="min-w-0">{children}</div>
        <div className="flex flex-col gap-3">{controls}</div>
      </div>
      {footer && <div className="mt-3 text-xs text-muted">{footer}</div>}
    </figure>
  );
}

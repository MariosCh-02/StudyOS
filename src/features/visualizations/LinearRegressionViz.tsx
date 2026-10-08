import { useMemo, useState } from "react";
import { RotateCcw, Shuffle, Target } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Axes, fmt, linear, MARGIN, Slider, VizFrame } from "./plot";

const W = 520;
const H = 340;
const DOMAIN: [number, number] = [0, 10];

type Pt = [number, number];

function sample(): Pt[] {
  // y ≈ 1.5 + 0.8x + noise, deterministic-looking but varied each click.
  return Array.from({ length: 12 }, () => {
    const xv = 0.5 + Math.random() * 9;
    return [xv, Math.min(10, Math.max(0, 1.5 + 0.8 * xv + (Math.random() - 0.5) * 3))] as Pt;
  });
}

/** Closed-form least squares: w = cov(x,y)/var(x), b = ȳ − w x̄. */
export function leastSquares(points: Pt[]): { w: number; b: number } | null {
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  const sxx = points.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  if (sxx === 0) return null;
  const w = points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / sxx;
  return { w, b: my - w * mx };
}

export const mse = (points: Pt[], w: number, b: number) => (points.length ? points.reduce((s, [px, py]) => s + (py - (w * px + b)) ** 2, 0) / points.length : 0);

/** Fit a line by hand, then compare with least squares. Click to add points, click a point to remove it. */
export default function LinearRegressionViz() {
  const [points, setPoints] = useState<Pt[]>(() => [
    [1, 2.1], [2, 3.4], [3, 3.7], [4, 4.9], [5, 5.2], [6, 6.6], [7, 6.9], [8, 8.1], [9, 8.6],
  ]);
  const [w, setW] = useState(0.5);
  const [b, setB] = useState(3);
  const [showFit, setShowFit] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const best = useMemo(() => leastSquares(points), [points]);
  const x = linear(DOMAIN, [MARGIN.left, W - MARGIN.right]);
  const y = linear(DOMAIN, [H - MARGIN.bottom, MARGIN.top]);
  const yourMse = mse(points, w, b);
  const bestMse = best ? mse(points, best.w, best.b) : null;

  const add = (e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest("[data-point]")) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const py = ((e.clientY - r.top) / r.height) * H;
    const vx = x.invert(px);
    const vy = y.invert(py);
    if (vx < DOMAIN[0] || vx > DOMAIN[1] || vy < DOMAIN[0] || vy > DOMAIN[1]) return;
    setPoints((p) => [...p, [vx, vy]]);
  };

  return (
    <VizFrame
      title="Linear regression"
      controls={
        <>
          <Slider label="Slope w" value={w} min={-2} max={3} step={0.01} onChange={setW} />
          <Slider label="Intercept b" value={b} min={-5} max={10} step={0.05} onChange={setB} />
          <dl className="grid grid-cols-2 gap-y-1 text-xs">
            <dt className="text-muted">Your MSE</dt>
            <dd className="text-right font-medium tabular-nums">{fmt(yourMse, 3)}</dd>
            <dt className="text-muted">Best MSE</dt>
            <dd className="text-right tabular-nums">{bestMse != null ? fmt(bestMse, 3) : "—"}</dd>
            {best && showFit && (
              <>
                <dt className="text-muted">Best line</dt>
                <dd className="text-right tabular-nums">
                  y = {fmt(best.w, 3)}x {best.b >= 0 ? "+" : "−"} {fmt(Math.abs(best.b), 3)}
                </dd>
              </>
            )}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={showFit ? "secondary" : "primary"} icon={<Target className="size-3.5" />} onClick={() => setShowFit((s) => !s)} disabled={!best}>
              {showFit ? "Hide fit" : "Show least squares"}
            </Button>
            <Button size="sm" disabled={!best} onClick={() => best && (setW(Number(best.w.toFixed(2))), setB(Number(best.b.toFixed(2))))}>
              Snap to fit
            </Button>
            <Button size="sm" variant="ghost" icon={<Shuffle className="size-3.5" />} onClick={() => setPoints(sample())}>
              New data
            </Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setPoints([])}>
              Clear
            </Button>
          </div>
          <p className="text-xs text-subtle">Click the plot to add a point; click a point to remove it. Try adding an outlier.</p>
        </>
      }
      footer="The dashed lines are residuals (prediction errors). Mean squared error averages their squares, so large errors dominate, which is why one outlier can tilt the least-squares line."
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full cursor-crosshair" role="img" aria-label={`Scatter plot with ${points.length} points and a regression line`} onClick={add}>
        <Axes x={x} y={y} width={W} height={H} xLabel="x" yLabel="y" />
        {points.map(([px, py], i) => (
          <line key={`r${i}`} x1={x(px)} x2={x(px)} y1={y(py)} y2={y(w * px + b)} stroke="var(--chart-2)" strokeDasharray="3 2" strokeWidth={1} />
        ))}
        <line x1={x(DOMAIN[0])} x2={x(DOMAIN[1])} y1={y(w * DOMAIN[0] + b)} y2={y(w * DOMAIN[1] + b)} stroke="var(--chart-2)" strokeWidth={2} />
        {best && showFit && <line x1={x(DOMAIN[0])} x2={x(DOMAIN[1])} y1={y(best.w * DOMAIN[0] + best.b)} y2={y(best.w * DOMAIN[1] + best.b)} stroke="var(--chart-1)" strokeWidth={2} strokeDasharray="6 4" />}
        {points.map(([px, py], i) => (
          <g key={i} data-point onClick={() => setPoints((p) => p.filter((_, j) => j !== i))} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="cursor-pointer">
            <circle cx={x(px)} cy={y(py)} r={10} fill="transparent" />
            <circle cx={x(px)} cy={y(py)} r={hover === i ? 6.5 : 5} fill="var(--chart-1)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        ))}
        {hover != null && points[hover] && (
          <text x={x(points[hover][0]) + 9} y={y(points[hover][1]) - 9} fontSize={11} fill="var(--fg)" pointerEvents="none">
            ({fmt(points[hover][0], 2)}, {fmt(points[hover][1], 2)}) residual {fmt(points[hover][1] - (w * points[hover][0] + b), 2)}
          </text>
        )}
        <g fontSize={10} fill="var(--muted)">
          <line x1={W - 150} x2={W - 132} y1={MARGIN.top + 8} y2={MARGIN.top + 8} stroke="var(--chart-2)" strokeWidth={2} />
          <text x={W - 128} y={MARGIN.top + 11}>your line</text>
          {showFit && (
            <>
              <line x1={W - 80} x2={W - 62} y1={MARGIN.top + 8} y2={MARGIN.top + 8} stroke="var(--chart-1)" strokeWidth={2} strokeDasharray="6 4" />
              <text x={W - 58} y={MARGIN.top + 11}>best fit</text>
            </>
          )}
        </g>
      </svg>
    </VizFrame>
  );
}

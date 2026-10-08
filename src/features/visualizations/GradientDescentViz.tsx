import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { Axes, ClipRect, fmt, linear, MARGIN, Slider, VizFrame } from "./plot";

interface Fn {
  id: string;
  label: string;
  f: (x: number) => number;
  df: (x: number) => number;
  domain: [number, number];
  start: number;
}

const FUNCTIONS: Fn[] = [
  { id: "quad", label: "Convex: f(x) = x²", f: (x) => x * x, df: (x) => 2 * x, domain: [-3, 3], start: 2.6 },
  { id: "steep", label: "Steep: f(x) = 4x²", f: (x) => 4 * x * x, df: (x) => 8 * x, domain: [-3, 3], start: 2.6 },
  {
    id: "nonconvex",
    label: "Non-convex: f(x) = x⁴ − 3x² + x",
    f: (x) => x ** 4 - 3 * x * x + x,
    df: (x) => 4 * x ** 3 - 6 * x + 1,
    domain: [-2.3, 2.3],
    start: 2,
  },
];

const W = 520;
const H = 300;
const MAX_STEPS = 200;

/** Gradient descent on a 1-D loss: x ← x − α f'(x). */
export default function GradientDescentViz() {
  const [fnId, setFnId] = useState("quad");
  const fn = FUNCTIONS.find((f) => f.id === fnId)!;
  const [lr, setLr] = useState(0.1);
  const [start, setStart] = useState(fn.start);
  const [path, setPath] = useState<number[]>([fn.start]);
  const [running, setRunning] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    setStart(fn.start);
    setPath([fn.start]);
    setRunning(false);
  }, [fnId]);

  const reset = (s = start) => {
    setPath([s]);
    setRunning(false);
  };

  const step = () =>
    setPath((p) => {
      const x = p[p.length - 1]!;
      const next = x - lr * fn.df(x);
      if (!Number.isFinite(next) || Math.abs(next) > 1e6 || p.length > MAX_STEPS) return p;
      return [...p, next];
    });

  useEffect(() => {
    if (!running) return;
    const t = setInterval(step, 120);
    return () => clearInterval(t);
    // step reads lr and fn from this render.
  }, [running, lr, fnId]);

  const x = linear(fn.domain, [MARGIN.left, W - MARGIN.right]);
  const ys = useMemo(() => Array.from({ length: 201 }, (_, i) => fn.f(fn.domain[0] + ((fn.domain[1] - fn.domain[0]) * i) / 200)), [fn]);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const y = linear([yMin - 0.05 * (yMax - yMin), yMax], [H - MARGIN.bottom, MARGIN.top]);
  const curve = ys.map((v, i) => `${i ? "L" : "M"}${x(fn.domain[0] + ((fn.domain[1] - fn.domain[0]) * i) / 200).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const current = path[path.length - 1]!;
  const last = path.length > 1 ? Math.abs(path[path.length - 1]! - path[path.length - 2]!) : Infinity;
  const diverging = path.length > 3 && Math.abs(current) > Math.abs(path[0]!) * 1.5 + 1;
  const oscillating = path.length > 4 && Math.sign(path.at(-1)! - path.at(-2)!) !== Math.sign(path.at(-2)! - path.at(-3)!) && !diverging;
  const converged = last < 1e-4 && Math.abs(fn.df(current)) < 1e-3;
  const status = diverging ? "Diverging: the learning rate is too large." : converged ? `Converged after ${path.length - 1} steps.` : oscillating ? "Oscillating around the minimum: try a smaller learning rate." : `Step ${path.length - 1}`;

  const losses = path.map((p) => fn.f(p));
  const lx = linear([0, Math.max(10, path.length - 1)], [MARGIN.left, 260 - MARGIN.right]);
  const finiteLosses = losses.filter((l) => Number.isFinite(l) && Math.abs(l) < 1e6);
  const ly = linear([Math.min(...finiteLosses, 0), Math.max(...finiteLosses, 1)], [140 - MARGIN.bottom, MARGIN.top]);

  return (
    <VizFrame
      title="Gradient descent"
      controls={
        <>
          <SelectField label="Loss function" value={fnId} onChange={(e) => setFnId(e.target.value)} options={FUNCTIONS.map((f) => ({ value: f.id, label: f.label }))} />
          <Slider label="Learning rate α" value={lr} min={0.005} max={1.2} step={0.005} onChange={(v) => { setLr(v); reset(); }} />
          <Slider label="Start x₀" value={start} min={fn.domain[0]} max={fn.domain[1]} step={0.05} onChange={(v) => { setStart(v); reset(v); }} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" icon={running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} onClick={() => setRunning((r) => !r)}>
              {running ? "Pause" : "Run"}
            </Button>
            <Button size="sm" icon={<StepForward className="size-3.5" />} onClick={step}>
              Step
            </Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => reset()}>
              Reset
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-y-1 text-xs">
            <dt className="text-muted">x</dt>
            <dd className="text-right tabular-nums">{fmt(current, 4)}</dd>
            <dt className="text-muted">f(x)</dt>
            <dd className="text-right tabular-nums">{fmt(fn.f(current), 4)}</dd>
            <dt className="text-muted">f′(x)</dt>
            <dd className="text-right tabular-nums">{fmt(fn.df(current), 4)}</dd>
          </dl>
          <p className={diverging ? "text-xs text-danger" : converged ? "text-xs text-success" : "text-xs text-muted"} aria-live="polite">
            {status}
          </p>
        </>
      }
      footer="Each step moves against the slope: x ← x − α·f′(x). Small α converges slowly, a well-chosen α converges quickly, and too large an α overshoots and diverges. On the non-convex function the starting point decides which minimum you end up in."
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Loss curve with gradient descent path; currently at x = ${fmt(current, 3)}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHoverX(px >= MARGIN.left && px <= W - MARGIN.right ? x.invert(px) : null);
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        <Axes x={x} y={y} width={W} height={H} xLabel="x" yLabel="f(x)" />
        <ClipRect width={W} height={H}>
          {(clip) => (
            <g clipPath={clip}>
              <path d={curve} fill="none" stroke="var(--chart-1)" strokeWidth={2} />
              {path.slice(1).map((p, i) => (
                <line key={i} x1={x(path[i]!)} y1={y(fn.f(path[i]!))} x2={x(p)} y2={y(fn.f(p))} stroke="var(--chart-2)" strokeWidth={1.5} strokeDasharray="3 2" />
              ))}
              {path.map((p, i) => (
                <circle key={i} cx={x(p)} cy={y(fn.f(p))} r={i === path.length - 1 ? 6 : 3} fill="var(--chart-2)" stroke="var(--surface)" strokeWidth={2} />
              ))}
              {hoverX != null && (
                <g pointerEvents="none">
                  <line x1={x(hoverX)} x2={x(hoverX)} y1={MARGIN.top} y2={H - MARGIN.bottom} stroke="var(--muted)" strokeDasharray="2 3" />
                  <circle cx={x(hoverX)} cy={y(fn.f(hoverX))} r={4} fill="var(--fg)" />
                  <text x={x(hoverX) + 6} y={MARGIN.top + 12} fontSize={11} fill="var(--fg)">
                    x={fmt(hoverX, 2)}, f={fmt(fn.f(hoverX), 2)}, f′={fmt(fn.df(hoverX), 2)}
                  </text>
                </g>
              )}
            </g>
          )}
        </ClipRect>
      </svg>
      <p className="mt-2 mb-1 text-xs text-muted">Loss per step</p>
      <svg viewBox="0 0 260 140" className="w-1/2" role="img" aria-label="Loss per iteration">
        <Axes x={lx} y={ly} width={260} height={140} xLabel="step" />
        <path d={losses.map((l, i) => (Number.isFinite(l) ? `${i ? "L" : "M"}${lx(i)},${ly(Math.min(l, ly.domain[1]))}` : "")).join("")} fill="none" stroke="var(--chart-1)" strokeWidth={2} />
      </svg>
    </VizFrame>
  );
}

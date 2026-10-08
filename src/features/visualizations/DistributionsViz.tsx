import { useMemo, useState } from "react";
import { Dices, Eraser } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { DEFAULT_PARAMS, density, isDiscrete, moments, sample, support, type DistId, type DistParams } from "./distributions";
import { Axes, fmt, linear, MARGIN, Slider, VizFrame } from "./plot";

const W = 520;
const H = 300;
const SAMPLE_N = 1000;

const LABELS: Record<DistId, string> = {
  normal: "Normal N(μ, σ²)",
  binomial: "Binomial B(n, p)",
  poisson: "Poisson(λ)",
  uniform: "Uniform U(a, b)",
  exponential: "Exponential(λ)",
};

export default function DistributionsViz() {
  const [dist, setDist] = useState<DistId>("normal");
  const [p, setP] = useState<DistParams>(DEFAULT_PARAMS);
  const [samples, setSamples] = useState<number[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const set = (k: keyof DistParams, v: number) => {
    setP((x) => ({ ...x, [k]: v }));
    setSamples([]);
  };

  const discrete = isDiscrete(dist);
  const [lo, hi] = support(dist, p);
  const { mean, variance } = moments(dist, p);
  const xs = useMemo(
    () => (discrete ? Array.from({ length: Math.round(hi - lo) + 1 }, (_, i) => lo + i) : Array.from({ length: 241 }, (_, i) => lo + ((hi - lo) * i) / 240)),
    [discrete, lo, hi],
  );
  const ys = xs.map((v) => density(dist, p, v));

  // Histogram of samples, scaled to a density so it overlays the curve.
  const hist = useMemo(() => {
    if (!samples.length) return [];
    if (discrete) {
      const counts = new Map<number, number>();
      for (const s of samples) counts.set(s, (counts.get(s) ?? 0) + 1);
      return xs.map((v) => ({ x0: v - 0.4, x1: v + 0.4, h: (counts.get(v) ?? 0) / samples.length }));
    }
    const bins = 30;
    const width = (hi - lo) / bins;
    const counts = new Array<number>(bins).fill(0);
    for (const s of samples) {
      const i = Math.floor((s - lo) / width);
      if (i >= 0 && i < bins) counts[i]!++;
    }
    return counts.map((c, i) => ({ x0: lo + i * width, x1: lo + (i + 1) * width, h: c / samples.length / width }));
  }, [samples, discrete, xs, lo, hi]);

  const yMax = Math.max(...ys, ...hist.map((b) => b.h), 1e-6) * 1.1;
  const x = linear([lo - (discrete ? 0.6 : 0), hi + (discrete ? 0.6 : 0)], [MARGIN.left, W - MARGIN.right]);
  const y = linear([0, yMax], [H - MARGIN.bottom, MARGIN.top]);
  const sampleMean = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
  const sampleVar = sampleMean != null && samples.length > 1 ? samples.reduce((a, b) => a + (b - sampleMean) ** 2, 0) / (samples.length - 1) : null;
  const barW = Math.max(2, x(lo + 0.7) - x(lo) - 2);

  return (
    <VizFrame
      title="Probability distributions"
      controls={
        <>
          <SelectField
            label="Distribution"
            value={dist}
            onChange={(e) => {
              setDist(e.target.value as DistId);
              setSamples([]);
            }}
            options={(Object.keys(LABELS) as DistId[]).map((d) => ({ value: d, label: LABELS[d] }))}
          />
          {dist === "normal" && (
            <>
              <Slider label="Mean μ" value={p.mu} min={-5} max={5} step={0.1} onChange={(v) => set("mu", v)} />
              <Slider label="Std dev σ" value={p.sigma} min={0.2} max={4} step={0.05} onChange={(v) => set("sigma", v)} />
            </>
          )}
          {dist === "binomial" && (
            <>
              <Slider label="Trials n" value={p.n} min={1} max={60} step={1} format={(v) => String(v)} onChange={(v) => set("n", v)} />
              <Slider label="Success p" value={p.p} min={0.01} max={0.99} step={0.01} onChange={(v) => set("p", v)} />
            </>
          )}
          {dist === "poisson" && <Slider label="Rate λ" value={p.lambda} min={0.2} max={25} step={0.1} onChange={(v) => set("lambda", v)} />}
          {dist === "uniform" && (
            <>
              <Slider label="a" value={p.a} min={-5} max={4.5} step={0.1} onChange={(v) => set("a", Math.min(v, p.b - 0.1))} />
              <Slider label="b" value={p.b} min={-4.5} max={5} step={0.1} onChange={(v) => set("b", Math.max(v, p.a + 0.1))} />
            </>
          )}
          {dist === "exponential" && <Slider label="Rate λ" value={p.rate} min={0.1} max={5} step={0.05} onChange={(v) => set("rate", v)} />}
          <dl className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-xs">
            <dt />
            <dd className="text-muted">Theory</dd>
            <dd className="text-muted">Sample</dd>
            <dt className="text-muted">Mean</dt>
            <dd className="text-right tabular-nums">{fmt(mean, 3)}</dd>
            <dd className="text-right tabular-nums">{sampleMean != null ? fmt(sampleMean, 3) : "—"}</dd>
            <dt className="text-muted">Variance</dt>
            <dd className="text-right tabular-nums">{fmt(variance, 3)}</dd>
            <dd className="text-right tabular-nums">{sampleVar != null ? fmt(sampleVar, 3) : "—"}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" icon={<Dices className="size-3.5" />} onClick={() => setSamples(Array.from({ length: SAMPLE_N }, () => sample(dist, p)))}>
              Draw {SAMPLE_N}
            </Button>
            {samples.length > 0 && (
              <Button size="sm" variant="ghost" icon={<Eraser className="size-3.5" />} onClick={() => setSamples([])}>
                Clear
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setAsTable((t) => !t)}>
              {asTable ? "Chart" : "Table"}
            </Button>
          </div>
        </>
      }
      footer={`${discrete ? "Bars show P(X = k)" : "The curve is the density f(x); areas under it are probabilities"}. Drawing samples overlays a histogram: with ${SAMPLE_N} draws the sample mean and variance land close to the theoretical values (the law of large numbers).`}
    >
      {asTable ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 font-medium">{discrete ? "k" : "x"}</th>
                <th className="py-1 text-right font-medium">{discrete ? "P(X = k)" : "f(x)"}</th>
              </tr>
            </thead>
            <tbody>
              {xs.filter((_, i) => discrete || i % 12 === 0).map((v) => (
                <tr key={v} className="border-t border-border">
                  <td className="py-0.5 tabular-nums">{fmt(v, 2)}</td>
                  <td className="py-0.5 text-right tabular-nums">{density(dist, p, v).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`${LABELS[dist]}: mean ${fmt(mean, 2)}, variance ${fmt(variance, 2)}`}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const v = x.invert(((e.clientX - r.left) / r.width) * W);
            setHover(v >= lo && v <= hi ? (discrete ? Math.round(v) : v) : null);
          }}
          onMouseLeave={() => setHover(null)}
        >
          <Axes x={x} y={y} width={W} height={H} xLabel={discrete ? "k" : "x"} yLabel={discrete ? "P(X = k)" : "f(x)"} />
          {hist.map((b, i) => (
            <rect key={i} x={x(b.x0) + 1} y={y(b.h)} width={Math.max(1, x(b.x1) - x(b.x0) - 2)} height={y(0) - y(b.h)} fill="var(--chart-2)" opacity={0.45} rx={2} />
          ))}
          {discrete
            ? xs.map((v, i) => <rect key={v} x={x(v) - barW / 2} y={y(ys[i]!)} width={barW} height={y(0) - y(ys[i]!)} fill="var(--chart-1)" rx={3} opacity={samples.length ? 0.85 : 1} />)
            : <path d={xs.map((v, i) => `${i ? "L" : "M"}${x(v).toFixed(1)},${y(ys[i]!).toFixed(1)}`).join("")} fill="none" stroke="var(--chart-1)" strokeWidth={2} />}
          <line x1={x(mean)} x2={x(mean)} y1={MARGIN.top} y2={y(0)} stroke="var(--muted)" strokeDasharray="4 3" />
          <text x={x(mean) + 4} y={MARGIN.top + 10} fontSize={10} fill="var(--muted)">
            mean
          </text>
          {hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={MARGIN.top} y2={y(0)} stroke="var(--fg)" strokeOpacity={0.4} />
              <text x={x(hover) + 6} y={MARGIN.top + 24} fontSize={11} fill="var(--fg)">
                {discrete ? `P(X=${hover}) = ${density(dist, p, hover).toFixed(4)}` : `f(${fmt(hover, 2)}) = ${density(dist, p, hover).toFixed(4)}`}
              </text>
            </g>
          )}
        </svg>
      )}
    </VizFrame>
  );
}

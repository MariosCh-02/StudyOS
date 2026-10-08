import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { ProbabilityGrid } from "./DecisionBoundaryViz";
import { accuracy, initMlp, makeDataset, mlpForward, mlpLoss, mlpStep, type Activation, type DatasetId, type Mlp } from "./models";
import { Axes, ClassLegend, fmt, linear, MARGIN, Marker, Slider, VizFrame } from "./plot";

const S = 300;
const NET_W = 300;
const NET_H = 220;

/** Network diagram: edge width = |weight|, colour = sign (solid vs dashed as secondary encoding). */
function NetworkDiagram({ m }: { m: Mlp }) {
  const col = (i: number, n: number) => 30 + ((NET_H - 60) * (i + 0.5)) / n;
  const inputs = [0, 1].map((i) => ({ x: 40, y: col(i, 2) + 20 }));
  const hidden = Array.from({ length: m.hidden }, (_, i) => ({ x: NET_W / 2, y: col(i, m.hidden) + 20 }));
  const out = { x: NET_W - 40, y: NET_H / 2 + 10 };
  const maxW = Math.max(1e-6, ...m.W1.flat().map(Math.abs), ...m.W2.map(Math.abs));
  const edge = (w: number) => ({ stroke: w >= 0 ? "var(--chart-1)" : "var(--chart-2)", strokeWidth: 0.5 + (Math.abs(w) / maxW) * 4, strokeDasharray: w >= 0 ? undefined : "4 3" });
  return (
    <svg viewBox={`0 0 ${NET_W} ${NET_H}`} className="w-full" role="img" aria-label={`Network with 2 inputs, ${m.hidden} hidden units and 1 output`}>
      {hidden.map((h, i) => inputs.map((inp, j) => <line key={`a${i}${j}`} x1={inp.x} y1={inp.y} x2={h.x} y2={h.y} {...edge(m.W1[i]![j]!)}><title>{`w = ${fmt(m.W1[i]![j]!, 3)}`}</title></line>))}
      {hidden.map((h, i) => (
        <line key={`b${i}`} x1={h.x} y1={h.y} x2={out.x} y2={out.y} {...edge(m.W2[i]!)}>
          <title>{`w = ${fmt(m.W2[i]!, 3)}`}</title>
        </line>
      ))}
      {[...inputs, ...hidden, out].map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y} r={9} fill="var(--surface-2)" stroke="var(--muted)" strokeWidth={1.5} />
      ))}
      <g fontSize={10} fill="var(--muted)" textAnchor="middle">
        <text x={40} y={14}>input</text>
        <text x={NET_W / 2} y={14}>hidden ({m.activation})</text>
        <text x={NET_W - 40} y={14}>output σ</text>
      </g>
    </svg>
  );
}

export default function NeuralNetworkViz() {
  const [dataset, setDataset] = useState<DatasetId>("xor");
  const points = useMemo(() => makeDataset(dataset, 100), [dataset]);
  const [hidden, setHidden] = useState(4);
  const [activation, setActivation] = useState<Activation>("tanh");
  const [lr, setLr] = useState(0.5);
  const [seed, setSeed] = useState(1);
  const [net, setNet] = useState(() => initMlp(4, "tanh", 1));
  const [epoch, setEpoch] = useState(0);
  const [losses, setLosses] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const netRef = useRef(net);
  netRef.current = net;

  const reset = (h = hidden, a = activation, s = seed) => {
    const m = initMlp(h, a, s);
    setNet(m);
    setEpoch(0);
    setLosses([mlpLoss(m, points)]);
    setRunning(false);
  };
  useEffect(() => {
    reset();
  }, [dataset]);

  const train = (epochs: number) => {
    let m = netRef.current;
    for (let i = 0; i < epochs; i++) m = mlpStep(m, points, lr);
    setNet(m);
    setEpoch((e) => e + epochs);
    setLosses((l) => [...l, mlpLoss(m, points)].slice(-300));
  };

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => train(10), 60);
    return () => clearInterval(t);
  }, [running, lr, points]);

  const x = linear([-1, 1], [MARGIN.left, S - MARGIN.right]);
  const y = linear([-1, 1], [S - MARGIN.bottom, MARGIN.top]);
  const proba = (px: number, py: number) => mlpForward(net, px, py).p;
  const acc = accuracy(points, proba);
  const lossNow = losses.at(-1) ?? mlpLoss(net, points);
  const lx = linear([0, Math.max(1, losses.length - 1)], [MARGIN.left, 300 - MARGIN.right]);
  const ly = linear([0, Math.max(0.8, ...losses)], [130 - MARGIN.bottom, MARGIN.top]);

  return (
    <VizFrame
      title="Neural network training"
      controls={
        <>
          <SelectField label="Data" value={dataset} onChange={(e) => setDataset(e.target.value as DatasetId)} options={[{ value: "xor", label: "XOR" }, { value: "circle", label: "Circle" }, { value: "linear", label: "Linear" }]} />
          <SelectField
            label="Activation"
            value={activation}
            onChange={(e) => {
              setActivation(e.target.value as Activation);
              reset(hidden, e.target.value as Activation);
            }}
            options={[{ value: "tanh", label: "tanh" }, { value: "relu", label: "ReLU" }]}
          />
          <Slider label="Hidden units" value={hidden} min={1} max={8} step={1} format={(v) => String(v)} onChange={(v) => { setHidden(v); reset(v); }} />
          <Slider label="Learning rate" value={lr} min={0.01} max={2} step={0.01} onChange={setLr} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" icon={running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} onClick={() => setRunning((r) => !r)}>
              {running ? "Pause" : "Train"}
            </Button>
            <Button size="sm" icon={<StepForward className="size-3.5" />} onClick={() => train(1)}>
              1 epoch
            </Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => { const s = seed + 1; setSeed(s); reset(hidden, activation, s); }}>
              New weights
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-y-1 text-xs">
            <dt className="text-muted">Epoch</dt>
            <dd className="text-right tabular-nums">{epoch}</dd>
            <dt className="text-muted">Loss (cross-entropy)</dt>
            <dd className="text-right tabular-nums">{fmt(lossNow, 4)}</dd>
            <dt className="text-muted">Accuracy</dt>
            <dd className="text-right tabular-nums">{Math.round(acc * 100)}%</dd>
          </dl>
        </>
      }
      footer="Each epoch runs a forward pass, computes the loss, backpropagates gradients with the chain rule and updates every weight. With 1 hidden unit the network can only draw a straight line; XOR needs at least 2. Thicker edges are larger weights; solid edges are positive, dashed are negative."
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <ClassLegend />
          <svg viewBox={`0 0 ${S} ${S}`} className="mt-2 w-full" role="img" aria-label={`Decision region after ${epoch} epochs, ${Math.round(acc * 100)}% accuracy`}>
            <ProbabilityGrid proba={proba} x={x} y={y} />
            <Axes x={x} y={y} width={S} height={S} plain />
            {points.map((p, i) => (
              <Marker key={i} x={x(p.x)} y={y(p.y)} cls={p.cls} r={4} />
            ))}
          </svg>
        </div>
        <div className="flex flex-col gap-2">
          <NetworkDiagram m={net} />
          <p className="text-xs text-muted">Loss over training</p>
          <svg viewBox="0 0 300 130" className="w-full" role="img" aria-label="Training loss curve">
            <Axes x={lx} y={ly} width={300} height={130} />
            <path d={losses.map((l, i) => `${i ? "L" : "M"}${lx(i).toFixed(1)},${ly(l).toFixed(1)}`).join("")} fill="none" stroke="var(--chart-1)" strokeWidth={2} />
          </svg>
        </div>
      </div>
    </VizFrame>
  );
}

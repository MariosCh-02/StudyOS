import { useMemo, useState } from "react";
import clsx from "clsx";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { accuracy, knnProba, logisticProba, makeDataset, trainLogistic, type DatasetId, type LabeledPoint } from "./models";
import { Axes, ClassLegend, linear, MARGIN, Marker, Slider, VizFrame } from "./plot";

const W = 420;
const H = 420;
const GRID = 36;
const D: [number, number] = [-1, 1];

type Model = "logistic" | "logistic2" | "knn";

/** Shaded probability grid: colour = predicted class, opacity = confidence. */
export function ProbabilityGrid({ proba, x, y }: { proba: (x: number, y: number) => number; x: ReturnType<typeof linear>; y: ReturnType<typeof linear> }) {
  const cell = (D[1] - D[0]) / GRID;
  const cells = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const cx = D[0] + (i + 0.5) * cell;
      const cy = D[0] + (j + 0.5) * cell;
      const p = proba(cx, cy);
      cells.push(
        <rect
          key={`${i}-${j}`}
          x={x(D[0] + i * cell)}
          y={y(D[0] + (j + 1) * cell)}
          width={x(D[0] + cell) - x(D[0]) + 0.5}
          height={y(D[0]) - y(D[0] + cell) + 0.5}
          fill={p >= 0.5 ? "var(--chart-2)" : "var(--chart-1)"}
          opacity={0.08 + Math.abs(p - 0.5) * 0.5}
        />,
      );
    }
  }
  return <g pointerEvents="none">{cells}</g>;
}

export default function DecisionBoundaryViz() {
  const [dataset, setDataset] = useState<DatasetId>("linear");
  const [points, setPoints] = useState<LabeledPoint[]>(() => makeDataset("linear", 60));
  const [model, setModel] = useState<Model>("logistic");
  const [k, setK] = useState(5);
  const [brush, setBrush] = useState<0 | 1>(0);
  const x = linear(D, [MARGIN.left, W - MARGIN.right]);
  const y = linear(D, [H - MARGIN.bottom, MARGIN.top]);

  const proba = useMemo(() => {
    if (model === "knn") return (px: number, py: number) => knnProba(points, k, px, py);
    const m = trainLogistic(points, model === "logistic" ? "linear" : "quadratic", model === "logistic" ? 600 : 1500);
    return (px: number, py: number) => logisticProba(m, px, py);
  }, [points, model, k]);
  const acc = accuracy(points, proba);

  const add = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = x.invert(((e.clientX - r.left) / r.width) * W);
    const vy = y.invert(((e.clientY - r.top) / r.height) * H);
    if (vx < -1 || vx > 1 || vy < -1 || vy > 1) return;
    setPoints((p) => [...p, { x: vx, y: vy, cls: brush }]);
  };

  return (
    <VizFrame
      title="Classification decision boundary"
      controls={
        <>
          <SelectField
            label="Data"
            value={dataset}
            onChange={(e) => {
              const id = e.target.value as DatasetId;
              setDataset(id);
              setPoints(makeDataset(id, 60));
            }}
            options={[
              { value: "linear", label: "Linearly separable" },
              { value: "xor", label: "XOR (quadrants)" },
              { value: "circle", label: "Circle" },
            ]}
          />
          <SelectField
            label="Model"
            value={model}
            onChange={(e) => setModel(e.target.value as Model)}
            options={[
              { value: "logistic", label: "Logistic regression (x, y)" },
              { value: "logistic2", label: "Logistic regression + x², y², xy" },
              { value: "knn", label: "k-nearest neighbours" },
            ]}
          />
          {model === "knn" && <Slider label="k" value={k} min={1} max={25} step={1} onChange={setK} format={(v) => String(v)} />}
          <div>
            <p className="mb-1 text-xs text-muted">Click adds a point of</p>
            <div role="radiogroup" aria-label="Class to add" className="flex gap-1">
              {([0, 1] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={brush === c}
                  onClick={() => setBrush(c)}
                  className={clsx("flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs", brush === c ? "border-accent bg-accent-soft" : "border-border text-muted")}
                >
                  <svg width={10} height={10} aria-hidden>
                    <Marker x={5} y={5} cls={c} r={4} />
                  </svg>
                  Class {c ? "B" : "A"}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm">
            Training accuracy: <span className="font-semibold tabular-nums">{Math.round(acc * 100)}%</span>
          </p>
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setPoints([])}>
            Clear points
          </Button>
        </>
      }
      footer="Shading shows the predicted class (colour) and how confident the model is (stronger = more confident). Plain logistic regression can only draw a straight line, so it fails on XOR and the circle until you add quadratic features. k-NN with small k follows every point and overfits; larger k gives smoother boundaries."
    >
      <ClassLegend />
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full max-w-[420px] cursor-crosshair" role="img" aria-label={`Decision regions of the ${model} model, ${Math.round(acc * 100)}% training accuracy`} onClick={add}>
        <ProbabilityGrid proba={proba} x={x} y={y} />
        <Axes x={x} y={y} width={W} height={H} plain />
        {points.map((p, i) => (
          <Marker key={i} x={x(p.x)} y={y(p.y)} cls={p.cls} title={`Class ${p.cls ? "B" : "A"}: P(B) = ${proba(p.x, p.y).toFixed(2)}`} />
        ))}
      </svg>
    </VizFrame>
  );
}

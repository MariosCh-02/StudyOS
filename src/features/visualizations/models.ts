/**
 * Tiny, dependency-free models used by the visualizations. They are real
 * implementations (gradient descent, backpropagation), kept small enough to
 * train interactively in the browser.
 */

export interface LabeledPoint {
  x: number;
  y: number;
  cls: 0 | 1;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

// ------------------------------------------------------ logistic regression

export type FeatureMap = "linear" | "quadratic";

export function features(x: number, y: number, map: FeatureMap): number[] {
  return map === "linear" ? [1, x, y] : [1, x, y, x * x, y * y, x * y];
}

export interface Logistic {
  weights: number[];
  map: FeatureMap;
}

/** Full-batch gradient descent on the (L2-regularised) cross-entropy loss. */
export function trainLogistic(points: LabeledPoint[], map: FeatureMap, iterations = 600, lr = 0.5, l2 = 1e-3): Logistic {
  const dim = features(0, 0, map).length;
  const w = new Array<number>(dim).fill(0);
  if (!points.length) return { weights: w, map };
  const X = points.map((p) => features(p.x, p.y, map));
  for (let it = 0; it < iterations; it++) {
    const grad = new Array<number>(dim).fill(0);
    for (let i = 0; i < X.length; i++) {
      const xi = X[i]!;
      const err = sigmoid(xi.reduce((s, v, j) => s + v * w[j]!, 0)) - points[i]!.cls;
      for (let j = 0; j < dim; j++) grad[j]! += err * xi[j]!;
    }
    for (let j = 0; j < dim; j++) w[j] = w[j]! - lr * (grad[j]! / X.length + (j ? l2 * w[j]! : 0));
  }
  return { weights: w, map };
}

export const logisticProba = (m: Logistic, x: number, y: number) => sigmoid(features(x, y, m.map).reduce((s, v, j) => s + v * m.weights[j]!, 0));

// ------------------------------------------------------------------- k-NN

/** Share of class-1 points among the k nearest neighbours. */
export function knnProba(points: LabeledPoint[], k: number, x: number, y: number): number {
  if (!points.length) return 0.5;
  const nearest = points
    .map((p) => ({ d: (p.x - x) ** 2 + (p.y - y) ** 2, cls: p.cls }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(1, Math.min(k, points.length)));
  return nearest.reduce((s, p) => s + p.cls, 0) / nearest.length;
}

export function accuracy(points: LabeledPoint[], proba: (x: number, y: number) => number): number {
  if (!points.length) return 0;
  return points.filter((p) => (proba(p.x, p.y) >= 0.5 ? 1 : 0) === p.cls).length / points.length;
}

// ------------------------------------------------------------ neural network

export type Activation = "tanh" | "relu";

/** 2 → H → 1 network: hidden activation, sigmoid output, binary cross-entropy. */
export interface Mlp {
  hidden: number;
  activation: Activation;
  W1: number[][]; // [H][2]
  b1: number[];
  W2: number[]; // [H]
  b2: number;
}

/** Small seeded PRNG so "Reset" reproduces the same start. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function initMlp(hidden: number, activation: Activation, seed = 1): Mlp {
  const r = rng(seed);
  const scale = activation === "relu" ? Math.sqrt(2 / 2) : Math.sqrt(1 / 2);
  return {
    hidden,
    activation,
    W1: Array.from({ length: hidden }, () => [(r() * 2 - 1) * scale * 1.5, (r() * 2 - 1) * scale * 1.5]),
    b1: Array.from({ length: hidden }, () => (r() * 2 - 1) * 0.1),
    W2: Array.from({ length: hidden }, () => (r() * 2 - 1) * Math.sqrt(1 / hidden)),
    b2: 0,
  };
}

const act = (a: Activation, z: number) => (a === "tanh" ? Math.tanh(z) : Math.max(0, z));
const dact = (a: Activation, z: number, h: number) => (a === "tanh" ? 1 - h * h : z > 0 ? 1 : 0);

export function mlpForward(m: Mlp, x: number, y: number): { z1: number[]; h: number[]; p: number } {
  const z1 = m.W1.map((w, i) => w[0]! * x + w[1]! * y + m.b1[i]!);
  const h = z1.map((z) => act(m.activation, z));
  const p = sigmoid(h.reduce((s, v, i) => s + v * m.W2[i]!, m.b2));
  return { z1, h, p };
}

export function mlpLoss(m: Mlp, points: LabeledPoint[]): number {
  if (!points.length) return 0;
  const eps = 1e-9;
  return -points.reduce((s, pt) => {
    const p = mlpForward(m, pt.x, pt.y).p;
    return s + (pt.cls ? Math.log(p + eps) : Math.log(1 - p + eps));
  }, 0) / points.length;
}

/** One epoch of full-batch gradient descent via backpropagation. Returns a new network. */
export function mlpStep(m: Mlp, points: LabeledPoint[], lr: number): Mlp {
  if (!points.length) return m;
  const H = m.hidden;
  const gW1 = Array.from({ length: H }, () => [0, 0]);
  const gb1 = new Array<number>(H).fill(0);
  const gW2 = new Array<number>(H).fill(0);
  let gb2 = 0;
  for (const pt of points) {
    const { z1, h, p } = mlpForward(m, pt.x, pt.y);
    const dz2 = p - pt.cls; // dL/dz for sigmoid + cross-entropy
    gb2 += dz2;
    for (let i = 0; i < H; i++) {
      gW2[i]! += dz2 * h[i]!;
      const dz1 = dz2 * m.W2[i]! * dact(m.activation, z1[i]!, h[i]!);
      gW1[i]![0]! += dz1 * pt.x;
      gW1[i]![1]! += dz1 * pt.y;
      gb1[i]! += dz1;
    }
  }
  const n = points.length;
  return {
    ...m,
    W1: m.W1.map((w, i) => [w[0]! - (lr * gW1[i]![0]!) / n, w[1]! - (lr * gW1[i]![1]!) / n]),
    b1: m.b1.map((b, i) => b - (lr * gb1[i]!) / n),
    W2: m.W2.map((w, i) => w - (lr * gW2[i]!) / n),
    b2: m.b2 - (lr * gb2) / n,
  };
}

// --------------------------------------------------------------- datasets

export type DatasetId = "linear" | "xor" | "circle";

export function makeDataset(id: DatasetId, n = 80, seed = 7): LabeledPoint[] {
  const r = rng(seed);
  const pts: LabeledPoint[] = [];
  for (let i = 0; i < n; i++) {
    const x = r() * 2 - 1;
    const y = r() * 2 - 1;
    const noise = (r() - 0.5) * 0.15;
    const cls = id === "linear" ? (y > 0.6 * x + noise ? 1 : 0) : id === "xor" ? (x * y + noise > 0 ? 1 : 0) : (Math.hypot(x, y) + noise < 0.55 ? 1 : 0);
    pts.push({ x, y, cls });
  }
  return pts;
}

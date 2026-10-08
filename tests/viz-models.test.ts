import { describe, expect, it } from "vitest";
import { accuracy, initMlp, knnProba, logisticProba, makeDataset, mlpForward, mlpLoss, mlpStep, trainLogistic } from "../src/features/visualizations/models";
import { leastSquares, mse } from "../src/features/visualizations/LinearRegressionViz";

describe("visualization models", () => {
  it("least squares recovers an exact line", () => {
    const pts: [number, number][] = [0, 1, 2, 3, 4].map((x) => [x, 2 * x + 1]);
    expect(leastSquares(pts)).toEqual({ w: 2, b: 1 });
    expect(mse(pts, 2, 1)).toBe(0);
    expect(leastSquares([[1, 1]])).toBeNull();
  });

  it("logistic regression separates linear data but needs quadratic features for a circle", () => {
    const lin = makeDataset("linear");
    expect(accuracy(lin, (x, y) => logisticProba(trainLogistic(lin, "linear"), x, y))).toBeGreaterThan(0.9);
    const circle = makeDataset("circle");
    const linearOnCircle = accuracy(circle, (x, y) => logisticProba(trainLogistic(circle, "linear"), x, y));
    const quadOnCircle = accuracy(circle, (x, y) => logisticProba(trainLogistic(circle, "quadratic", 1500), x, y));
    expect(quadOnCircle).toBeGreaterThan(0.85);
    expect(quadOnCircle).toBeGreaterThan(linearOnCircle);
  });

  it("k-NN with k=1 fits the training set", () => {
    const xor = makeDataset("xor");
    expect(accuracy(xor, (x, y) => knnProba(xor, 1, x, y))).toBe(1);
  });

  it("backpropagation reduces the loss and learns XOR", () => {
    const xor = makeDataset("xor");
    let m = initMlp(6, "tanh", 3);
    const before = mlpLoss(m, xor);
    for (let i = 0; i < 1500; i++) m = mlpStep(m, xor, 0.5);
    expect(mlpLoss(m, xor)).toBeLessThan(before / 2);
    expect(accuracy(xor, (x, y) => mlpForward(m, x, y).p)).toBeGreaterThan(0.85);
  });

  it("backprop gradient matches a numerical gradient", () => {
    const pts = makeDataset("circle", 20);
    const m = initMlp(3, "tanh", 5);
    const lr = 1e-3;
    const stepped = mlpStep(m, pts, lr);
    const analytic = (m.b2 - stepped.b2) / lr; // = dL/db2
    const h = 1e-5;
    const numeric = (mlpLoss({ ...m, b2: m.b2 + h }, pts) - mlpLoss({ ...m, b2: m.b2 - h }, pts)) / (2 * h);
    expect(analytic).toBeCloseTo(numeric, 5);
    const a2 = (m.W1[1]![0]! - stepped.W1[1]![0]!) / lr;
    const w = (d: number) => ({ ...m, W1: m.W1.map((row, i) => (i === 1 ? [row[0]! + d, row[1]!] : row)) });
    const n2 = (mlpLoss(w(h), pts) - mlpLoss(w(-h), pts)) / (2 * h);
    expect(a2).toBeCloseTo(n2, 5);
  });
});

import { DEFAULT_PARAMS, density, moments, sample } from "../src/features/visualizations/distributions";
import { rng } from "../src/features/visualizations/models";

describe("distributions", () => {
  const p = DEFAULT_PARAMS;
  it("matches known values", () => {
    expect(density("normal", p, 0)).toBeCloseTo(0.398942, 5);
    expect(density("binomial", { ...p, n: 4, p: 0.5 }, 2)).toBeCloseTo(0.375, 10);
    expect(density("poisson", { ...p, lambda: 2 }, 3)).toBeCloseTo(0.180447, 5);
    expect(density("uniform", { ...p, a: 0, b: 4 }, 1)).toBe(0.25);
    expect(density("exponential", { ...p, rate: 2 }, 0)).toBe(2);
    const total = Array.from({ length: 21 }, (_, k) => density("binomial", p, k)).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });
  it("samples with the right mean", () => {
    const r = rng(11);
    for (const d of ["normal", "binomial", "poisson", "uniform", "exponential"] as const) {
      const xs = Array.from({ length: 20000 }, () => sample(d, p, r));
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      const { mean, variance } = moments(d, p);
      expect(Math.abs(m - mean)).toBeLessThan(4 * Math.sqrt(variance / xs.length) + 1e-9);
    }
  });
});

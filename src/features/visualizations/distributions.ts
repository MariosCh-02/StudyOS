/** Probability distributions for the explorer: density/mass, moments and sampling. */

export type DistId = "normal" | "binomial" | "poisson" | "uniform" | "exponential";

export interface DistParams {
  mu: number;
  sigma: number;
  n: number;
  p: number;
  lambda: number;
  a: number;
  b: number;
  rate: number;
}

export const DEFAULT_PARAMS: DistParams = { mu: 0, sigma: 1, n: 20, p: 0.3, lambda: 4, a: 0, b: 1, rate: 1 };

export const isDiscrete = (d: DistId) => d === "binomial" || d === "poisson";

function logFactorial(k: number): number {
  let s = 0;
  for (let i = 2; i <= k; i++) s += Math.log(i);
  return s;
}

export function density(d: DistId, p: DistParams, x: number): number {
  switch (d) {
    case "normal":
      return Math.exp(-((x - p.mu) ** 2) / (2 * p.sigma ** 2)) / (p.sigma * Math.sqrt(2 * Math.PI));
    case "binomial": {
      if (!Number.isInteger(x) || x < 0 || x > p.n) return 0;
      return Math.exp(logFactorial(p.n) - logFactorial(x) - logFactorial(p.n - x) + x * Math.log(p.p) + (p.n - x) * Math.log(1 - p.p));
    }
    case "poisson":
      if (!Number.isInteger(x) || x < 0) return 0;
      return Math.exp(x * Math.log(p.lambda) - p.lambda - logFactorial(x));
    case "uniform":
      return x >= p.a && x <= p.b && p.b > p.a ? 1 / (p.b - p.a) : 0;
    case "exponential":
      return x >= 0 ? p.rate * Math.exp(-p.rate * x) : 0;
  }
}

export function moments(d: DistId, p: DistParams): { mean: number; variance: number } {
  switch (d) {
    case "normal":
      return { mean: p.mu, variance: p.sigma ** 2 };
    case "binomial":
      return { mean: p.n * p.p, variance: p.n * p.p * (1 - p.p) };
    case "poisson":
      return { mean: p.lambda, variance: p.lambda };
    case "uniform":
      return { mean: (p.a + p.b) / 2, variance: (p.b - p.a) ** 2 / 12 };
    case "exponential":
      return { mean: 1 / p.rate, variance: 1 / p.rate ** 2 };
  }
}

/** Plotting range covering almost all of the probability mass. */
export function support(d: DistId, p: DistParams): [number, number] {
  switch (d) {
    case "normal":
      return [p.mu - 4 * p.sigma, p.mu + 4 * p.sigma];
    case "binomial":
      return [0, p.n];
    case "poisson":
      return [0, Math.max(10, Math.ceil(p.lambda + 5 * Math.sqrt(p.lambda)))];
    case "uniform": {
      const pad = (p.b - p.a) * 0.25 || 0.5;
      return [p.a - pad, p.b + pad];
    }
    case "exponential":
      return [0, 6 / p.rate];
  }
}

export function sample(d: DistId, p: DistParams, random: () => number = Math.random): number {
  switch (d) {
    case "normal": {
      // Box–Muller
      const u = Math.max(random(), 1e-12);
      return p.mu + p.sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
    }
    case "binomial": {
      let k = 0;
      for (let i = 0; i < p.n; i++) if (random() < p.p) k++;
      return k;
    }
    case "poisson": {
      // Knuth's method (fine for the λ range offered).
      const L = Math.exp(-p.lambda);
      let k = 0;
      let prod = random();
      while (prod > L) {
        k++;
        prod *= random();
      }
      return k;
    }
    case "uniform":
      return p.a + (p.b - p.a) * random();
    case "exponential":
      return -Math.log(Math.max(1 - random(), 1e-12)) / p.rate;
  }
}

/**
 * Interactive visualizations available to lessons via `::viz[id]`.
 * Add an entry here and a component in registry.tsx to make a new one available.
 */
export interface VizInfo {
  id: string;
  title: string;
  description: string;
  subject: string;
}

export const VIZ_CATALOG: VizInfo[] = [
  { id: "gradient-descent", title: "Gradient descent", description: "Watch gradient descent walk down a loss curve; change the learning rate and see it converge, oscillate or diverge.", subject: "Calculus / Optimisation" },
  { id: "linear-regression", title: "Linear regression", description: "Add points, move the line yourself and compare your mean squared error with the least-squares fit.", subject: "Machine Learning" },
  { id: "decision-boundary", title: "Classification decision boundary", description: "Place points of two classes and see how logistic regression and k-nearest neighbours split the plane.", subject: "Machine Learning" },
  { id: "neural-network", title: "Neural network", description: "Train a small neural network on XOR or a circle and watch its weights, loss and decision region change.", subject: "Deep Learning" },
  { id: "distributions", title: "Statistical distributions", description: "Explore normal, binomial, Poisson, uniform and exponential distributions, and sample from them.", subject: "Probability & Statistics" },
];

export const VIZ_IDS = new Set(VIZ_CATALOG.map((v) => v.id));

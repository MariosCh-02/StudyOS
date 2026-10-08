import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { Spinner } from "@/components/ui/Feedback";
import { VIZ_CATALOG } from "./catalog";

/** Components for each catalog id, loaded on first use. */
const COMPONENTS: Record<string, LazyExoticComponent<ComponentType>> = {
  "gradient-descent": lazy(() => import("./GradientDescentViz")),
  "linear-regression": lazy(() => import("./LinearRegressionViz")),
  "decision-boundary": lazy(() => import("./DecisionBoundaryViz")),
  "neural-network": lazy(() => import("./NeuralNetworkViz")),
  distributions: lazy(() => import("./DistributionsViz")),
};

export function Visualization({ id }: { id: string }) {
  const Component = COMPONENTS[id];
  if (!Component) return <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">Unknown visualization “{id}”.</p>;
  return (
    <Suspense fallback={<Spinner label="Loading visualization…" />}>
      <Component />
    </Suspense>
  );
}

export { VIZ_CATALOG };

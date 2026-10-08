/**
 * Curriculum packs bundled with StudyOS. Each pack is loaded only when the
 * learner installs or updates it (code-split JSON).
 */
import type { PackV1 } from "@/services/packs";

export interface PackListing {
  id: string;
  version: number;
  title: string;
  description: string;
  load: () => Promise<PackV1>;
}

export const AVAILABLE_PACKS: PackListing[] = [
  {
    id: "ai-prep",
    version: 1,
    title: "AI Preparation",
    description:
      "MSc AI preparation: linear algebra, calculus, probability, statistics, Python/NumPy, machine learning, deep learning and algorithms (83 lessons, 300+ questions), a 50-question diagnostic, interactive visualizations and 7 guided projects.",
    load: () => import("./ai-prep").then((m) => m.buildAiPrepPack()),
  },
];

import { useState } from "react";
import clsx from "clsx";
import { VIZ_CATALOG } from "@/features/visualizations/catalog";
import { Visualization } from "@/features/visualizations/registry";

/** Gallery of every interactive visualization (they also appear inside lessons). */
export function VisualizationsTab() {
  const [active, setActive] = useState(VIZ_CATALOG[0]!.id);
  const current = VIZ_CATALOG.find((v) => v.id === active)!;
  return (
    <div className="grid grid-cols-[14rem_1fr] items-start gap-5">
      <nav aria-label="Visualizations" className="flex flex-col gap-1">
        {VIZ_CATALOG.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-current={active === v.id}
            onClick={() => setActive(v.id)}
            className={clsx("rounded-md px-3 py-2 text-left text-sm", active === v.id ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")}
          >
            {v.title}
            <span className="block text-xs text-subtle">{v.subject}</span>
          </button>
        ))}
      </nav>
      <div>
        <p className="mb-2 text-sm text-muted">{current.description}</p>
        <Visualization key={current.id} id={current.id} />
      </div>
    </div>
  );
}

import { useMemo } from "react";
import { Lightbulb } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { Visualization } from "@/features/visualizations/registry";

type Block = { kind: "md"; text: string } | { kind: "viz"; id: string } | { kind: "hint"; title: string; text: string };

/**
 * Splits lesson Markdown into blocks:
 *   ::viz[id]          → interactive visualization
 *   :::hint Title … ::: → collapsible hint (used by projects so solutions aren't shown upfront)
 * Directives inside fenced code blocks are left alone.
 */
export function parseLesson(source: string): Block[] {
  const blocks: Block[] = [];
  let md: string[] = [];
  let hint: { title: string; lines: string[] } | null = null;
  let inFence = false;
  const flush = () => {
    if (md.join("").trim()) blocks.push({ kind: "md", text: md.join("\n") });
    md = [];
  };
  for (const line of source.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && !hint) {
      const viz = /^::viz\[([a-z0-9-]+)\]\s*$/.exec(line);
      if (viz) {
        flush();
        blocks.push({ kind: "viz", id: viz[1]! });
        continue;
      }
      const h = /^:::hint\s*(.*)$/.exec(line);
      if (h) {
        flush();
        hint = { title: h[1]?.trim() || "Hint", lines: [] };
        continue;
      }
    }
    if (hint && !inFence && line.trim() === ":::") {
      blocks.push({ kind: "hint", title: hint.title, text: hint.lines.join("\n") });
      hint = null;
      continue;
    }
    (hint ? hint.lines : md).push(line);
  }
  if (hint) blocks.push({ kind: "hint", title: hint.title, text: hint.lines.join("\n") });
  flush();
  return blocks;
}

export function LessonContent({ source }: { source: string }) {
  const blocks = useMemo(() => parseLesson(source), [source]);
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((b, i) =>
        b.kind === "md" ? (
          <Markdown key={i} source={b.text} />
        ) : b.kind === "viz" ? (
          <Visualization key={i} id={b.id} />
        ) : (
          <details key={i} className="group rounded-lg border border-border bg-surface-2/40">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium select-none">
              <Lightbulb className="size-4 text-warning" aria-hidden />
              {b.title}
              <span className="ml-auto text-xs text-subtle group-open:hidden">Show hint</span>
            </summary>
            <div className="border-t border-border px-3 py-2">
              <Markdown source={b.text} />
            </div>
          </details>
        ),
      )}
    </div>
  );
}

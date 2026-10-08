import { describe, expect, it } from "vitest";
import { parseLesson } from "../src/features/practice/LessonContent";

describe("lesson directives", () => {
  it("splits visualizations and hints out of the Markdown", () => {
    const blocks = parseLesson(["## Intro", "", "::viz[gradient-descent]", "", ":::hint Hint 1: shapes", "Use `X.T @ X`.", ":::", "Done."].join("\n"));
    expect(blocks).toEqual([
      { kind: "md", text: "## Intro\n" },
      { kind: "viz", id: "gradient-descent" },
      { kind: "hint", title: "Hint 1: shapes", text: "Use `X.T @ X`." },
      { kind: "md", text: "Done." },
    ]);
  });

  it("ignores directives inside code fences", () => {
    const blocks = parseLesson(["```text", "::viz[distributions]", ":::hint not a hint", "```"].join("\n"));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("md");
  });

  it("keeps code fences inside hints intact", () => {
    const blocks = parseLesson([":::hint Skeleton", "```python", "def f():", "    pass  # :::", "```", ":::"].join("\n"));
    expect(blocks).toEqual([{ kind: "hint", title: "Skeleton", text: "```python\ndef f():\n    pass  # :::\n```" }]);
  });
});

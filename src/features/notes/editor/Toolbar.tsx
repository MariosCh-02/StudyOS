import type { ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import clsx from "clsx";
import { isMac, keys } from "@/lib/platform";
import {
  Bold,
  Code,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Sigma,
  SquareCode,
  Strikethrough,
  Table,
  Underline,
  Undo2,
  Radical,
  Layers,
  Lightbulb,
} from "lucide-react";

function Btn({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the editor selection
      onClick={onClick}
      className={clsx(
        "inline-flex size-7 items-center justify-center rounded transition-colors disabled:opacity-40",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px bg-border" aria-hidden />;

interface ToolbarProps {
  editor: Editor;
  onLink: () => void;
  onImage: () => void;
  onMath: (display: boolean) => void;
  onFlashcard?: () => void;
  onConcept?: () => void;
}

export function Toolbar({ editor, onLink, onImage, onMath, onFlashcard, onConcept }: ToolbarProps) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      highlight: e.isActive("highlight"),
      code: e.isActive("code"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      table: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();

  const setBlock = (v: string) => {
    if (v === "p") c().setParagraph().run();
    else c().toggleHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run();
  };

  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface px-2 py-1.5">
      <Btn label={keys("Undo (Ctrl+Z)")} disabled={!s.canUndo} onClick={() => c().undo().run()}>
        <Undo2 className="size-4" />
      </Btn>
      <Btn label={isMac ? "Redo (Cmd+Shift+Z)" : "Redo (Ctrl+Y)"} disabled={!s.canRedo} onClick={() => c().redo().run()}>
        <Redo2 className="size-4" />
      </Btn>
      <Sep />
      <select
        aria-label="Text style"
        value={s.block}
        onChange={(e) => setBlock(e.target.value)}
        className="h-7 rounded border border-transparent bg-transparent px-1 text-[13px] text-muted hover:border-border focus:outline-none"
      >
        <option value="p">Text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <Sep />
      <Btn label={keys("Bold (Ctrl+B)")} active={s.bold} onClick={() => c().toggleBold().run()}>
        <Bold className="size-4" />
      </Btn>
      <Btn label={keys("Italic (Ctrl+I)")} active={s.italic} onClick={() => c().toggleItalic().run()}>
        <Italic className="size-4" />
      </Btn>
      <Btn label={keys("Underline (Ctrl+U)")} active={s.underline} onClick={() => c().toggleUnderline().run()}>
        <Underline className="size-4" />
      </Btn>
      <Btn label={keys("Strikethrough (Ctrl+Shift+S)")} active={s.strike} onClick={() => c().toggleStrike().run()}>
        <Strikethrough className="size-4" />
      </Btn>
      <Btn label={keys("Highlight (Ctrl+Shift+H)")} active={s.highlight} onClick={() => c().toggleHighlight().run()}>
        <Highlighter className="size-4" />
      </Btn>
      <Btn label={keys("Inline code (Ctrl+E)")} active={s.code} onClick={() => c().toggleCode().run()}>
        <Code className="size-4" />
      </Btn>
      <Sep />
      <Btn label={keys("Bullet list (Ctrl+Shift+8)")} active={s.bullet} onClick={() => c().toggleBulletList().run()}>
        <List className="size-4" />
      </Btn>
      <Btn label={keys("Numbered list (Ctrl+Shift+7)")} active={s.ordered} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered className="size-4" />
      </Btn>
      <Btn label={keys("Checklist (Ctrl+Shift+9)")} active={s.task} onClick={() => c().toggleTaskList().run()}>
        <ListChecks className="size-4" />
      </Btn>
      <Sep />
      <Btn label={keys("Quote (Ctrl+Shift+B)")} active={s.quote} onClick={() => c().toggleBlockquote().run()}>
        <Quote className="size-4" />
      </Btn>
      <Btn label={keys("Code block (Ctrl+Alt+C)")} active={s.codeBlock} onClick={() => c().toggleCodeBlock().run()}>
        <SquareCode className="size-4" />
      </Btn>
      <Btn label="Divider" onClick={() => c().setHorizontalRule().run()}>
        <Minus className="size-4" />
      </Btn>
      <Sep />
      <Btn label={keys("Link (Ctrl+K)")} active={s.link} onClick={onLink}>
        <Link2 className="size-4" />
      </Btn>
      <Btn label="Image" onClick={onImage}>
        <ImageIcon className="size-4" />
      </Btn>
      <Btn label="Table" active={s.table} onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <Table className="size-4" />
      </Btn>
      <Sep />
      <Btn label={keys("Inline maths (Ctrl+M)")} onClick={() => onMath(false)}>
        <Radical className="size-4" />
      </Btn>
      <Btn label={keys("Equation (Ctrl+Shift+M)")} onClick={() => onMath(true)}>
        <Sigma className="size-4" />
      </Btn>
      {onFlashcard && (
        <>
          <Sep />
          <Btn label="Make a flashcard from the selection" onClick={onFlashcard}>
            <Layers className="size-4" />
          </Btn>
          {onConcept && (
            <Btn label="Save the selection as a concept in the knowledge base" onClick={onConcept}>
              <Lightbulb className="size-4" />
            </Btn>
          )}
        </>
      )}

      {s.table && (
        <div className="ml-auto flex items-center gap-1 text-[11px]">
          {(
            [
              ["+ Row", () => c().addRowAfter().run()],
              ["+ Column", () => c().addColumnAfter().run()],
              ["− Row", () => c().deleteRow().run()],
              ["− Column", () => c().deleteColumn().run()],
              ["Delete table", () => c().deleteTable().run()],
            ] as const
          ).map(([label, run]) => (
            <button
              key={label}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={run}
              className="h-6 rounded border border-border px-1.5 text-muted hover:text-fg"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

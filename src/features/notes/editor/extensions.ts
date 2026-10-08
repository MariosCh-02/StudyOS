import { Extension, type Extensions } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Mathematics } from "@tiptap/extension-mathematics";
import { Placeholder } from "@tiptap/extensions";
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";
import { AttachmentImage } from "./AttachmentImage";
import { CodeBlockView } from "./CodeBlockView";

// Only the languages offered in the code-block picker (keeps the editor bundle small).
const lowlight = createLowlight({ bash, cpp, csharp, java, javascript, json, plaintext, python, rust, sql, typescript, yaml });

export interface MathRequest {
  display: boolean;
  latex: string;
  /** Position of an existing node being edited; undefined when inserting. */
  pos?: number;
}

interface Callbacks {
  onMath: (req: MathRequest) => void;
  onLink: () => void;
}

export function buildExtensions({ onMath, onLink }: Callbacks, placeholder: string): Extensions {
  const Shortcuts = Extension.create({
    name: "studyosShortcuts",
    addKeyboardShortcuts() {
      return {
        "Mod-m": () => (onMath({ display: false, latex: "" }), true),
        "Mod-Shift-m": () => (onMath({ display: true, latex: "" }), true),
        "Mod-k": () => (onLink(), true),
      };
    },
  });

  return [
    StarterKit.configure({
      codeBlock: false, // replaced by the highlighted version below
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ["mailto"],
        isAllowedUri: (url, ctx) => /^(https?:|mailto:)/i.test(url) && ctx.defaultValidate(url),
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null },
      },
    }),
    CodeBlockLowlight.extend({
      addNodeView() {
        return ReactNodeViewRenderer(CodeBlockView);
      },
    }).configure({ lowlight, defaultLanguage: "plaintext" }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Highlight.configure({ multicolor: false }),
    AttachmentImage,
    Mathematics.configure({
      katexOptions: { throwOnError: false, trust: false },
      inlineOptions: { onClick: (node, pos) => onMath({ display: false, latex: String(node.attrs.latex ?? ""), pos }) },
      blockOptions: { onClick: (node, pos) => onMath({ display: true, latex: String(node.attrs.latex ?? ""), pos }) },
    }),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : placeholder),
    }),
    Shortcuts,
  ];
}

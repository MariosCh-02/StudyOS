import { useEffect, useState } from "react";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { ImageOff } from "lucide-react";
import { readStoredFile } from "@/lib/native";

const blobCache = new Map<string, Promise<string>>();

/** Loads a stored image once per session and hands out an object URL. */
function imageUrl(storedName: string, mime: string): Promise<string> {
  let p = blobCache.get(storedName);
  if (!p) {
    p = readStoredFile(storedName).then((buf) => URL.createObjectURL(new Blob([buf], { type: mime })));
    p.catch(() => blobCache.delete(storedName));
    blobCache.set(storedName, p);
  }
  return p;
}

const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

function ImageView({ node, selected }: ReactNodeViewProps) {
  const storedName = node.attrs.storedName as string | null;
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!storedName) return setMissing(true);
    let alive = true;
    const ext = storedName.split(".").pop() ?? "png";
    imageUrl(storedName, MIME_BY_EXT[ext] ?? "image/png")
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [storedName]);

  return (
    <NodeViewWrapper className="my-3" data-drag-handle>
      {missing ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-xs text-subtle">
          <ImageOff className="size-4" aria-hidden />
          {(node.attrs.alt as string) || "Image"} — added on another computer
        </div>
      ) : src ? (
        <img src={src} alt={(node.attrs.alt as string) ?? ""} className={selected ? "rounded-md ring-2 ring-accent" : "rounded-md"} />
      ) : (
        <div className="h-24 animate-pulse rounded-md bg-surface-2" />
      )}
    </NodeViewWrapper>
  );
}

/**
 * Images reference attachments by stored name instead of embedding bytes, so
 * notes stay small enough to sync. Files live only on the importing PC.
 */
export const AttachmentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: { default: null, rendered: false },
      storedName: { default: null },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
}).configure({ inline: false, allowBase64: false });

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Minus, MoveHorizontal, Plus } from "lucide-react";
import { GlobalWorkerOptions, getDocument, TextLayer, type PDFDocumentLoadingTask, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { IconButton } from "@/components/ui/Button";
import { ErrorState, Spinner } from "@/components/ui/Feedback";
import { openStoredFile, readStoredFile } from "@/lib/native";
import "@/styles/pdf.css";

GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const PAGE_GAP = 12;

interface PageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  /** Size of page 1 at scale 1, used until this page's own size is known. */
  baseSize: { width: number; height: number };
  root: HTMLElement | null;
}

/** Renders one page when it scrolls near the viewport; releases it when far away. */
function PdfPage({ pdf, pageNumber, scale, baseSize, root }: PageProps) {
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState(baseSize);

  useEffect(() => {
    const el = holder.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { root, rootMargin: "150% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible) return;
    const el = holder.current!;
    let cancelled = false;
    let task: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    let page: PDFPageProxy | null = null;

    void (async () => {
      page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      setSize({ width: viewport.width / scale, height: viewport.height / scale });
      const ratio = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      task = page.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      try {
        await task.promise;
      } catch {
        return; // cancelled
      }
      if (cancelled) return;
      const layerDiv = document.createElement("div");
      layerDiv.className = "textLayer";
      el.replaceChildren(canvas, layerDiv);
      textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: layerDiv, viewport });
      await textLayer.render().catch(() => undefined);
    })();

    return () => {
      cancelled = true;
      task?.cancel();
      textLayer?.cancel();
      page?.cleanup();
      el.replaceChildren();
    };
  }, [visible, pdf, pageNumber, scale]);

  return (
    <div
      ref={holder}
      data-page={pageNumber}
      className="pdf-page"
      style={{ width: size.width * scale, height: size.height * scale, ["--scale-factor" as string]: scale }}
    />
  );
}

interface PdfViewerProps {
  storedName: string;
  fileName: string;
}

export function PdfViewer({ storedName, fileName }: PdfViewerProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [baseSize, setBaseSize] = useState({ width: 612, height: 792 });
  const [error, setError] = useState<unknown>(null);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");

  useEffect(() => {
    let task: PDFDocumentLoadingTask | null = null;
    let cancelled = false;
    setPdf(null);
    setError(null);
    void (async () => {
      try {
        const data = new Uint8Array(await readStoredFile(storedName));
        if (cancelled) return;
        task = getDocument({
          data,
          // Shipped with the app (scripts/copy-pdf-assets.mjs), so PDFs render offline.
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
          iccUrl: "/pdfjs/iccs/",
        });
        const doc = await task.promise;
        const first = await doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setBaseSize({ width: vp.width, height: vp.height });
        setPdf(doc);
        setPage(1);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [storedName]);

  // Fit-to-width follows the pane as it is resized.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !fitWidth) return;
    const update = () => setZoom(Math.max(0.25, (el.clientWidth - 32) / baseSize.width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitWidth, baseSize.width, pdf]);

  // Track the page at the top of the viewport.
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const pageHeight = baseSize.height * zoom + PAGE_GAP;
    const current = Math.min(pdf?.numPages ?? 1, Math.max(1, Math.floor((el.scrollTop + el.clientHeight / 3) / pageHeight) + 1));
    setPage(current);
    setPageInput(String(current));
  }, [baseSize.height, zoom, pdf]);

  const goTo = (n: number) => {
    if (!pdf) return;
    const target = Math.min(pdf.numPages, Math.max(1, n));
    scroller.current?.querySelector(`[data-page="${target}"]`)?.scrollIntoView({ block: "start" });
  };

  const stepZoom = (dir: 1 | -1) => {
    setFitWidth(false);
    setZoom((z) => (dir > 0 ? (ZOOM_STEPS.find((s) => s > z + 0.01) ?? z) : ([...ZOOM_STEPS].reverse().find((s) => s < z - 0.01) ?? z)));
  };

  return (
    <div className="flex h-full flex-col bg-surface-2">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-surface px-2 text-xs">
        <span className="min-w-0 flex-1 truncate px-1 font-medium" title={fileName}>
          {fileName}
        </span>
        {pdf && (
          <form
            className="flex items-center gap-1 text-muted"
            onSubmit={(e) => {
              e.preventDefault();
              goTo(Number(pageInput));
            }}
          >
            <input
              aria-label="Page number"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
              onBlur={() => setPageInput(String(page))}
              className="h-7 w-10 rounded border border-border bg-surface text-center tabular-nums focus:border-accent focus:outline-none"
            />
            / {pdf.numPages}
          </form>
        )}
        <IconButton label="Zoom out" onClick={() => stepZoom(-1)}>
          <Minus className="size-3.5" />
        </IconButton>
        <span className="w-10 text-center tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
        <IconButton label="Zoom in" onClick={() => stepZoom(1)}>
          <Plus className="size-3.5" />
        </IconButton>
        <IconButton label="Fit to width" onClick={() => setFitWidth(true)} className={fitWidth ? "text-accent" : undefined}>
          <MoveHorizontal className="size-3.5" />
        </IconButton>
        <IconButton label="Open in default app" onClick={() => void openStoredFile(storedName).catch((e) => setError(e))}>
          <ExternalLink className="size-3.5" />
        </IconButton>
      </div>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto p-4">
        {error ? (
          <ErrorState error={error} />
        ) : !pdf ? (
          <Spinner label="Opening PDF…" />
        ) : (
          <div className="flex flex-col items-center" style={{ gap: PAGE_GAP }}>
            {Array.from({ length: pdf.numPages }, (_, i) => (
              <PdfPage key={i + 1} pdf={pdf} pageNumber={i + 1} scale={zoom} baseSize={baseSize} root={scroller.current} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

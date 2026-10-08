import { isMac } from "@/lib/platform";

const PRINT_CSS = `
  @page { margin: 18mm 16mm; }
  .print-doc { max-width: none; color: #111; font: 11pt/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .print-doc h1 { font-size: 20pt; margin: 0 0 4pt; }
  .print-doc h2 { font-size: 14pt; margin: 14pt 0 4pt; break-after: avoid; }
  .print-doc h3 { font-size: 12pt; margin: 10pt 0 3pt; break-after: avoid; }
  .print-doc pre, .print-doc table, .print-doc .katex-display { break-inside: avoid; }
  .print-doc pre { background: #f4f4f5; padding: 8pt; border-radius: 4pt; white-space: pre-wrap; font-size: 9.5pt; }
  .print-doc table { border-collapse: collapse; width: 100%; font-size: 10pt; }
  .print-doc th, .print-doc td { border: 1px solid #ccc; padding: 4pt 6pt; text-align: left; }
  .print-doc th { background: #f4f4f5; }
  .print-doc .meta { color: #555; font-size: 9.5pt; margin-bottom: 12pt; }
  .print-doc .num { text-align: right; font-variant-numeric: tabular-nums; }
`;

/**
 * Prints HTML with the app's stylesheets (including KaTeX), so "Microsoft
 * Print to PDF" (Windows) or "Save as PDF" (macOS) gives a PDF export.
 */
export function printHtml(title: string, bodyHtml: string): void {
  if (isMac && "__TAURI_INTERNALS__" in window) printInPage(title, bodyHtml);
  else printInFrame(title, bodyHtml);
}

/** Windows (and the browser): a hidden frame, so the app itself isn't touched. */
function printInFrame(title: string, bodyHtml: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((n) => n.outerHTML)
    .join("\n");
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${styles}
<style>
  html, body { background: #fff !important; color: #111 !important; }
  body { margin: 0; }
  ${PRINT_CSS}
</style></head><body><article class="print-doc">${bodyHtml}</article></body></html>`);
  doc.close();
  const win = frame.contentWindow!;
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener("afterprint", cleanup);
  // Let fonts and styles load before opening the print dialog.
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(() => frame.isConnected && frame.remove(), 60_000);
  }, 300);
}

const PAGE_ID = "studyos-print";

/**
 * macOS: WebKit ignores print() inside frames and Tauri only prints the whole
 * web view, so the document is added to the page and print CSS hides the app.
 * The native print panel doesn't report when it closes; the (screen-hidden)
 * document stays until the next print.
 */
function printInPage(title: string, bodyHtml: string): void {
  document.getElementById(PAGE_ID)?.remove();
  const root = document.createElement("div");
  root.id = PAGE_ID;
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `<style>
  @media screen { #${PAGE_ID} { display: none; } }
  @media print {
    html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
    body > :not(#${PAGE_ID}) { display: none !important; }
    ${PRINT_CSS}
  }
</style><article class="print-doc print-light">${bodyHtml}</article>`;
  document.body.appendChild(root);
  const previousTitle = document.title;
  document.title = title;
  setTimeout(() => {
    window.print();
    setTimeout(() => (document.title = previousTitle), 2000);
  }, 300);
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

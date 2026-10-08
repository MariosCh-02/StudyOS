// Copies pdf.js runtime assets (fonts, character maps, colour profiles, WASM
// image decoders) into public/pdfjs so they ship inside the app. Licences:
// Apache-2.0 / BSD / MIT (see node_modules/pdfjs-dist/wasm/LICENSE_*).
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const src = join("node_modules", "pdfjs-dist");
const dest = join("public", "pdfjs");
mkdirSync(dest, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const from = join(src, dir);
  if (existsSync(from)) cpSync(from, join(dest, dir), { recursive: true });
}
console.log("pdf.js assets copied to public/pdfjs");

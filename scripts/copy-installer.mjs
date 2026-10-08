// Copies the NSIS installer produced by `tauri build` to release/StudyOS-Setup.exe.
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const nsisDir = join("src-tauri", "target", "release", "bundle", "nsis");
let installers;
try {
  installers = readdirSync(nsisDir).filter((f) => f.toLowerCase().endsWith("-setup.exe"));
} catch {
  console.error(`No installer directory at ${nsisDir}. Did "tauri build" succeed?`);
  process.exit(1);
}
if (installers.length === 0) {
  console.error(`No *-setup.exe found in ${nsisDir}.`);
  process.exit(1);
}
// Newest installer wins if older versions are still lying around.
const latest = installers
  .map((f) => ({ f, t: statSync(join(nsisDir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)[0].f;

mkdirSync("release", { recursive: true });
const target = join("release", "StudyOS-Setup.exe");
copyFileSync(join(nsisDir, latest), target);
console.log(`Installer ready: ${target} (from ${latest})`);

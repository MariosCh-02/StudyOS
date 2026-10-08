// Copies the installer produced by `tauri build` to release/:
// StudyOS-Setup.exe (NSIS, Windows) or StudyOS.dmg (macOS).
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const mac = process.platform === "darwin";
const bundleDir = join("src-tauri", "target", "release", "bundle", mac ? "dmg" : "nsis");
const suffix = mac ? ".dmg" : "-setup.exe";
const targetName = mac ? "StudyOS.dmg" : "StudyOS-Setup.exe";

let installers;
try {
  installers = readdirSync(bundleDir).filter((f) => f.toLowerCase().endsWith(suffix));
} catch {
  console.error(`No installer directory at ${bundleDir}. Did "tauri build" succeed?`);
  process.exit(1);
}
if (installers.length === 0) {
  console.error(`No *${suffix} found in ${bundleDir}.`);
  process.exit(1);
}
// Newest installer wins if older versions are still lying around.
const latest = installers
  .map((f) => ({ f, t: statSync(join(bundleDir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)[0].f;

mkdirSync("release", { recursive: true });
const target = join("release", targetName);
copyFileSync(join(bundleDir, latest), target);
console.log(`Installer ready: ${target} (from ${latest})`);

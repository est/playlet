import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const required = [
  "src/loader.js",
  "src/app.js",
  "scripts/build.mjs",
  "scripts/dev-server.mjs",
  ".github/workflows/pages.yml",
];

let failed = false;
for (const rel of required) {
  const abs = path.join(repoRoot, rel);
  try {
    await access(abs);
    console.log(`[check] ok ${rel}`);
  } catch {
    failed = true;
    console.error(`[check] missing ${rel}`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("[check] all required files present");
}

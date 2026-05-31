import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const required = [
  "src/loader.js",
  "src/app.js",
  "src/core/constants.js",
  "src/core/store.js",
  "src/domain/dlna.js",
  "src/domain/playlist.js",
  "src/infra/media.js",
  "src/infra/storage.js",
  "src/ui/styles.js",
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

const boundaryChecks = [
  {
    file: "src/ui/styles.js",
    forbidden: ["./infra/", "../infra/", "./domain/", "../domain/"],
    reason: "ui layer must not depend on infra/domain directly",
  },
  {
    file: "src/domain/playlist.js",
    forbidden: ["./ui/", "../ui/", "./infra/media", "../infra/media"],
    reason: "domain layer must not depend on ui/media implementation",
  },
];

for (const check of boundaryChecks) {
  const abs = path.join(repoRoot, check.file);
  try {
    const src = await readFile(abs, "utf8");
    const hasForbidden = check.forbidden.find((token) => src.includes(token));
    if (hasForbidden) {
      failed = true;
      console.error(`[check] boundary violation ${check.file}: found '${hasForbidden}' (${check.reason})`);
    } else {
      console.log(`[check] boundary ok ${check.file}`);
    }
  } catch (err) {
    failed = true;
    console.error(`[check] boundary read failed ${check.file}: ${err.message}`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("[check] all required files present");
}

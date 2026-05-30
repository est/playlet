import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const srcDir = path.join(repoRoot, "src");
const distDir = path.join(repoRoot, "dist");

function getVersion() {
  const sha = process.env.GITHUB_SHA?.slice(0, 7);
  if (sha) return `gh-${sha}`;

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `local-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

const version = getVersion();

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const loaderSrc = await readFile(path.join(srcDir, "loader.js"), "utf8");
const appSrc = await readFile(path.join(srcDir, "app.js"), "utf8");

const loaderOut = loaderSrc.replaceAll("__PLAYLET_VERSION__", version);
const appOut = `/* Playlet ${version} */\n${appSrc}`;

await writeFile(path.join(distDir, "loader.js"), loaderOut, "utf8");
await writeFile(path.join(distDir, "app.js"), appOut, "utf8");
await writeFile(
  path.join(distDir, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Playlet Dist</title>
</head>
<body>
  <h1>Playlet Dist</h1>
  <p>Version: ${version}</p>
  <p>Loader URL: <code>./loader.js</code></p>
</body>
</html>\n`,
  "utf8"
);

console.log(`[build] done: ${distDir}`);
console.log(`[build] version: ${version}`);

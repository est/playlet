import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const srcPaths = [
  resolve(projectRoot, "src", "parser.js"),
  resolve(projectRoot, "src", "player-state.js"),
  resolve(projectRoot, "src", "playlet.js"),
];
const outDir = resolve(projectRoot, "dist");
const outPath = resolve(outDir, "bookmarklet.txt");

const sources = await Promise.all(srcPaths.map((path) => readFile(path, "utf8")));
const compact = sources
  .map((source) =>
    source
      .replace(/^\s*import .*$/gm, "")
      .replace(/^\s*export /gm, "")
      .replace(/\n{2,}/g, "\n")
      .trim()
  )
  .join("\n");

const bootstrap = `(function(){${compact};window.Playlet={init:init};window.Playlet.init();})();`;
const bookmarklet = `javascript:${encodeURIComponent(bootstrap)}`;

await mkdir(outDir, { recursive: true });
await writeFile(outPath, `${bookmarklet}\n`, "utf8");

process.stdout.write(`Wrote ${outPath}\n`);

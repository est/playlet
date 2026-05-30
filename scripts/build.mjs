import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

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

const replaceVersionPlugin = {
  name: "replace-version",
  setup(build) {
    build.onLoad({ filter: /loader\.js$/ }, async (args) => {
      const content = await readFile(args.path, "utf8");
      return {
        contents: content.replaceAll("__PLAYLET_VERSION__", version),
        loader: "js",
        resolveDir: path.dirname(args.path),
      };
    });
  },
};

await esbuild.build({
  entryPoints: [path.join(srcDir, "loader-inline-entry.js")],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2022"],
  splitting: false,
  outfile: path.join(distDir, "loader.js"),
  sourcemap: false,
  plugins: [replaceVersionPlugin],
  logLevel: "info",
});

// Keep app.js available for local debug/fallback, without minify requirement.
await cp(path.join(srcDir, "app.js"), path.join(distDir, "app.js"));

const htmlTemplate = await readFile(path.join(srcDir, "index.html"), "utf8");
await writeFile(path.join(distDir, "index.html"), htmlTemplate.replaceAll("__PLAYLET_VERSION__", version), "utf8");

console.log(`[build] done: ${distDir}`);
console.log(`[build] version: ${version}`);

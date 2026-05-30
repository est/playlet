import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const srcPaths = [
  resolve(projectRoot, "src", "parser.js"),
  resolve(projectRoot, "src", "player-state.js"),
  resolve(projectRoot, "src", "playlet.js"),
];
const outDir = resolve(projectRoot, "dist");
const bookmarkletPath = resolve(outDir, "bookmarklet.txt");
const modulePath = resolve(outDir, "playlet.module.js");

const sources = await Promise.all(srcPaths.map((path) => readFile(path, "utf8")));
const moduleSource = sources
  .map((source) =>
    source
      .replace(/^\s*import .*$/gm, "")
      .replace(/^\s*export /gm, "")
      .replace(/\n{2,}/g, "\n")
      .trim()
  )
  .join("\n")
  .concat(
    "\nif(typeof window!=='undefined'){window.__PLAYLET_MODULE_RAN__=true;window.Playlet={init:init};window.Playlet.init();}\n"
  );

const loader = `(function(){if(window.__PLAYLET_BOOKMARKLET_INJECTED__)return;window.__PLAYLET_BOOKMARKLET_INJECTED__=true;var base=window.__PLAYLET_MODULE_URL__||new URL('./playlet.module.js',location.href).toString();window.__PLAYLET_MODULE_URL__=base;var s=document.createElement('script');s.type='module';s.src=base;s.onerror=function(){window.__PLAYLET_BOOKMARKLET_INJECTED__=false;console.error('Playlet failed to load module:',base);};document.head.appendChild(s);})();`;
const bookmarklet = `javascript:${encodeURIComponent(loader)}`;

await mkdir(outDir, { recursive: true });
await writeFile(modulePath, moduleSource, "utf8");
await writeFile(bookmarkletPath, `${bookmarklet}\n`, "utf8");

process.stdout.write(`Wrote ${modulePath}\nWrote ${bookmarkletPath}\n`);

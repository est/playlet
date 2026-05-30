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

const landing = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Playlet</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ctext y='50' font-size='50'%3E%F0%9F%92%BF%3C/text%3E%3C/svg%3E" />
  <style>
    :root {
      --bg: #0b0b0d;
      --fg: #f7f7f8;
      --muted: #a8a8b3;
      --line: #2a2a33;
      --card: #101016;
      --accent: #ffffff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at 10% 10%, #171723 0%, var(--bg) 45%), var(--bg);
      color: var(--fg);
      font-family: "SF Pro Display", "Segoe UI", system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    main {
      width: min(860px, 100%);
      border: 1px solid var(--line);
      background: linear-gradient(180deg, #12121a 0%, #0f0f15 100%);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.45);
    }
    h1 {
      margin: 0;
      font-size: clamp(30px, 5vw, 56px);
      letter-spacing: -0.03em;
      line-height: 0.95;
    }
    p {
      margin: 10px 0 0;
      color: var(--muted);
      max-width: 52ch;
      line-height: 1.45;
    }
    .row {
      margin-top: 18px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    code {
      background: #0a0a0f;
      border: 1px solid var(--line);
      border-radius: 9px;
      padding: 9px 11px;
      font-size: 12px;
      color: #e7e7ef;
      overflow-wrap: anywhere;
    }
    button, a {
      font: inherit;
      color: #0a0a10;
      background: var(--accent);
      border: 0;
      border-radius: 9px;
      padding: 10px 13px;
      font-weight: 650;
      text-decoration: none;
      cursor: pointer;
    }
    .ghost {
      color: var(--fg);
      background: transparent;
      border: 1px solid var(--line);
    }
    ol {
      margin: 18px 0 0;
      padding-left: 20px;
      color: #d6d6df;
      line-height: 1.55;
    }
    footer {
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
  </style>
</head>
<body>
  <main>
    <h1>Playlet</h1>
    <p>No native app. No SSDP hacks. Inject a bookmarklet into your DLNA page and stream instantly.</p>

    <div class="row">
      <code id="bookmarklet">javascript:import('${new URL("./loader.js", "https://example.com/").href.replace("https://example.com/", "")}' )</code>
      <button id="copy">Copy Bookmarklet</button>
      <a class="ghost" href="./loader.js">Open loader.js</a>
    </div>

    <ol>
      <li>Replace host in bookmarklet with your pages URL.</li>
      <li>Open NAS DLNA page (same origin as <code>rootDesc.xml</code>).</li>
      <li>Click bookmark. Browse tree with +/-, queue tracks, play.</li>
    </ol>

    <footer>
      <span>Version: ${version}</span>
      <span><a class="ghost" href="https://github.com/est/playlet" target="_blank" rel="noreferrer">Repo</a></span>
      <span>Debug: <code>window.__playletDebug</code></span>
    </footer>
  </main>
  <script>
    const host = location.origin + location.pathname.replace(/\/index\.html$/, "").replace(/\/$/, "");
    const bookmarklet = "javascript:import(\\"" + host + "/loader.js\\")";
    const code = document.getElementById("bookmarklet");
    code.textContent = bookmarklet;

    document.getElementById("copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(bookmarklet);
        const old = code.textContent;
        code.textContent = "copied";
        setTimeout(() => {
          code.textContent = old;
        }, 1200);
      } catch {
        code.textContent = "copy failed";
      }
    });
  </script>
</body>
</html>\n`;

await writeFile(path.join(distDir, "index.html"), landing, "utf8");

console.log(`[build] done: ${distDir}`);
console.log(`[build] version: ${version}`);

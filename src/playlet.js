import { parseDlnaIndex } from "./parser.js";
import { createPlayerState } from "./player-state.js";

const ROOT_ID = "playlet-root";
const STYLE_ID = "playlet-style";

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#${ROOT_ID} {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: min(420px, calc(100vw - 32px));
  max-height: 80vh;
  overflow: auto;
  background: linear-gradient(180deg, #1f2a3a, #0f151f);
  color: #e8f2ff;
  border: 1px solid #48607f;
  border-radius: 14px;
  box-shadow: 0 20px 50px rgba(0,0,0,0.5);
  font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  z-index: 999999;
}
#${ROOT_ID} .p-header {
  padding: 10px 12px;
  border-bottom: 1px solid #30445f;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
#${ROOT_ID} .p-title { font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
#${ROOT_ID} .p-btn {
  border: 1px solid #48607f;
  background: #1b2838;
  color: #e8f2ff;
  border-radius: 8px;
  padding: 4px 8px;
  cursor: pointer;
}
#${ROOT_ID} .p-body { padding: 10px 12px; display: grid; gap: 8px; }
#${ROOT_ID} .p-now { font-weight: 600; }
#${ROOT_ID} .p-controls { display: flex; gap: 6px; flex-wrap: wrap; }
#${ROOT_ID} .p-queue { margin: 0; padding-left: 18px; }
#${ROOT_ID} .p-queue button { margin-left: 6px; }
#${ROOT_ID} .p-warning {
  border: 1px solid #a1632b;
  background: #2f1f13;
  color: #ffd1a8;
  border-radius: 8px;
  padding: 8px;
}
  `;
  document.head.appendChild(style);
}

function formatNowPlaying(track) {
  return track ? track.title : "Nothing playing";
}

function toDiagnosticsText(parsed) {
  return JSON.stringify(
    {
      supported: parsed.supported,
      confidence: parsed.confidence,
      warnings: parsed.warnings,
      diagnostics: parsed.diagnostics,
      pageUrl: window.location.href,
    },
    null,
    2
  );
}

function createRoot() {
  const existing = document.getElementById(ROOT_ID);
  if (existing) existing.remove();
  const root = document.createElement("section");
  root.id = ROOT_ID;
  document.body.appendChild(root);
  return root;
}

function renderUnsupported(root, parsed) {
  root.innerHTML = `
    <div class="p-header">
      <div class="p-title">Playlet</div>
      <button class="p-btn" data-role="close">Close</button>
    </div>
    <div class="p-body">
      <div class="p-warning">Unsupported index layout. Playlet could not detect playable tracks.</div>
      <div><strong>Warnings:</strong> ${parsed.warnings.join("; ") || "Unknown parser issue."}</div>
      <label>Diagnostics</label>
      <textarea rows="10" readonly style="width:100%; box-sizing:border-box;">${toDiagnosticsText(parsed)}</textarea>
    </div>
  `;
}

function renderSupported(root, player, parsed, audio) {
  const snapshot = player.snapshot();
  const current = player.currentTrack();
  const queueItems = snapshot.queue
    .map(
      (track, index) => `<li>
        ${index === snapshot.currentIndex ? "▶ " : ""}${track.title}
        <button class="p-btn" data-role="play" data-index="${index}">Play</button>
        <button class="p-btn" data-role="rm" data-id="${track.id}">Remove</button>
      </li>`
    )
    .join("");

  root.innerHTML = `
    <div class="p-header">
      <div class="p-title">Playlet</div>
      <button class="p-btn" data-role="close">Close</button>
    </div>
    <div class="p-body">
      <div><strong>Folders:</strong> ${parsed.folders.length} | <strong>Tracks:</strong> ${parsed.tracks.length}</div>
      <div class="p-now">Now Playing: ${formatNowPlaying(current)}</div>
      <div class="p-controls">
        <button class="p-btn" data-role="prev">Prev</button>
        <button class="p-btn" data-role="toggle">${snapshot.playing ? "Pause" : "Play"}</button>
        <button class="p-btn" data-role="next">Next</button>
      </div>
      <ol class="p-queue">${queueItems}</ol>
    </div>
  `;

  root.querySelector('[data-role="toggle"]')?.addEventListener("click", () => {
    if (!player.currentTrack()) return;
    if (audio.paused) {
      void audio.play();
      return;
    }
    audio.pause();
  });

  root.querySelector('[data-role="next"]')?.addEventListener("click", () => {
    player.next();
    const track = player.currentTrack();
    if (!track) return;
    audio.src = track.url;
    void audio.play();
    renderSupported(root, player, parsed, audio);
  });

  root.querySelector('[data-role="prev"]')?.addEventListener("click", () => {
    player.prev();
    const track = player.currentTrack();
    if (!track) return;
    audio.src = track.url;
    void audio.play();
    renderSupported(root, player, parsed, audio);
  });

  root.querySelectorAll('[data-role="play"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.getAttribute("data-index"));
      player.playAt(index);
      const track = player.currentTrack();
      if (!track) return;
      audio.src = track.url;
      void audio.play();
      renderSupported(root, player, parsed, audio);
    });
  });

  root.querySelectorAll('[data-role="rm"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      if (!id) return;
      player.removeTrackById(id);
      renderSupported(root, player, parsed, audio);
    });
  });
}

export function mountPlaylet(doc = document, win = window) {
  const html = doc.documentElement.outerHTML;
  const parsed = parseDlnaIndex(html, win.location.href);
  const player = createPlayerState();
  player.setQueue(parsed.tracks);
  const audio = new Audio();

  ensureStyle();
  const root = createRoot();
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.role === "close") root.remove();
  });

  if (!parsed.supported) {
    renderUnsupported(root, parsed);
    return { parsed, player, root };
  }

  if (parsed.tracks.length > 0) player.playAt(0);
  const firstTrack = player.currentTrack();
  if (firstTrack) {
    audio.src = firstTrack.url;
  }
  renderSupported(root, player, parsed, audio);

  return { parsed, player, root };
}

export function init(options = {}) {
  return mountPlaylet(options.document ?? document, options.window ?? window);
}

if (typeof window !== "undefined") {
  window.Playlet = { init };
}

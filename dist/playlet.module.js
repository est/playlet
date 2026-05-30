const MEDIA_EXTENSIONS = [".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus"];
function decodeHtml(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}
function stripTags(text) {
  return text.replace(/<[^>]*>/g, "");
}
function normalizeUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}
function trackTitleFromUrl(url) {
  const pathname = new URL(url).pathname;
  const file = pathname.split("/").pop() || "Unknown";
  return decodeURIComponent(file).replace(/\.[^.]+$/, "");
}
function isTrackUrl(url) {
  const cleanPath = new URL(url).pathname.toLowerCase();
  return MEDIA_EXTENSIONS.some((ext) => cleanPath.endsWith(ext));
}
function parseAnchors(html) {
  const anchors = [];
  const regex = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match = regex.exec(html);
  while (match) {
    anchors.push({
      href: decodeHtml(match[2].trim()),
      text: decodeHtml(stripTags(match[3]).trim()),
    });
    match = regex.exec(html);
  }
  return anchors;
}
function dedupeTracks(tracks) {
  const seen = new Set();
  const deduped = [];
  for (const track of tracks) {
    if (seen.has(track.url)) continue;
    seen.add(track.url);
    deduped.push(track);
  }
  return deduped;
}
function parseDlnaIndex(html, baseUrl) {
  const anchors = parseAnchors(html);
  const folders = [];
  const tracks = [];
  const warnings = [];
  for (const anchor of anchors) {
    const normalized = normalizeUrl(anchor.href, baseUrl);
    if (!normalized) continue;
    if (isTrackUrl(normalized)) {
      tracks.push({
        id: normalized,
        title: anchor.text || trackTitleFromUrl(normalized),
        url: normalized,
      });
      continue;
    }
    if (anchor.href.endsWith("/") || normalized.endsWith("/")) {
      folders.push({
        id: normalized,
        title: anchor.text || decodeURIComponent(new URL(normalized).pathname.split("/").filter(Boolean).pop() || "Folder"),
        url: normalized,
      });
    }
  }
  const dedupedTracks = dedupeTracks(tracks);
  if (anchors.length === 0) warnings.push("No anchor tags found.");
  if (dedupedTracks.length === 0) warnings.push("No playable media links found.");
  const supported = anchors.length > 0 && dedupedTracks.length > 0;
  const confidence = supported ? 1 : anchors.length > 0 ? 0.4 : 0;
  return {
    supported,
    confidence,
    folders,
    tracks: dedupedTracks,
    warnings,
    diagnostics: {
      baseUrl,
      hasAnchorTags: anchors.length > 0,
      anchorCount: anchors.length,
      folderCount: folders.length,
      trackCount: dedupedTracks.length,
    },
  };
}
function createPlayerState() {
  const state = {
    queue: [],
    currentIndex: -1,
    playing: false,
    position: 0,
    volume: 1,
  };
  function clampIndex(index) {
    if (state.queue.length === 0) return -1;
    return Math.max(0, Math.min(index, state.queue.length - 1));
  }
  return {
    setQueue(queue) {
      state.queue = [...queue];
      state.currentIndex = state.queue.length > 0 ? 0 : -1;
      state.playing = false;
      state.position = 0;
    },
    playAt(index) {
      const nextIndex = clampIndex(index);
      if (nextIndex === -1) return;
      state.currentIndex = nextIndex;
      state.playing = true;
      state.position = 0;
    },
    currentTrack() {
      if (state.currentIndex < 0 || state.currentIndex >= state.queue.length) return null;
      return state.queue[state.currentIndex];
    },
    next() {
      if (state.queue.length === 0) return;
      state.currentIndex = clampIndex(state.currentIndex + 1);
    },
    prev() {
      if (state.queue.length === 0) return;
      state.currentIndex = clampIndex(state.currentIndex - 1);
    },
    removeTrackById(trackId) {
      const removeIndex = state.queue.findIndex((track) => track.id === trackId);
      if (removeIndex === -1) return;
      state.queue.splice(removeIndex, 1);
      if (state.queue.length === 0) {
        state.currentIndex = -1;
        state.playing = false;
        return;
      }
      if (removeIndex < state.currentIndex) {
        state.currentIndex -= 1;
      } else if (removeIndex === state.currentIndex) {
        state.currentIndex = clampIndex(state.currentIndex);
      }
    },
    snapshot() {
      return {
        queue: [...state.queue],
        currentIndex: state.currentIndex,
        playing: state.playing,
        position: state.position,
        volume: state.volume,
      };
    },
  };
}
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
function mountPlaylet(doc = document, win = window) {
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
function init(options = {}) {
  return mountPlaylet(options.document ?? document, options.window ?? window);
}
if (typeof window !== "undefined") {
  window.Playlet = { init };
}
if(typeof window!=='undefined'){window.__PLAYLET_MODULE_RAN__=true;window.Playlet={init:init};window.Playlet.init();}

const PLAYLET_ROOT_ID = "playlet-root";
const PLAYLET_STYLE_ID = "playlet-style";
const PLAYLET_RUNTIME_KEY = "__playletRuntime";
const CONTENT_DIRECTORY_SERVICE = "urn:schemas-upnp-org:service:ContentDirectory:1";

const state = {
  initialized: false,
  version: "dev",
  baseUrl: "",
  busy: false,
  descUrl: "",
  service: null,
  stack: [],
  entries: [],
  nowPlaying: null,
  error: "",
};

const listeners = new Set();

function publishState() {
  for (const cb of listeners) cb(state);
}

function setState(next) {
  Object.assign(state, next);
  publishState();
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeUrl(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

function textOf(node, selector) {
  const found = node.querySelector(selector);
  return found ? found.textContent?.trim() ?? "" : "";
}

function firstElementByLocalName(node, localName) {
  const byNs = node.getElementsByTagNameNS ? node.getElementsByTagNameNS("*", localName) : [];
  if (byNs && byNs.length) return byNs[0];
  const byTag = node.getElementsByTagName ? node.getElementsByTagName(localName) : [];
  return byTag && byTag.length ? byTag[0] : null;
}

function allElementsByLocalName(node, localName) {
  const list = node.getElementsByTagNameNS ? node.getElementsByTagNameNS("*", localName) : [];
  if (list && list.length) return Array.from(list);
  const fallback = node.getElementsByTagName ? node.getElementsByTagName(localName) : [];
  return Array.from(fallback || []);
}

function textByLocalName(node, localName) {
  const el = firstElementByLocalName(node, localName);
  return el?.textContent?.trim() || "";
}

function parseDurationToSeconds(input) {
  if (!input) return null;
  const match = input.match(/^(\d+):(\d+):(\d+)(?:\.\d+)?$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function formatSeconds(value) {
  if (!Number.isFinite(value) || value < 0) return "--:--";
  const total = Math.floor(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function parseProtocolInfo(info) {
  const [protocol = "", network = "", mime = "", extras = ""] = String(info || "").split(":");
  const flags = Object.fromEntries(
    extras
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((entry) => {
        const [k, v = ""] = entry.split("=");
        return [k, v];
      })
  );
  return { protocol, network, mime, flags, raw: info || "" };
}

function pickPlayableResource(resources) {
  const scored = resources
    .map((res) => {
      const protocol = parseProtocolInfo(res.protocolInfo);
      let score = 0;

      if (protocol.protocol === "http-get") score += 4;
      if (protocol.mime.startsWith("audio/")) score += 4;
      if (protocol.mime === "audio/flac") score += 3;
      if (protocol.mime === "audio/mp4") score += 3;
      if (protocol.mime === "audio/mpeg") score += 2;
      if (protocol.mime === "audio/x-wav") score += 2;
      if (protocol.flags["DLNA.ORG_OP"] && protocol.flags["DLNA.ORG_OP"] !== "00") score += 1;

      return {
        ...res,
        protocol,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0] || null;
}

function parseDidlEntries(xmlText, baseUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`DIDL parse failed: ${parseError.textContent?.trim() || "Unknown parser error"}`);
  }

  const containers = allElementsByLocalName(doc, "container").map((node) => ({
    kind: "container",
    id: node.getAttribute("id") || "",
    parentId: node.getAttribute("parentID") || "",
    title: textByLocalName(node, "title") || "(untitled folder)",
    childCount: Number(node.getAttribute("childCount") || "0") || 0,
  }));

  const items = allElementsByLocalName(doc, "item").map((node) => {
    const resources = allElementsByLocalName(node, "res")
      .map((resNode) => {
        const url = (resNode.textContent || "").trim();
        if (!url) return null;
        return {
          url: normalizeUrl(url, baseUrl),
          protocolInfo: resNode.getAttribute("protocolInfo") || "",
          bitrate: Number(resNode.getAttribute("bitrate") || "0") || null,
          duration: resNode.getAttribute("duration") || "",
        };
      })
      .filter(Boolean);

    const best = pickPlayableResource(resources);

    return {
      kind: "item",
      id: node.getAttribute("id") || "",
      parentId: node.getAttribute("parentID") || "",
      title: textByLocalName(node, "title") || "(untitled track)",
      artist: textByLocalName(node, "artist"),
      album: textByLocalName(node, "album"),
      className: textByLocalName(node, "class"),
      resources,
      playable: Boolean(best),
      bestResource: best,
      durationSeconds: parseDurationToSeconds(best?.duration || ""),
    };
  });

  return [...containers, ...items];
}

class DlnaClient {
  constructor(descUrl) {
    this.descUrl = descUrl;
    this.descBase = new URL(descUrl, location.href).href;
    this.controlUrl = "";
    this.serviceType = CONTENT_DIRECTORY_SERVICE;
    this.lastRequest = null;
    this.lastResponse = null;
  }

  async init() {
    const res = await fetch(this.descBase);
    if (!res.ok) {
      throw new Error(`Description fetch failed: ${res.status} ${res.statusText}`);
    }

    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      throw new Error(`Description XML parse failed: ${parseError.textContent?.trim() || "Unknown parser error"}`);
    }

    const serviceNodes = allElementsByLocalName(doc, "service");
    const target = serviceNodes.find((node) => textByLocalName(node, "serviceType") === CONTENT_DIRECTORY_SERVICE);

    if (!target) {
      throw new Error("ContentDirectory service not found in device description");
    }

    const rawControlUrl = textByLocalName(target, "controlURL");
    if (!rawControlUrl) {
      throw new Error("ContentDirectory controlURL is empty");
    }

    this.controlUrl = normalizeUrl(rawControlUrl, this.descBase);
    return this;
  }

  async browse(objectId = "0", start = 0, count = 200) {
    const action = "Browse";
    const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Browse xmlns:u="${this.serviceType}">
      <ObjectID>${escapeHtml(objectId)}</ObjectID>
      <BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>${start}</StartingIndex>
      <RequestedCount>${count}</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse>
  </s:Body>
</s:Envelope>`;

    this.lastRequest = {
      url: this.controlUrl,
      action,
      objectId,
      body,
    };

    const res = await fetch(this.controlUrl, {
      method: "POST",
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPAction: `"${this.serviceType}#${action}"`,
      },
      body,
    });

    const xml = await res.text();
    this.lastResponse = {
      status: res.status,
      ok: res.ok,
      xml,
    };

    if (!res.ok) {
      throw new Error(`Browse failed: ${res.status} ${res.statusText}`);
    }

    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      throw new Error(`SOAP parse failed: ${parseError.textContent?.trim() || "Unknown parser error"}`);
    }

    const fault = firstElementByLocalName(doc, "Fault");
    if (fault) {
      throw new Error(`SOAP Fault: ${fault.textContent?.trim() || "Unknown fault"}`);
    }

    const resultNode = firstElementByLocalName(doc, "Result");

    if (!resultNode) {
      return [];
    }

    const didl = resultNode.textContent || "";
    return parseDidlEntries(didl, this.controlUrl);
  }
}

class BaseMediaAdapter {
  constructor() {
    this.features = {
      pip: false,
      mediaSession: false,
      remotePlayback: false,
      castCandidate: false,
      mse: false,
      webCodecs: false,
    };
  }

  attach() {}

  playResource() {
    throw new Error("playResource() must be implemented");
  }

  pause() {}

  destroy() {}

  getStatus() {
    return {
      currentTime: 0,
      duration: NaN,
      paused: true,
      volume: 1,
      features: this.features,
    };
  }
}

class HtmlMediaAdapter extends BaseMediaAdapter {
  constructor(onState) {
    super();
    this.onState = onState;
    this.audio = new Audio();
    this.audio.preload = "metadata";
    this.audio.crossOrigin = "anonymous";

    this.features = {
      pip: typeof document.pictureInPictureEnabled === "boolean",
      mediaSession: "mediaSession" in navigator,
      remotePlayback: "remote" in this.audio,
      castCandidate: "PresentationRequest" in window,
      mse: "MediaSource" in window,
      webCodecs: "VideoDecoder" in window,
    };

    this.boundEmit = this.emitState.bind(this);
    ["timeupdate", "durationchange", "play", "pause", "ended", "volumechange", "loadedmetadata", "error"].forEach((evt) => {
      this.audio.addEventListener(evt, this.boundEmit);
    });
  }

  emitState() {
    if (!this.onState) return;
    this.onState(this.getStatus());
  }

  async playResource(resource, metadata) {
    if (!resource?.url) throw new Error("No media URL to play");

    this.audio.src = resource.url;

    if (this.features.mediaSession && metadata) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: metadata.title || "Unknown",
        artist: metadata.artist || "",
        album: metadata.album || "",
      });
    }

    await this.audio.play();
    this.emitState();
  }

  pause() {
    this.audio.pause();
    this.emitState();
  }

  async resume() {
    await this.audio.play();
    this.emitState();
  }

  seek(seconds) {
    if (Number.isFinite(seconds)) {
      this.audio.currentTime = Math.max(0, seconds);
      this.emitState();
    }
  }

  setVolume(volume) {
    this.audio.volume = Math.max(0, Math.min(1, volume));
    this.emitState();
  }

  getStatus() {
    return {
      currentTime: this.audio.currentTime || 0,
      duration: this.audio.duration,
      paused: this.audio.paused,
      volume: this.audio.volume,
      features: this.features,
      error: this.audio.error ? `MediaError code ${this.audio.error.code}` : "",
    };
  }

  destroy() {
    this.audio.pause();
    this.audio.src = "";
    ["timeupdate", "durationchange", "play", "pause", "ended", "volumechange", "loadedmetadata", "error"].forEach((evt) => {
      this.audio.removeEventListener(evt, this.boundEmit);
    });
  }
}

function createStyles() {
  if (document.getElementById(PLAYLET_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PLAYLET_STYLE_ID;
  style.textContent = `
#${PLAYLET_ROOT_ID} {
  position: fixed;
  inset: 16px 16px 16px auto;
  width: min(420px, calc(100vw - 32px));
  z-index: 2147483647;
  color: #111;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#${PLAYLET_ROOT_ID} .playlet-card {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 32px);
  background: linear-gradient(165deg, #fdfdfd 0%, #f3f8ff 100%);
  border: 1px solid #d9e6ff;
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(30, 60, 90, 0.18);
  overflow: hidden;
}
#${PLAYLET_ROOT_ID} .playlet-head {
  padding: 10px 12px;
  border-bottom: 1px solid #e3ecff;
  background: #fff;
}
#${PLAYLET_ROOT_ID} .playlet-title {
  font-size: 14px;
  font-weight: 700;
}
#${PLAYLET_ROOT_ID} .playlet-meta {
  font-size: 12px;
  color: #5a6577;
  margin-top: 4px;
}
#${PLAYLET_ROOT_ID} .playlet-inputs {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
#${PLAYLET_ROOT_ID} input,
#${PLAYLET_ROOT_ID} button,
#${PLAYLET_ROOT_ID} select {
  font: inherit;
}
#${PLAYLET_ROOT_ID} .playlet-input {
  flex: 1;
  min-width: 0;
  padding: 7px 8px;
  border-radius: 8px;
  border: 1px solid #c6d8ff;
  background: #fff;
}
#${PLAYLET_ROOT_ID} .playlet-btn {
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid #3f7ae0;
  background: #3f7ae0;
  color: #fff;
  cursor: pointer;
}
#${PLAYLET_ROOT_ID} .playlet-btn[data-kind="ghost"] {
  background: #fff;
  color: #2f5ca9;
}
#${PLAYLET_ROOT_ID} .playlet-body {
  overflow: auto;
  min-height: 180px;
  padding: 8px;
}
#${PLAYLET_ROOT_ID} .playlet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  margin-bottom: 4px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #e5eeff;
}
#${PLAYLET_ROOT_ID} .playlet-row-main {
  min-width: 0;
}
#${PLAYLET_ROOT_ID} .playlet-row-title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${PLAYLET_ROOT_ID} .playlet-row-sub {
  font-size: 11px;
  color: #6d7889;
}
#${PLAYLET_ROOT_ID} .playlet-foot {
  border-top: 1px solid #dde8ff;
  background: #fff;
  padding: 10px 12px;
}
#${PLAYLET_ROOT_ID} .playlet-now {
  font-size: 12px;
  margin-bottom: 8px;
}
#${PLAYLET_ROOT_ID} .playlet-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}
#${PLAYLET_ROOT_ID} .playlet-range {
  width: 100%;
}
#${PLAYLET_ROOT_ID} .playlet-status {
  font-size: 11px;
  color: #4f5b6d;
  margin-top: 6px;
}
#${PLAYLET_ROOT_ID} .playlet-error {
  margin: 8px;
  padding: 8px;
  border-radius: 8px;
  color: #7f1d1d;
  border: 1px solid #fecaca;
  background: #fee2e2;
  font-size: 12px;
}
`;
  document.head.appendChild(style);
}

function inferDefaultDescUrl() {
  const candidates = [
    "rootDesc.xml",
    "description.xml",
    "/rootDesc.xml",
    "/description.xml",
  ];

  for (const path of candidates) {
    try {
      return new URL(path, location.href).href;
    } catch {
      continue;
    }
  }

  return location.href;
}

function detectMockHint() {
  try {
    const params = new URLSearchParams(location.search);
    const candidate = params.get("playlet_desc");
    if (candidate) return candidate;
  } catch {
    // noop
  }
  return "";
}

function mountRoot() {
  let root = document.getElementById(PLAYLET_ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = PLAYLET_ROOT_ID;
    document.body.appendChild(root);
  }
  return root;
}

function renderBreadcrumb() {
  if (!state.stack.length) return "Root";
  return ["Root", ...state.stack.map((x) => x.title)].join(" / ");
}

function renderEntries() {
  if (state.busy) {
    return '<div class="playlet-row"><div class="playlet-row-title">Loading...</div></div>';
  }

  if (!state.entries.length) {
    return '<div class="playlet-row"><div class="playlet-row-title">No entries found</div></div>';
  }

  return state.entries
    .map((entry, index) => {
      if (entry.kind === "container") {
        return `
<div class="playlet-row" data-entry-index="${index}" data-entry-kind="container">
  <div class="playlet-row-main">
    <div class="playlet-row-title">📁 ${escapeHtml(entry.title)}</div>
    <div class="playlet-row-sub">${entry.childCount} children</div>
  </div>
  <button class="playlet-btn" data-action="enter" data-index="${index}">Open</button>
</div>`;
      }

      const sub = [entry.artist, entry.album].filter(Boolean).join(" · ");
      return `
<div class="playlet-row" data-entry-index="${index}" data-entry-kind="item">
  <div class="playlet-row-main">
    <div class="playlet-row-title">🎵 ${escapeHtml(entry.title)}</div>
    <div class="playlet-row-sub">${escapeHtml(sub || entry.className || "media item")}</div>
  </div>
  <button class="playlet-btn" data-action="play" data-index="${index}" ${entry.playable ? "" : "disabled"}>Play</button>
</div>`;
    })
    .join("");
}

function featureSummary(features) {
  return Object.entries(features)
    .map(([k, v]) => `${k}:${v ? "on" : "off"}`)
    .join(" | ");
}

function createUi(root, mediaAdapter) {
  function render() {
    const status = mediaAdapter.getStatus();
    const descUrl = state.descUrl || "";
    const now = state.nowPlaying;

    root.innerHTML = `
<div class="playlet-card">
  <div class="playlet-head">
    <div class="playlet-title">Playlet</div>
    <div class="playlet-meta">v${escapeHtml(state.version)} · ${escapeHtml(renderBreadcrumb())}</div>
    <div class="playlet-inputs">
      <input class="playlet-input" id="playlet-desc-url" value="${escapeHtml(descUrl)}" placeholder="rootDesc.xml URL" />
      <button class="playlet-btn" data-action="connect">Connect</button>
    </div>
    <div class="playlet-inputs">
      <button class="playlet-btn" data-kind="ghost" data-action="up" ${state.stack.length ? "" : "disabled"}>Up</button>
      <button class="playlet-btn" data-kind="ghost" data-action="refresh" ${state.service ? "" : "disabled"}>Refresh</button>
    </div>
  </div>

  ${state.error ? `<div class="playlet-error">${escapeHtml(state.error)}</div>` : ""}

  <div class="playlet-body">
    ${renderEntries()}
  </div>

  <div class="playlet-foot">
    <div class="playlet-now">Now playing: ${escapeHtml(now?.title || "(none)")}</div>
    <div class="playlet-controls">
      <button class="playlet-btn" data-action="toggle" ${now ? "" : "disabled"}>${status.paused ? "Play" : "Pause"}</button>
      <span>${formatSeconds(status.currentTime)} / ${formatSeconds(status.duration)}</span>
    </div>
    <input class="playlet-range" type="range" min="0" max="1" step="0.01" value="${Number.isFinite(status.volume) ? status.volume : 1}" data-action="volume" />
    <div class="playlet-status">${escapeHtml(featureSummary(status.features))}</div>
  </div>
</div>`;

    bindEvents();
  }

  function bindEvents() {
    root.querySelector('[data-action="connect"]')?.addEventListener("click", async () => {
      const input = root.querySelector("#playlet-desc-url");
      const value = input?.value?.trim();
      if (!value) {
        setState({ error: "Please enter rootDesc.xml URL" });
        return;
      }

      await connectAndLoad(value);
    });

    root.querySelector('[data-action="refresh"]')?.addEventListener("click", async () => {
      await loadCurrent();
    });

    root.querySelector('[data-action="up"]')?.addEventListener("click", async () => {
      if (!state.stack.length) return;
      state.stack.pop();
      await loadCurrent();
    });

    root.querySelector('[data-action="toggle"]')?.addEventListener("click", async () => {
      const status = mediaAdapter.getStatus();
      try {
        if (status.paused) {
          await mediaAdapter.resume();
        } else {
          mediaAdapter.pause();
        }
      } catch (err) {
        setState({ error: `Playback toggle failed: ${err.message}` });
      }
    });

    root.querySelector('[data-action="volume"]')?.addEventListener("input", (evt) => {
      const value = Number(evt.target.value);
      mediaAdapter.setVolume(value);
    });

    root.querySelectorAll('[data-action="enter"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const index = Number(btn.getAttribute("data-index"));
        const entry = state.entries[index];
        if (!entry || entry.kind !== "container") return;

        state.stack.push({ id: entry.id, title: entry.title });
        await loadCurrent();
      });
    });

    root.querySelectorAll('[data-action="play"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const index = Number(btn.getAttribute("data-index"));
        const entry = state.entries[index];
        if (!entry || entry.kind !== "item" || !entry.bestResource) return;

        try {
          await mediaAdapter.playResource(entry.bestResource, {
            title: entry.title,
            artist: entry.artist,
            album: entry.album,
          });
          setState({ nowPlaying: entry, error: "" });
        } catch (err) {
          setState({ error: `Play failed: ${err.message}` });
        }
      });
    });
  }

  async function connectAndLoad(descUrl) {
    try {
      setState({ busy: true, error: "", descUrl });
      const client = await new DlnaClient(descUrl).init();
      state.service = client;
      state.stack = [];
      await loadCurrent();
    } catch (err) {
      setState({ busy: false, error: err.message, entries: [], service: null });
    }
  }

  async function loadCurrent() {
    if (!state.service) return;
    const currentId = state.stack.length ? state.stack[state.stack.length - 1].id : "0";

    try {
      setState({ busy: true, error: "" });
      const entries = await state.service.browse(currentId);
      setState({ entries, busy: false, error: "" });
    } catch (err) {
      setState({ busy: false, error: `Browse failed: ${err.message}` });
    }
  }

  listeners.add(render);
  mediaAdapter.onState = () => render();

  return {
    render,
    connectAndLoad,
  };
}

function installDebug(runtime) {
  window.__playletDebug = {
    getState() {
      return JSON.parse(JSON.stringify(state));
    },
    getLastRequest() {
      return state.service?.lastRequest || null;
    },
    getLastResponse() {
      return state.service?.lastResponse || null;
    },
    getRuntime() {
      return runtime;
    },
  };
}

export async function bootPlaylet({ baseUrl, version }) {
  if (window[PLAYLET_RUNTIME_KEY]?.dispose) {
    window[PLAYLET_RUNTIME_KEY].dispose();
  }

  state.initialized = true;
  state.version = version || "dev";
  state.baseUrl = baseUrl || "";
  state.error = "";
  state.busy = false;
  state.entries = [];
  state.stack = [];

  createStyles();
  const root = mountRoot();
  const mediaAdapter = new HtmlMediaAdapter();
  const ui = createUi(root, mediaAdapter);

  const initialDesc = detectMockHint() || inferDefaultDescUrl();
  setState({ descUrl: initialDesc });
  ui.render();

  const runtime = {
    version,
    baseUrl,
    dispose() {
      listeners.clear();
      mediaAdapter.destroy();
      root.remove();
    },
  };

  window[PLAYLET_RUNTIME_KEY] = runtime;
  installDebug(runtime);

  return runtime;
}

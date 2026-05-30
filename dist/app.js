/* Playlet local-20260530-092133 */
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
  showAdvanced: false,
  service: null,
  serviceName: "",
  treeNodes: {},
  treeTick: 0,
  playlist: [],
  nowPlaying: null,
  nowPlayingPlaylistId: "",
  toast: "",
  error: "",
};

const listeners = new Set();
let toastTimer = null;

function publishState() {
  for (const cb of listeners) cb(state);
}

function setState(next) {
  Object.assign(state, next);
  publishState();
}

function bumpTree() {
  state.treeTick += 1;
  publishState();
}

function clearToastTimer() {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}

function setToast(message, durationMs = 2000) {
  clearToastTimer();
  setState({ toast: message });
  toastTimer = setTimeout(() => {
    setState({ toast: "" });
    toastTimer = null;
  }, durationMs);
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
      return { ...res, protocol, score };
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
    this.serviceName = "";
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

    this.serviceName = textByLocalName(doc, "friendlyName") || "DLNA Device";
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

    this.lastRequest = { url: this.controlUrl, action, objectId, body };

    const res = await fetch(this.controlUrl, {
      method: "POST",
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPAction: `"${this.serviceType}#${action}"`,
      },
      body,
    });

    const xml = await res.text();
    this.lastResponse = { status: res.status, ok: res.ok, xml };

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
    if (!resultNode) return [];

    return parseDidlEntries(resultNode.textContent || "", this.controlUrl);
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
      error: "",
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
    if (this.onState) this.onState(this.getStatus());
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
  inset: 14px 14px 14px auto;
  width: min(520px, calc(100vw - 28px));
  z-index: 2147483647;
  color: #101111;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  pointer-events: auto;
}
#${PLAYLET_ROOT_ID} .playlet-card {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 28px);
  max-height: 940px;
  background: linear-gradient(160deg, #ffffff 0%, #f5f7fa 100%);
  border: 1px solid #d8dde8;
  border-radius: 14px;
  box-shadow: 0 22px 44px rgba(5, 14, 26, 0.2);
  overflow: hidden;
}
#${PLAYLET_ROOT_ID} .playlet-head {
  padding: 10px;
  border-bottom: 1px solid #dde4ef;
  background: #fff;
}
#${PLAYLET_ROOT_ID} .playlet-head-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}
#${PLAYLET_ROOT_ID} .playlet-title {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
#${PLAYLET_ROOT_ID} .playlet-meta {
  font-size: 11px;
  color: #4c5668;
}
#${PLAYLET_ROOT_ID} .playlet-inputs {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
#${PLAYLET_ROOT_ID} input,
#${PLAYLET_ROOT_ID} button {
  font: inherit;
}
#${PLAYLET_ROOT_ID} .playlet-input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid #ced7e6;
  background: #fff;
}
#${PLAYLET_ROOT_ID} .playlet-btn,
#${PLAYLET_ROOT_ID} .playlet-icon-btn {
  border-radius: 7px;
  border: 1px solid #2d6cdf;
  background: #2d6cdf;
  color: #fff;
  cursor: pointer;
}
#${PLAYLET_ROOT_ID} .playlet-btn {
  padding: 6px 9px;
}
#${PLAYLET_ROOT_ID} .playlet-icon-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  line-height: 1;
  font-weight: 700;
}
#${PLAYLET_ROOT_ID} .playlet-btn[data-kind="ghost"],
#${PLAYLET_ROOT_ID} .playlet-icon-btn[data-kind="ghost"] {
  color: #204a97;
  border-color: #bed0f2;
  background: #fff;
}
#${PLAYLET_ROOT_ID} .playlet-btn[disabled],
#${PLAYLET_ROOT_ID} .playlet-icon-btn[disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}
#${PLAYLET_ROOT_ID} .playlet-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
#${PLAYLET_ROOT_ID} .playlet-section-title {
  padding: 6px 10px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: #566071;
  border-top: 1px solid #edf1f6;
  background: #fafbfd;
}
#${PLAYLET_ROOT_ID} .playlet-scroll-zone {
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
#${PLAYLET_ROOT_ID} .playlet-tree,
#${PLAYLET_ROOT_ID} .playlet-playlist {
  padding: 7px;
}
#${PLAYLET_ROOT_ID} .playlet-tree {
  flex: 1;
  min-height: 0;
}
#${PLAYLET_ROOT_ID} .playlet-playlist {
  height: 34%;
  min-height: 92px;
}
#${PLAYLET_ROOT_ID} .playlet-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  margin-bottom: 3px;
  border-radius: 7px;
  border: 1px solid #e7ebf2;
  background: #fff;
}
#${PLAYLET_ROOT_ID} .playlet-row[data-now="1"] {
  border-color: #73a3ff;
  background: #f6f9ff;
}
#${PLAYLET_ROOT_ID} .playlet-row-main {
  min-width: 0;
}
#${PLAYLET_ROOT_ID} .playlet-row-title {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${PLAYLET_ROOT_ID} .playlet-row-sub {
  font-size: 10px;
  color: #6a7486;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${PLAYLET_ROOT_ID} .playlet-row-actions {
  display: flex;
  gap: 4px;
}
#${PLAYLET_ROOT_ID} .playlet-twisty {
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 4px;
  border: 1px solid #c9d6ec;
  background: #fff;
  font-size: 11px;
  color: #2f4d80;
  cursor: pointer;
}
#${PLAYLET_ROOT_ID} .playlet-twisty[disabled] {
  opacity: 0.35;
  cursor: default;
}
#${PLAYLET_ROOT_ID} .playlet-item-indent {
  display: inline-block;
  width: 10px;
  height: 1px;
}
#${PLAYLET_ROOT_ID} .playlet-foot {
  border-top: 1px solid #dde4ef;
  background: #fff;
  padding: 9px 10px 10px;
}
#${PLAYLET_ROOT_ID} .playlet-now {
  font-size: 11px;
  margin-bottom: 8px;
}
#${PLAYLET_ROOT_ID} .playlet-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
#${PLAYLET_ROOT_ID} .playlet-range {
  width: 100%;
  margin-top: 7px;
}
#${PLAYLET_ROOT_ID} .playlet-vol-range {
  width: 120px;
}
#${PLAYLET_ROOT_ID} .playlet-status {
  margin-top: 6px;
  font-size: 10px;
  color: #4d586b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${PLAYLET_ROOT_ID} .playlet-error {
  margin: 6px 10px;
  padding: 7px 8px;
  border-radius: 7px;
  border: 1px solid #f2b9b9;
  color: #7a1b1b;
  background: #fce9e9;
  font-size: 11px;
}
#${PLAYLET_ROOT_ID} .playlet-toast {
  position: absolute;
  right: 12px;
  bottom: 12px;
  background: rgba(16, 19, 28, 0.94);
  color: #fff;
  padding: 6px 9px;
  font-size: 11px;
  border-radius: 7px;
}
#${PLAYLET_ROOT_ID} .playlet-empty {
  color: #6a7486;
  font-size: 11px;
  padding: 7px;
}
`;
  document.head.appendChild(style);
}

function inferDefaultDescUrl() {
  const candidates = ["rootDesc.xml", "description.xml", "/rootDesc.xml", "/description.xml"];
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

function resetTree() {
  state.treeNodes = {
    "0": {
      id: "0",
      parentId: "",
      kind: "container",
      title: "Root",
      childCount: 0,
      expanded: true,
      loading: false,
      childrenLoaded: false,
      childrenIds: [],
    },
  };
  state.treeTick = 0;
}

function getTreeNode(id) {
  return state.treeNodes[id] || null;
}

function ensureTreeNode(node) {
  if (!state.treeNodes[node.id]) {
    state.treeNodes[node.id] = node;
  } else {
    state.treeNodes[node.id] = {
      ...state.treeNodes[node.id],
      ...node,
    };
  }
}

function encodeNodeId(id) {
  return encodeURIComponent(id);
}

function decodeNodeId(id) {
  return decodeURIComponent(id);
}

function treeFlatRows() {
  const out = [];

  function walk(nodeId, depth) {
    const node = getTreeNode(nodeId);
    if (!node) return;

    if (nodeId !== "0") {
      out.push({ node, depth });
    }

    if (node.kind === "container" && node.expanded) {
      for (const childId of node.childrenIds || []) {
        walk(childId, depth + 1);
      }
    }
  }

  walk("0", -1);
  return out;
}

function featureSummary(features) {
  return Object.entries(features)
    .map(([k, v]) => `${k}:${v ? "on" : "off"}`)
    .join(" | ");
}

function playlistRowSub(item) {
  const parts = [item.artist, item.album].filter(Boolean);
  return parts.length ? parts.join(" · ") : item.url;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("copy command rejected");
}

function createUi(root, mediaAdapter) {
  const scrollState = {
    tree: 0,
    playlist: 0,
  };
  let lastTreeSignature = "";
  let lastPlaylistSignature = "";

  function renderTree() {
    if (!state.service) {
      return '<div class="playlet-empty">Not connected. Auto-connect runs on boot.</div>';
    }

    const rows = treeFlatRows();

    if (!rows.length) {
      const rootNode = getTreeNode("0");
      if (rootNode?.loading || state.busy) {
        return '<div class="playlet-empty">Loading media tree...</div>';
      }
      return '<div class="playlet-empty">No entries found</div>';
    }

    return rows
      .map(({ node, depth }) => {
        const indent = Math.max(0, depth) * 14;
        const isContainer = node.kind === "container";
        const toggleText = isContainer ? (node.loading ? "…" : node.expanded ? "-" : "+") : "·";
        const canToggle = isContainer && !node.loading;
        const sub = isContainer ? "" : [node.artist, node.album].filter(Boolean).join(" · ") || node.className || "media item";

        const isNow = state.nowPlaying && node.kind === "item" && state.nowPlaying.id === node.id ? "1" : "0";

        return `
<div class="playlet-row" data-now="${isNow}" style="padding-left:${6 + indent}px">
  <button class="playlet-twisty" data-action="toggle" data-node-id="${encodeNodeId(node.id)}" ${canToggle ? "" : "disabled"}>${toggleText}</button>
  <div class="playlet-row-main">
    <div class="playlet-row-title">${isContainer ? "📁" : "🎵"} ${escapeHtml(node.title)}</div>
    ${sub ? `<div class="playlet-row-sub">${escapeHtml(sub)}</div>` : ""}
  </div>
  <div class="playlet-row-actions">
    ${
      isContainer
        ? ""
        : `<button class="playlet-icon-btn" data-kind="ghost" data-action="copy-url" data-node-id="${encodeNodeId(node.id)}" ${node.playable ? "" : "disabled"}>⧉</button>
           <button class="playlet-icon-btn" data-kind="ghost" data-action="add-playlist" data-node-id="${encodeNodeId(node.id)}" ${node.playable ? "" : "disabled"}>+</button>
           <button class="playlet-icon-btn" data-action="play-item" data-node-id="${encodeNodeId(node.id)}" ${node.playable ? "" : "disabled"}>▶</button>`
    }
  </div>
</div>`;
      })
      .join("");
  }

  function renderPlaylist() {
    if (!state.playlist.length) {
      return '<div class="playlet-empty">Playlist is empty. Use + on a track.</div>';
    }

    return state.playlist
      .map((item, idx) => {
        const isNow = item.id === state.nowPlayingPlaylistId ? "1" : "0";
        return `
<div class="playlet-row" data-now="${isNow}">
  <span class="playlet-item-indent">${idx + 1}</span>
  <div class="playlet-row-main">
    <div class="playlet-row-title">${escapeHtml(item.title)}</div>
    <div class="playlet-row-sub">${escapeHtml(playlistRowSub(item))}</div>
  </div>
  <div class="playlet-row-actions">
    <button class="playlet-icon-btn" data-kind="ghost" data-action="playlist-copy" data-playlist-id="${escapeHtml(item.id)}">⧉</button>
    <button class="playlet-icon-btn" data-kind="ghost" data-action="playlist-remove" data-playlist-id="${escapeHtml(item.id)}">-</button>
    <button class="playlet-icon-btn" data-action="playlist-play" data-playlist-id="${escapeHtml(item.id)}">▶</button>
  </div>
</div>`;
      })
      .join("");
  }

  function render() {
    const status = mediaAdapter.getStatus();
    const now = state.nowPlaying;
    const duration = Number.isFinite(status.duration) && status.duration > 0 ? status.duration : 0;
    const progressMax = duration || 1;
    const progressValue = duration ? Math.max(0, Math.min(status.currentTime || 0, duration)) : 0;

    const nextTreeSignature = treeFlatRows()
      .map(({ node }) => `${node.id}:${node.expanded ? 1 : 0}:${node.loading ? 1 : 0}`)
      .join("|");
    const nextPlaylistSignature = state.playlist.map((x) => x.id).join("|");

    const prevTree = root.querySelector(".playlet-tree");
    const prevPlaylist = root.querySelector(".playlet-playlist");
    if (prevTree && nextTreeSignature !== lastTreeSignature) {
      scrollState.tree = prevTree.scrollTop;
    }
    if (prevPlaylist && nextPlaylistSignature !== lastPlaylistSignature) {
      scrollState.playlist = prevPlaylist.scrollTop;
    }

    root.innerHTML = `
<div class="playlet-card">
  <div class="playlet-head">
    <div class="playlet-head-top">
      <div>
        <div class="playlet-title">Playlet</div>
        <div class="playlet-meta">${escapeHtml(state.serviceName || "Not connected")} · v${escapeHtml(state.version)}</div>
      </div>
      <div class="playlet-row-actions">
        <button class="playlet-btn" data-kind="ghost" data-action="refresh" ${state.service ? "" : "disabled"}>Refresh</button>
        <button class="playlet-btn" data-kind="ghost" data-action="root" ${state.service ? "" : "disabled"}>Root</button>
        <button class="playlet-btn" data-kind="ghost" data-action="advanced">${state.showAdvanced ? "Hide" : "Set URL"}</button>
      </div>
    </div>

    ${
      state.showAdvanced
        ? `<div class="playlet-inputs">
             <input class="playlet-input" id="playlet-desc-url" value="${escapeHtml(state.descUrl || "")}" placeholder="rootDesc.xml URL" />
             <button class="playlet-btn" data-action="connect">Connect</button>
           </div>`
        : ""
    }
  </div>

  ${state.error ? `<div class="playlet-error">${escapeHtml(state.error)}</div>` : ""}

  <div class="playlet-main">
    <div class="playlet-section-title">Library Tree (+/-)</div>
    <div class="playlet-tree playlet-scroll-zone" data-scroll-zone="tree">${renderTree()}</div>
    <div class="playlet-section-title">Playlist (${state.playlist.length})</div>
    <div class="playlet-playlist playlet-scroll-zone" data-scroll-zone="playlist">${renderPlaylist()}</div>
  </div>

  <div class="playlet-foot">
    <div class="playlet-now">Now: ${escapeHtml(now?.title || "(none)")}</div>
    <div class="playlet-controls">
      <button class="playlet-btn" data-action="play-toggle" ${now ? "" : "disabled"}>${status.paused ? "Play" : "Pause"}</button>
      <button class="playlet-btn" data-kind="ghost" data-action="next" ${state.playlist.length ? "" : "disabled"}>Next</button>
      <span>${formatSeconds(status.currentTime)} / ${formatSeconds(status.duration)}</span>
      <span>Vol</span>
      <input class="playlet-vol-range" type="range" min="0" max="1" step="0.01" value="${Number.isFinite(status.volume) ? status.volume : 1}" data-action="volume" />
    </div>
    <input class="playlet-range" type="range" min="0" max="${progressMax}" step="0.1" value="${progressValue}" data-action="seek" ${duration ? "" : "disabled"} />
    <div class="playlet-status">${escapeHtml(featureSummary(status.features))}</div>
  </div>

  ${state.toast ? `<div class="playlet-toast">${escapeHtml(state.toast)}</div>` : ""}
</div>`;

    bindEvents();
    attachScrollIsolation(root);

    const tree = root.querySelector(".playlet-tree");
    const playlist = root.querySelector(".playlet-playlist");
    if (tree) tree.scrollTop = scrollState.tree;
    if (playlist) playlist.scrollTop = scrollState.playlist;

    lastTreeSignature = nextTreeSignature;
    lastPlaylistSignature = nextPlaylistSignature;
  }

  function attachScrollIsolation(rootEl) {
    rootEl.querySelectorAll(".playlet-scroll-zone").forEach((zone) => {
      zone.addEventListener(
        "wheel",
        (evt) => {
          const el = evt.currentTarget;
          const scrollable = el.scrollHeight > el.clientHeight + 1;
          if (!scrollable) return;

          const delta = evt.deltaY;
          const top = el.scrollTop <= 0;
          const bottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          if ((delta < 0 && top) || (delta > 0 && bottom)) {
            evt.preventDefault();
            evt.stopPropagation();
          }
        },
        { passive: false }
      );
    });
  }

  function findPlaylistItem(id) {
    return state.playlist.find((x) => x.id === id) || null;
  }

  async function playNode(node, playlistId = "") {
    if (!node?.bestResource?.url) return;

    try {
      await mediaAdapter.playResource(node.bestResource, {
        title: node.title,
        artist: node.artist,
        album: node.album,
      });
      setState({
        nowPlaying: {
          id: node.id,
          title: node.title,
          artist: node.artist,
          album: node.album,
        },
        nowPlayingPlaylistId: playlistId,
        error: "",
      });
    } catch (err) {
      setState({ error: `Play failed: ${err.message}` });
    }
  }

  async function playPlaylistById(playlistId) {
    const item = findPlaylistItem(playlistId);
    if (!item) return;

    const pseudoNode = {
      id: item.sourceNodeId || item.id,
      title: item.title,
      artist: item.artist,
      album: item.album,
      bestResource: { url: item.url, protocolInfo: item.protocolInfo || "" },
    };

    await playNode(pseudoNode, item.id);
  }

  async function playNextInPlaylist() {
    if (!state.playlist.length) return;

    let nextIdx = 0;
    if (state.nowPlayingPlaylistId) {
      const currentIdx = state.playlist.findIndex((x) => x.id === state.nowPlayingPlaylistId);
      if (currentIdx >= 0) {
        nextIdx = (currentIdx + 1) % state.playlist.length;
      }
    }

    await playPlaylistById(state.playlist[nextIdx].id);
  }

  function addNodeToPlaylist(node) {
    if (!node?.bestResource?.url) return;
    const item = {
      id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceNodeId: node.id,
      title: node.title,
      artist: node.artist || "",
      album: node.album || "",
      durationSeconds: node.durationSeconds || null,
      url: node.bestResource.url,
      protocolInfo: node.bestResource.protocolInfo || "",
    };

    state.playlist.push(item);
    setState({ playlist: state.playlist, error: "" });
    setToast("Added to playlist");
  }

  function removePlaylistItem(id) {
    const idx = state.playlist.findIndex((x) => x.id === id);
    if (idx < 0) return;

    const [removed] = state.playlist.splice(idx, 1);
    const patch = { playlist: state.playlist };
    if (removed.id === state.nowPlayingPlaylistId) {
      patch.nowPlayingPlaylistId = "";
    }
    setState(patch);
  }

  async function loadChildren(nodeId, force = false) {
    if (!state.service) return;

    const node = getTreeNode(nodeId);
    if (!node || node.kind !== "container") return;
    if (node.loading) return;
    if (node.childrenLoaded && !force) return;

    node.loading = true;
    bumpTree();

    try {
      const entries = await state.service.browse(nodeId);
      const childIds = [];
      for (const entry of entries) {
        ensureTreeNode({
          id: entry.id,
          parentId: nodeId,
          kind: entry.kind,
          title: entry.title,
          childCount: entry.childCount || 0,
          expanded: false,
          loading: false,
          childrenLoaded: false,
          childrenIds: [],
          playable: entry.playable || false,
          bestResource: entry.bestResource || null,
          artist: entry.artist || "",
          album: entry.album || "",
          className: entry.className || "",
          durationSeconds: entry.durationSeconds || null,
        });
        childIds.push(entry.id);
      }

      node.childrenIds = childIds;
      node.childrenLoaded = true;
      node.loading = false;
      node.childCount = childIds.length;
      setState({ error: "", busy: false });
      bumpTree();
    } catch (err) {
      node.loading = false;
      setState({ busy: false, error: `Browse failed: ${err.message}` });
      bumpTree();
    }
  }

  async function refreshTree() {
    const rootNode = getTreeNode("0");
    if (!rootNode) return;
    setState({ busy: true });
    rootNode.childrenLoaded = false;
    await loadChildren("0", true);
  }

  async function toggleNode(nodeId) {
    const node = getTreeNode(nodeId);
    if (!node || node.kind !== "container") return;

    node.expanded = !node.expanded;
    bumpTree();

    if (node.expanded) {
      await loadChildren(node.id);
    }
  }

  async function connectAndLoad(descUrl, silentError = false) {
    try {
      setState({ busy: true, error: "", descUrl });
      const client = await new DlnaClient(descUrl).init();
      state.service = client;
      state.serviceName = client.serviceName;
      resetTree();
      setState({
        service: client,
        serviceName: client.serviceName,
        showAdvanced: false,
        busy: false,
        error: "",
      });
      await loadChildren("0");
    } catch (err) {
      setState({
        busy: false,
        service: null,
        serviceName: "",
        error: silentError ? "" : err.message,
        showAdvanced: true,
      });
      if (silentError) {
        setToast("Auto connect failed. Set rootDesc URL.");
      }
    }
  }

  function bindEvents() {
    root.querySelector('[data-action="advanced"]')?.addEventListener("click", () => {
      setState({ showAdvanced: !state.showAdvanced });
    });

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
      await refreshTree();
    });

    root.querySelector('[data-action="root"]')?.addEventListener("click", async () => {
      const rootNode = getTreeNode("0");
      if (!rootNode) return;
      rootNode.expanded = true;
      bumpTree();
      if (!rootNode.childrenLoaded) {
        await loadChildren("0");
      }
    });

    root.querySelector('[data-action="play-toggle"]')?.addEventListener("click", async () => {
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

    root.querySelector('[data-action="next"]')?.addEventListener("click", async () => {
      await playNextInPlaylist();
    });

    root.querySelector('[data-action="volume"]')?.addEventListener("input", (evt) => {
      mediaAdapter.setVolume(Number(evt.target.value));
    });

    root.querySelector('[data-action="seek"]')?.addEventListener("input", (evt) => {
      const value = Number(evt.target.value);
      if (Number.isFinite(value)) {
        mediaAdapter.seek(value);
      }
    });

    root.querySelectorAll('[data-action="toggle"][data-node-id]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const nodeId = decodeNodeId(btn.getAttribute("data-node-id") || "");
        await toggleNode(nodeId);
      });
    });

    root.querySelectorAll('[data-action="play-item"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const nodeId = decodeNodeId(btn.getAttribute("data-node-id") || "");
        const node = getTreeNode(nodeId);
        await playNode(node);
      });
    });

    root.querySelectorAll('[data-action="add-playlist"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const nodeId = decodeNodeId(btn.getAttribute("data-node-id") || "");
        const node = getTreeNode(nodeId);
        addNodeToPlaylist(node);
      });
    });

    root.querySelectorAll('[data-action="copy-url"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const nodeId = decodeNodeId(btn.getAttribute("data-node-id") || "");
        const node = getTreeNode(nodeId);
        const url = node?.bestResource?.url;
        if (!url) return;

        try {
          await copyText(url);
          setToast("Media URL copied");
        } catch (err) {
          setState({ error: `Copy failed: ${err.message}` });
        }
      });
    });

    root.querySelectorAll('[data-action="playlist-remove"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        removePlaylistItem(btn.getAttribute("data-playlist-id") || "");
      });
    });

    root.querySelectorAll('[data-action="playlist-play"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        await playPlaylistById(btn.getAttribute("data-playlist-id") || "");
      });
    });

    root.querySelectorAll('[data-action="playlist-copy"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-playlist-id") || "";
        const item = findPlaylistItem(id);
        if (!item?.url) return;

        try {
          await copyText(item.url);
          setToast("Playlist URL copied");
        } catch (err) {
          setState({ error: `Copy failed: ${err.message}` });
        }
      });
    });
  }

  listeners.add(render);
  mediaAdapter.onState = () => render();

  return {
    render,
    connectAndLoad,
  };
}

function serializeTreeForDebug() {
  return Object.values(state.treeNodes).map((node) => ({
    id: node.id,
    parentId: node.parentId,
    kind: node.kind,
    title: node.title,
    expanded: node.expanded,
    loading: node.loading,
    childrenLoaded: node.childrenLoaded,
    childrenCount: (node.childrenIds || []).length,
  }));
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
    getPlaylist() {
      return JSON.parse(JSON.stringify(state.playlist));
    },
    getTreeState() {
      return serializeTreeForDebug();
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

  clearToastTimer();
  resetTree();

  state.initialized = true;
  state.version = version || "dev";
  state.baseUrl = baseUrl || "";
  state.busy = false;
  state.showAdvanced = false;
  state.service = null;
  state.serviceName = "";
  state.playlist = [];
  state.nowPlaying = null;
  state.nowPlayingPlaylistId = "";
  state.toast = "";
  state.error = "";

  createStyles();
  const root = mountRoot();
  const mediaAdapter = new HtmlMediaAdapter();
  const ui = createUi(root, mediaAdapter);

  const initialDesc = detectMockHint() || inferDefaultDescUrl();
  setState({ descUrl: initialDesc });
  ui.render();

  // Auto connect first, reveal advanced input only when failed.
  await ui.connectAndLoad(initialDesc, true);

  const runtime = {
    version,
    baseUrl,
    dispose() {
      clearToastTimer();
      listeners.clear();
      mediaAdapter.destroy();
      root.remove();
    },
  };

  window[PLAYLET_RUNTIME_KEY] = runtime;
  installDebug(runtime);
  return runtime;
}

const PLAYLET_ROOT_ID = "playlet-root";
const PLAYLET_STYLE_ID = "playlet-style";
const PLAYLET_RUNTIME_KEY = "__playletRuntime";
const CONTENT_DIRECTORY_SERVICE = "urn:schemas-upnp-org:service:ContentDirectory:1";
const PLAYLET_STORAGE_KEY = "__playletPrefsV1";
const MODE_LOOP_ALL = "loop_all";
const MODE_LOOP_ONE = "loop_one";
const PLAY_MODES = [MODE_LOOP_ALL, MODE_LOOP_ONE];
const SEARCH_MODE_DLNA = "dlna";
const SEARCH_MODE_LOCAL_TREE = "local_tree";
const SEARCH_MODE_LOCAL_FULL = "local_full";
const SEARCH_MODES = [SEARCH_MODE_DLNA, SEARCH_MODE_LOCAL_TREE, SEARCH_MODE_LOCAL_FULL];

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
  libraryTab: "tree",
  searchMode: SEARCH_MODE_DLNA,
  searchQuery: "",
  searchBusy: false,
  searchStatus: "",
  searchResults: [],
  searchResultNodes: {},
  playlist: [],
  stars: {},
  playMode: MODE_LOOP_ALL,
  listTab: "playlist",
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

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage quota/permission failures
  }
}

function savePrefsToStorage() {
  const payload = {
    playMode: state.playMode,
    stars: state.stars,
  };
  safeLocalStorageSet(PLAYLET_STORAGE_KEY, JSON.stringify(payload));
}

function loadPrefsFromStorage() {
  const raw = safeLocalStorageGet(PLAYLET_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      playMode: PLAY_MODES.includes(parsed?.playMode) ? parsed.playMode : MODE_LOOP_ALL,
      stars: parsed?.stars && typeof parsed.stars === "object" ? parsed.stars : {},
    };
  } catch {
    return null;
  }
}

function modeLabel(mode) {
  if (mode === MODE_LOOP_ONE) return "1";
  return "∞";
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
    this.searchAvailable = true;
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

  async search(containerId = "0", searchCriteria = "", start = 0, count = 200, sortCriteria = "") {
    if (this.searchAvailable === false) {
      const err = new Error("DLNA Search action not available");
      err.code = "SEARCH_UNAVAILABLE";
      throw err;
    }

    const action = "Search";
    const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Search xmlns:u="${this.serviceType}">
      <ContainerID>${escapeHtml(containerId)}</ContainerID>
      <SearchCriteria>${escapeHtml(searchCriteria)}</SearchCriteria>
      <Filter>*</Filter>
      <StartingIndex>${start}</StartingIndex>
      <RequestedCount>${count}</RequestedCount>
      <SortCriteria>${escapeHtml(sortCriteria)}</SortCriteria>
    </u:Search>
  </s:Body>
</s:Envelope>`;

    this.lastRequest = { url: this.controlUrl, action, containerId, searchCriteria, body };

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

    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      throw new Error(`SOAP parse failed: ${parseError.textContent?.trim() || "Unknown parser error"}`);
    }

    const fault = firstElementByLocalName(doc, "Fault");
    if (fault) {
      const faultText = fault.textContent?.trim() || "Unknown fault";
      if (faultText.includes("401") || faultText.toLowerCase().includes("invalid action")) {
        this.searchAvailable = false;
        const err = new Error("DLNA Search action not available");
        err.code = "SEARCH_UNAVAILABLE";
        throw err;
      }
      throw new Error(`SOAP Fault: ${faultText}`);
    }

    if (!res.ok) {
      throw new Error(`Search failed: ${res.status} ${res.statusText}`);
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
    this.audio.controls = true;
    this.audio.playsInline = true;

    this.features = {
      pip: typeof document.pictureInPictureEnabled === "boolean",
      mediaSession: "mediaSession" in navigator,
      remotePlayback: "remote" in this.audio,
      castCandidate: "PresentationRequest" in window,
      mse: "MediaSource" in window,
      webCodecs: "VideoDecoder" in window,
    };

    this.boundEmit = this.emitState.bind(this);
    ["play", "pause", "ended", "volumechange", "loadedmetadata", "error"].forEach((evt) => {
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

  getElement() {
    return this.audio;
  }

  destroy() {
    this.audio.pause();
    this.audio.src = "";
    ["play", "pause", "ended", "volumechange", "loadedmetadata", "error"].forEach((evt) => {
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
#${PLAYLET_ROOT_ID} .playlet-row.dragging {
  opacity: 0.45;
}
#${PLAYLET_ROOT_ID} .playlet-row.drop-target {
  outline: 2px dashed #7ca4ec;
  outline-offset: 1px;
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
#${PLAYLET_ROOT_ID} .playlet-tree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
#${PLAYLET_ROOT_ID} .playlet-tree {
  flex: 1;
  min-height: 0;
}
#${PLAYLET_ROOT_ID} .playlet-library-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
#${PLAYLET_ROOT_ID} .playlet-search-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
#${PLAYLET_ROOT_ID} .playlet-search-bar {
  display: flex;
  gap: 6px;
  align-items: center;
}
#${PLAYLET_ROOT_ID} .playlet-search-input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid #ced7e6;
  background: #fff;
}
#${PLAYLET_ROOT_ID} .playlet-search-meta {
  display: flex;
  gap: 6px;
  align-items: center;
  color: #5d6a82;
  font-size: 10px;
}
#${PLAYLET_ROOT_ID} .playlet-playlist {
  height: 34%;
  min-height: 92px;
}
#${PLAYLET_ROOT_ID} .playlet-tabs {
  display: flex;
  gap: 6px;
  align-items: center;
}
#${PLAYLET_ROOT_ID} .playlet-tab {
  border: 1px solid #bed0f2;
  color: #204a97;
  background: #fff;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
  cursor: pointer;
}
#${PLAYLET_ROOT_ID} .playlet-tab[data-active="1"] {
  background: #2d6cdf;
  border-color: #2d6cdf;
  color: #fff;
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
#${PLAYLET_ROOT_ID} .playlet-folder-count {
  margin-left: 6px;
  font-size: 10px;
  color: #6a7486;
  opacity: 0;
  transition: opacity 120ms ease;
}
#${PLAYLET_ROOT_ID} .playlet-row[data-kind="container"]:hover .playlet-folder-count,
#${PLAYLET_ROOT_ID} .playlet-row[data-kind="container"]:focus-within .playlet-folder-count {
  opacity: 1;
}
#${PLAYLET_ROOT_ID} .playlet-row-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}
#${PLAYLET_ROOT_ID} .playlet-row:hover .playlet-row-actions,
#${PLAYLET_ROOT_ID} .playlet-row:focus-within .playlet-row-actions,
#${PLAYLET_ROOT_ID} .playlet-row[data-now="1"] .playlet-row-actions {
  opacity: 1;
  pointer-events: auto;
}
@media (hover: none), (pointer: coarse) {
  #${PLAYLET_ROOT_ID} .playlet-row-actions {
    opacity: 1;
    pointer-events: auto;
  }
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
#${PLAYLET_ROOT_ID} .playlet-track-index {
  display: inline-block;
  width: 24px;
  text-align: right;
  padding-right: 2px;
  font-variant-numeric: tabular-nums;
  color: #53617a;
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
  flex-wrap: wrap;
}
#${PLAYLET_ROOT_ID} .playlet-control-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-right: 4px;
  margin-right: 2px;
  border-right: 1px solid #dde4ef;
}
#${PLAYLET_ROOT_ID} .playlet-control-group:last-of-type {
  border-right: 0;
  padding-right: 0;
  margin-right: 0;
}
#${PLAYLET_ROOT_ID} .playlet-now-inline {
  font-size: 11px;
  color: #334158;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  max-width: 52%;
}
#${PLAYLET_ROOT_ID} .playlet-range {
  width: 100%;
  margin-top: 7px;
}
#${PLAYLET_ROOT_ID} .playlet-vol-range {
  width: 120px;
}
#${PLAYLET_ROOT_ID} .playlet-native-audio audio {
  width: 100%;
  margin-top: 8px;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
#${PLAYLET_ROOT_ID} .playlet-error-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#${PLAYLET_ROOT_ID} .playlet-error-close {
  border: 1px solid #e39e9e;
  background: #fff6f6;
  color: #7a1b1b;
  border-radius: 6px;
  width: 20px;
  height: 20px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
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

function searchModeLabel(mode) {
  if (mode === SEARCH_MODE_LOCAL_TREE) return "Local: Tree";
  if (mode === SEARCH_MODE_LOCAL_FULL) return "Local: Full";
  return "DLNA";
}

function escapeSearchValue(input) {
  return String(input || "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function buildDlnaSearchCriteria(keyword) {
  const q = escapeSearchValue(keyword);
  return `upnp:class derivedfrom "object.item.audioItem" and (dc:title contains "${q}" or upnp:artist contains "${q}" or upnp:album contains "${q}")`;
}

function textMatchesKeyword(node, keyword) {
  const q = String(keyword || "").trim().toLowerCase();
  if (!q) return false;
  const fields = [node.title, node.artist, node.album, node.className];
  return fields.some((x) => String(x || "").toLowerCase().includes(q));
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
  const MAX_BULK_ADD = 500;
  let errorTimer = null;

  function clearErrorTimer() {
    if (errorTimer) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
  }

  function setError(message, { autoHideMs = 0 } = {}) {
    clearErrorTimer();
    setState({ error: message || "" });
    if (message && autoHideMs > 0) {
      errorTimer = setTimeout(() => {
        setState({ error: "" });
        errorTimer = null;
      }, autoHideMs);
    }
  }

  root.innerHTML = `
<div class="playlet-card">
  <div class="playlet-head">
    <div class="playlet-head-top">
      <div>
        <div class="playlet-title">Playlet</div>
        <div class="playlet-meta" data-role="meta"></div>
      </div>
      <div class="playlet-row-actions">
        <button class="playlet-btn" data-kind="ghost" data-action="refresh">Refresh</button>
        <button class="playlet-btn" data-kind="ghost" data-action="root">Root</button>
        <button class="playlet-btn" data-kind="ghost" data-action="advanced">Set URL</button>
      </div>
    </div>
    <div class="playlet-inputs" data-role="advanced-wrap" style="display:none">
      <input class="playlet-input" data-role="desc-input" placeholder="rootDesc.xml URL" />
      <button class="playlet-btn" data-action="connect">Connect</button>
    </div>
  </div>
  <div class="playlet-error" data-role="error" style="display:none">
    <span class="playlet-error-text" data-role="error-text"></span>
    <button class="playlet-error-close" data-action="error-dismiss" title="Dismiss">×</button>
  </div>
  <div class="playlet-main">
    <div class="playlet-section-title">
      <div class="playlet-tree-head">
        <span>Library</span>
        <div class="playlet-tabs">
          <button class="playlet-tab" data-action="tab-library-tree" data-role="tab-library-tree">Tree</button>
          <button class="playlet-tab" data-action="tab-library-search" data-role="tab-library-search">Search</button>
        </div>
      </div>
    </div>
    <div class="playlet-library-panel playlet-scroll-zone" data-role="library-panel" data-scroll-zone="tree">
      <div class="playlet-tree" data-role="tree"></div>
      <div class="playlet-tree playlet-search-panel" data-role="search-panel" style="display:none">
        <div class="playlet-search-bar">
          <input class="playlet-search-input" data-role="search-input" placeholder="Search title / artist / album" />
          <button class="playlet-btn" data-kind="ghost" data-action="search-run">Search</button>
        </div>
        <div class="playlet-search-meta">
          <button class="playlet-tab" data-action="search-mode-dlna" data-role="search-mode-dlna">DLNA</button>
          <button class="playlet-tab" data-action="search-mode-local-tree" data-role="search-mode-local-tree">Local: Tree</button>
          <button class="playlet-tab" data-action="search-mode-local-full" data-role="search-mode-local-full">Local: Full</button>
        </div>
        <div class="playlet-row-sub" data-role="search-status"></div>
        <div data-role="search-results"></div>
      </div>
    </div>
    <div class="playlet-section-title">
      <div class="playlet-tabs">
        <button class="playlet-tab" data-action="tab-playlist" data-role="tab-playlist">Playlist (0)</button>
        <button class="playlet-tab" data-action="tab-favorites" data-role="tab-favorites">Favorites (0)</button>
      </div>
    </div>
    <div class="playlet-playlist playlet-scroll-zone" data-role="playlist" data-scroll-zone="playlist"></div>
  </div>
  <div class="playlet-foot">
    <div class="playlet-controls">
      <div class="playlet-control-group">
        <button class="playlet-btn" data-action="play-toggle">Play</button>
        <button class="playlet-btn" data-kind="ghost" data-action="prev">Prev</button>
        <button class="playlet-btn" data-kind="ghost" data-action="next">Next</button>
      </div>
      <div class="playlet-control-group">
        <button class="playlet-btn" data-kind="ghost" data-action="playlist-clear" data-role="playlist-clear">Clear</button>
        <button class="playlet-btn" data-kind="ghost" data-action="shuffle-playlist" data-role="shuffle-playlist">Shuffle</button>
      </div>
      <div class="playlet-control-group">
        <button class="playlet-btn" data-kind="ghost" data-action="cycle-mode" data-role="mode-btn" title="play mode"></button>
      </div>
      <div class="playlet-now-inline" data-role="now"></div>
    </div>
    <div class="playlet-native-audio" data-role="native-audio"></div>
    <div class="playlet-status" data-role="status"></div>
  </div>
  <div class="playlet-toast" data-role="toast" style="display:none"></div>
</div>`;

  const refs = {
    meta: root.querySelector('[data-role="meta"]'),
    refreshBtn: root.querySelector('[data-action="refresh"]'),
    rootBtn: root.querySelector('[data-action="root"]'),
    advancedBtn: root.querySelector('[data-action="advanced"]'),
    advancedWrap: root.querySelector('[data-role="advanced-wrap"]'),
    descInput: root.querySelector('[data-role="desc-input"]'),
    error: root.querySelector('[data-role="error"]'),
    errorText: root.querySelector('[data-role="error-text"]'),
    tabLibraryTree: root.querySelector('[data-role="tab-library-tree"]'),
    tabLibrarySearch: root.querySelector('[data-role="tab-library-search"]'),
    libraryPanel: root.querySelector('[data-role="library-panel"]'),
    tree: root.querySelector('[data-role="tree"]'),
    searchPanel: root.querySelector('[data-role="search-panel"]'),
    searchInput: root.querySelector('[data-role="search-input"]'),
    searchStatus: root.querySelector('[data-role="search-status"]'),
    searchResults: root.querySelector('[data-role="search-results"]'),
    searchModeDlna: root.querySelector('[data-role="search-mode-dlna"]'),
    searchModeLocalTree: root.querySelector('[data-role="search-mode-local-tree"]'),
    searchModeLocalFull: root.querySelector('[data-role="search-mode-local-full"]'),
    tabPlaylist: root.querySelector('[data-role="tab-playlist"]'),
    tabFavorites: root.querySelector('[data-role="tab-favorites"]'),
    playlistClearBtn: root.querySelector('[data-role="playlist-clear"]'),
    shuffleBtn: root.querySelector('[data-role="shuffle-playlist"]'),
    playlist: root.querySelector('[data-role="playlist"]'),
    now: root.querySelector('[data-role="now"]'),
    playToggleBtn: root.querySelector('[data-action="play-toggle"]'),
    prevBtn: root.querySelector('[data-action="prev"]'),
    nextBtn: root.querySelector('[data-action="next"]'),
    modeBtn: root.querySelector('[data-role="mode-btn"]'),
    nativeAudioHost: root.querySelector('[data-role="native-audio"]'),
    status: root.querySelector('[data-role="status"]'),
    toast: root.querySelector('[data-role="toast"]'),
  };

  function attachScrollIsolation(zone) {
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
  }
  attachScrollIsolation(refs.libraryPanel);
  attachScrollIsolation(refs.playlist);

  let playlistDragId = "";
  const fullSearchIndex = { built: false, building: false, items: [] };

  function renderTreeRows() {
    const frag = document.createDocumentFragment();
    if (!state.service) {
      const empty = document.createElement("div");
      empty.className = "playlet-empty";
      empty.textContent = "Not connected. Auto-connect runs on boot.";
      frag.appendChild(empty);
      return frag;
    }

    const rows = treeFlatRows();
    if (!rows.length) {
      const rootNode = getTreeNode("0");
      const empty = document.createElement("div");
      empty.className = "playlet-empty";
      empty.textContent = rootNode?.loading || state.busy ? "Loading media tree..." : "No entries found";
      frag.appendChild(empty);
      return frag;
    }

    for (const { node, depth } of rows) {
      const indent = Math.max(0, depth) * 14;
      const isContainer = node.kind === "container";
      const sub = isContainer ? "" : [node.artist, node.album].filter(Boolean).join(" · ") || node.className || "media item";
      const row = document.createElement("div");
      row.className = "playlet-row";
      row.dataset.kind = node.kind;
      row.style.paddingLeft = `${6 + indent}px`;
      if (state.nowPlaying && node.kind === "item" && state.nowPlaying.id === node.id) {
        row.dataset.now = "1";
      }

      const twisty = document.createElement("button");
      twisty.className = "playlet-twisty";
      twisty.dataset.action = "toggle";
      twisty.dataset.nodeId = node.id;
      twisty.textContent = isContainer ? (node.loading ? "…" : node.expanded ? "-" : "+") : "·";
      if (!isContainer || node.loading) twisty.disabled = true;

      const main = document.createElement("div");
      main.className = "playlet-row-main";
      const title = document.createElement("div");
      title.className = "playlet-row-title";
      title.textContent = `${isContainer ? "📁" : "🎵"} ${node.title}`;
      if (isContainer) {
        const count = document.createElement("span");
        count.className = "playlet-folder-count";
        count.textContent = `${node.childCount || 0} items`;
        title.appendChild(count);
      }
      main.appendChild(title);
      if (sub) {
        const subEl = document.createElement("div");
        subEl.className = "playlet-row-sub";
        subEl.textContent = sub;
        main.appendChild(subEl);
      }

      const actions = document.createElement("div");
      actions.className = "playlet-row-actions";
      if (isContainer) {
        const addAll = document.createElement("button");
        addAll.className = "playlet-icon-btn";
        addAll.dataset.kind = "ghost";
        addAll.dataset.action = "add-folder-playlist";
        addAll.dataset.nodeId = node.id;
        addAll.textContent = "≡+";
        actions.appendChild(addAll);
      } else {
        const copy = document.createElement("button");
        copy.className = "playlet-icon-btn";
        copy.dataset.kind = "ghost";
        copy.dataset.action = "copy-url";
        copy.dataset.nodeId = node.id;
        copy.textContent = "⧉";
        copy.disabled = !node.playable;

        const add = document.createElement("button");
        add.className = "playlet-icon-btn";
        add.dataset.kind = "ghost";
        add.dataset.action = "add-playlist";
        add.dataset.nodeId = node.id;
        add.textContent = "+";
        add.disabled = !node.playable;

        const star = document.createElement("button");
        star.className = "playlet-icon-btn";
        star.dataset.kind = "ghost";
        star.dataset.action = "toggle-star";
        star.dataset.nodeId = node.id;
        star.textContent = state.stars[node.id] ? "★" : "☆";
        star.disabled = !node.playable;

        const play = document.createElement("button");
        play.className = "playlet-icon-btn";
        play.dataset.action = "play-item";
        play.dataset.nodeId = node.id;
        play.textContent = "▶";
        play.disabled = !node.playable;

        actions.appendChild(copy);
        actions.appendChild(star);
        actions.appendChild(add);
        actions.appendChild(play);
      }

      row.appendChild(twisty);
      row.appendChild(main);
      row.appendChild(actions);
      frag.appendChild(row);
    }
    return frag;
  }

  function buildTrackRow(item, idx, context) {
    const row = document.createElement("div");
    row.className = "playlet-row";
    if (item.id === state.nowPlayingPlaylistId) row.dataset.now = "1";
    if (context === "playlist") {
      row.draggable = true;
      row.dataset.dragId = item.id;
    }

    const index = document.createElement("span");
    index.className = "playlet-track-index";
    index.textContent = String(idx + 1);

    const main = document.createElement("div");
    main.className = "playlet-row-main";
    const title = document.createElement("div");
    title.className = "playlet-row-title";
    title.textContent = item.title;
    const sub = document.createElement("div");
    sub.className = "playlet-row-sub";
    sub.textContent = playlistRowSub(item);
    main.appendChild(title);
    main.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "playlet-row-actions";

    const copy = document.createElement("button");
    copy.className = "playlet-icon-btn";
    copy.dataset.kind = "ghost";
    copy.dataset.action = context === "playlist" ? "playlist-copy" : "favorite-copy";
    copy.dataset.playlistId = item.id;
    copy.textContent = "⧉";

    const play = document.createElement("button");
    play.className = "playlet-icon-btn";
    play.dataset.action = context === "playlist" ? "playlist-play" : "favorite-play";
    play.dataset.playlistId = item.id;
    play.textContent = "▶";

    const star = document.createElement("button");
    star.className = "playlet-icon-btn";
    star.dataset.kind = "ghost";
    star.dataset.action = "toggle-star-playlist";
    star.dataset.nodeId = item.sourceNodeId || item.id;
    star.textContent = state.stars[item.sourceNodeId || item.id] ? "★" : "☆";

    actions.append(copy, star, play);

    if (context === "playlist") {
      const remove = document.createElement("button");
      remove.className = "playlet-icon-btn";
      remove.dataset.kind = "ghost";
      remove.dataset.action = "playlist-remove";
      remove.dataset.playlistId = item.id;
      remove.textContent = "-";
      actions.insertBefore(remove, play);
    }

    row.append(index, main, actions);
    return row;
  }

  function renderPlaylistRows() {
    const frag = document.createDocumentFragment();
    if (!state.playlist.length) {
      const empty = document.createElement("div");
      empty.className = "playlet-empty";
      empty.textContent = "Playlist is empty. Use + on a track.";
      frag.appendChild(empty);
      return frag;
    }

    state.playlist.forEach((item, idx) => {
      frag.appendChild(buildTrackRow(item, idx, "playlist"));
    });

    return frag;
  }

  function buildSearchRow(node) {
    const row = document.createElement("div");
    row.className = "playlet-row";
    row.dataset.kind = node.kind;
    row.dataset.searchNodeId = node.id;

    const left = document.createElement("span");
    left.className = "playlet-item-indent";

    const main = document.createElement("div");
    main.className = "playlet-row-main";
    const title = document.createElement("div");
    title.className = "playlet-row-title";
    title.textContent = `${node.kind === "container" ? "📁" : "🎵"} ${node.title}`;
    const sub = document.createElement("div");
    sub.className = "playlet-row-sub";
    sub.textContent =
      node.kind === "container"
        ? `${node.childCount || 0} items`
        : [node.artist, node.album].filter(Boolean).join(" · ") || node.className || "media item";
    main.append(title, sub);

    const actions = document.createElement("div");
    actions.className = "playlet-row-actions";
    actions.style.opacity = "1";
    actions.style.pointerEvents = "auto";

    if (node.kind === "item") {
      const copy = document.createElement("button");
      copy.className = "playlet-icon-btn";
      copy.dataset.kind = "ghost";
      copy.dataset.action = "search-copy-url";
      copy.dataset.searchNodeId = node.id;
      copy.textContent = "⧉";
      copy.disabled = !node.playable;

      const star = document.createElement("button");
      star.className = "playlet-icon-btn";
      star.dataset.kind = "ghost";
      star.dataset.action = "search-toggle-star";
      star.dataset.searchNodeId = node.id;
      star.textContent = state.stars[node.id] ? "★" : "☆";
      star.disabled = !node.playable;

      const add = document.createElement("button");
      add.className = "playlet-icon-btn";
      add.dataset.kind = "ghost";
      add.dataset.action = "search-add-playlist";
      add.dataset.searchNodeId = node.id;
      add.textContent = "+";
      add.disabled = !node.playable;

      const play = document.createElement("button");
      play.className = "playlet-icon-btn";
      play.dataset.action = "search-play-item";
      play.dataset.searchNodeId = node.id;
      play.textContent = "▶";
      play.disabled = !node.playable;

      actions.append(copy, star, add, play);
    }

    row.append(left, main, actions);
    return row;
  }

  function renderSearchRows() {
    const frag = document.createDocumentFragment();
    if (state.searchBusy) {
      const empty = document.createElement("div");
      empty.className = "playlet-empty";
      empty.textContent = "Searching...";
      frag.appendChild(empty);
      return frag;
    }
    if (!state.searchResults.length) {
      const empty = document.createElement("div");
      empty.className = "playlet-empty";
      empty.textContent = state.searchQuery ? "No results" : "Enter keyword and run Search.";
      frag.appendChild(empty);
      return frag;
    }
    for (const node of state.searchResults) {
      frag.appendChild(buildSearchRow(node));
    }
    return frag;
  }

  function getFavoriteItems() {
    return state.playlist.filter((item) => state.stars[item.sourceNodeId || item.id]);
  }

  function renderFavoritesRows() {
    const frag = document.createDocumentFragment();
    const favorites = getFavoriteItems();
    if (!favorites.length) {
      const empty = document.createElement("div");
      empty.className = "playlet-empty";
      empty.textContent = "No favorites yet. Use ☆/★.";
      frag.appendChild(empty);
      return frag;
    }
    favorites.forEach((item, idx) => {
      frag.appendChild(buildTrackRow(item, idx, "favorite"));
    });
    return frag;
  }

  function renderHeaderAndStatus() {
    refs.meta.textContent = `${state.serviceName || "Not connected"} · v${state.version}`;
    refs.refreshBtn.disabled = !state.service;
    refs.rootBtn.disabled = !state.service;
    refs.advancedBtn.textContent = state.showAdvanced ? "Hide" : "Set URL";
    refs.advancedWrap.style.display = state.showAdvanced ? "flex" : "none";
    refs.descInput.value = state.descUrl || "";

    if (state.error) {
      refs.error.style.display = "block";
      refs.errorText.textContent = state.error;
    } else {
      refs.error.style.display = "none";
      refs.errorText.textContent = "";
    }

    refs.tabPlaylist.textContent = `Playlist (${state.playlist.length})`;
    refs.tabFavorites.textContent = `Favorites (${getFavoriteItems().length})`;
    refs.tabLibraryTree.dataset.active = state.libraryTab === "tree" ? "1" : "0";
    refs.tabLibrarySearch.dataset.active = state.libraryTab === "search" ? "1" : "0";
    refs.searchModeDlna.dataset.active = state.searchMode === SEARCH_MODE_DLNA ? "1" : "0";
    refs.searchModeLocalTree.dataset.active = state.searchMode === SEARCH_MODE_LOCAL_TREE ? "1" : "0";
    refs.searchModeLocalFull.dataset.active = state.searchMode === SEARCH_MODE_LOCAL_FULL ? "1" : "0";
    refs.searchInput.value = state.searchQuery;
    refs.searchStatus.textContent = state.searchStatus || `Mode: ${searchModeLabel(state.searchMode)}`;
    refs.tabPlaylist.dataset.active = state.listTab === "playlist" ? "1" : "0";
    refs.tabFavorites.dataset.active = state.listTab === "favorites" ? "1" : "0";
    refs.playlistClearBtn.disabled = !state.playlist.length;
    refs.shuffleBtn.disabled = state.playlist.length < 2;
    if (refs.modeBtn) refs.modeBtn.textContent = modeLabel(state.playMode);
    refs.tree.style.display = state.libraryTab === "tree" ? "" : "none";
    refs.searchPanel.style.display = state.libraryTab === "search" ? "" : "none";
  }

  function renderPlayerOnly() {
    const status = mediaAdapter.getStatus();
    refs.now.textContent = `Now: ${state.nowPlaying?.title || "(none)"}`;
    refs.playToggleBtn.disabled = !state.nowPlaying;
    refs.playToggleBtn.textContent = status.paused ? "Play" : "Pause";
    refs.prevBtn.disabled = !state.playlist.length;
    refs.nextBtn.disabled = !state.playlist.length;
    refs.status.textContent = featureSummary(status.features);

    if (refs.nativeAudioHost && typeof mediaAdapter.getElement === "function") {
      const audioEl = mediaAdapter.getElement();
      if (audioEl && audioEl.parentNode !== refs.nativeAudioHost) {
        refs.nativeAudioHost.appendChild(audioEl);
      }
    }
  }

  function renderToast() {
    if (state.toast) {
      refs.toast.style.display = "block";
      refs.toast.textContent = state.toast;
    } else {
      refs.toast.style.display = "none";
      refs.toast.textContent = "";
    }
  }

  function renderTreeSection() {
    const top = refs.tree.scrollTop;
    refs.tree.replaceChildren(renderTreeRows());
    refs.tree.scrollTop = top;
  }

  function renderSearchSection() {
    const top = refs.searchResults.scrollTop;
    refs.searchResults.replaceChildren(renderSearchRows());
    refs.searchResults.scrollTop = top;
  }

  function renderListSection() {
    const top = refs.playlist.scrollTop;
    refs.playlist.replaceChildren(state.listTab === "favorites" ? renderFavoritesRows() : renderPlaylistRows());
    refs.playlist.scrollTop = top;
  }

  function render() {
    renderHeaderAndStatus();
    renderTreeSection();
    renderSearchSection();
    renderListSection();
    renderPlayerOnly();
    renderToast();
  }

  function findPlaylistItem(id) {
    return state.playlist.find((x) => x.id === id) || null;
  }

  function findSearchNode(id) {
    return state.searchResultNodes[id] || getTreeNode(id) || null;
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
      setError(`Play failed: ${err.message}`, { autoHideMs: 4500 });
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

    if (state.playMode === MODE_LOOP_ONE && state.nowPlayingPlaylistId) {
      await playPlaylistById(state.nowPlayingPlaylistId);
      return;
    }

    let nextIdx = 0;
    if (state.nowPlayingPlaylistId) {
      const currentIdx = state.playlist.findIndex((x) => x.id === state.nowPlayingPlaylistId);
      if (currentIdx >= 0) {
        nextIdx = (currentIdx + 1) % state.playlist.length;
      }
    }

    await playPlaylistById(state.playlist[nextIdx].id);
  }

  async function playPrevInPlaylist() {
    if (!state.playlist.length) return;
    if (!state.nowPlayingPlaylistId) {
      await playPlaylistById(state.playlist[0].id);
      return;
    }
    const currentIdx = state.playlist.findIndex((x) => x.id === state.nowPlayingPlaylistId);
    if (currentIdx < 0) {
      await playPlaylistById(state.playlist[0].id);
      return;
    }
    const prevIdx = (currentIdx - 1 + state.playlist.length) % state.playlist.length;
    await playPlaylistById(state.playlist[prevIdx].id);
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

  function mergeSearchResults(nodes) {
    const map = {};
    const uniq = [];
    for (const node of nodes) {
      if (!node?.id || map[node.id]) continue;
      map[node.id] = true;
      uniq.push(node);
      state.searchResultNodes[node.id] = node;
      if (!getTreeNode(node.id)) {
        ensureTreeNode({
          id: node.id,
          parentId: node.parentId || "",
          kind: node.kind || "item",
          title: node.title || "(untitled)",
          childCount: node.childCount || 0,
          expanded: false,
          loading: false,
          childrenLoaded: false,
          childrenIds: [],
          playable: node.playable || false,
          bestResource: node.bestResource || null,
          artist: node.artist || "",
          album: node.album || "",
          className: node.className || "",
          durationSeconds: node.durationSeconds || null,
        });
      }
    }
    return uniq;
  }

  async function buildLocalFullIndex() {
    if (!state.service) return [];
    if (fullSearchIndex.built) return fullSearchIndex.items;
    if (fullSearchIndex.building) {
      while (fullSearchIndex.building) {
        await new Promise((r) => setTimeout(r, 80));
      }
      return fullSearchIndex.items;
    }
    fullSearchIndex.building = true;
    const out = [];
    const seen = new Set();
    const queue = ["0"];
    while (queue.length) {
      const containerId = queue.shift();
      if (!containerId || seen.has(containerId)) continue;
      seen.add(containerId);
      const entries = await state.service.browse(containerId, 0, 500);
      for (const entry of entries) {
        out.push(entry);
        if (entry.kind === "container") queue.push(entry.id);
      }
      setState({ searchStatus: `Indexing... ${out.length} entries` });
    }
    fullSearchIndex.items = out;
    fullSearchIndex.built = true;
    fullSearchIndex.building = false;
    return out;
  }

  function invalidateFullSearchIndex() {
    fullSearchIndex.built = false;
    fullSearchIndex.building = false;
    fullSearchIndex.items = [];
  }

  function setMediaSessionActionHandler(action, handler) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Some browsers do not support all actions.
    }
  }

  function installMediaSessionTrackHandlers() {
    setMediaSessionActionHandler("previoustrack", async () => {
      try {
        await playPrevInPlaylist();
      } catch (err) {
        setError(`Previous track failed: ${err.message}`, { autoHideMs: 4500 });
      }
    });
    setMediaSessionActionHandler("nexttrack", async () => {
      try {
        await playNextInPlaylist();
      } catch (err) {
        setError(`Next track failed: ${err.message}`, { autoHideMs: 4500 });
      }
    });
  }

  function clearMediaSessionTrackHandlers() {
    setMediaSessionActionHandler("previoustrack", null);
    setMediaSessionActionHandler("nexttrack", null);
  }

  async function runSearch(query) {
    if (!state.service) {
      setError("Not connected", { autoHideMs: 3500 });
      setState({ searchStatus: "Search unavailable" });
      return;
    }
    const q = String(query || "").trim();
    if (!q) {
      setState({ searchQuery: "", searchResults: [], searchStatus: "Enter keyword" });
      return;
    }

    setState({
      searchQuery: q,
      searchBusy: true,
      searchStatus: `Searching (${searchModeLabel(state.searchMode)})...`,
      error: "",
    });

    try {
      let results = [];
      if (state.searchMode === SEARCH_MODE_DLNA) {
        try {
          const criteria = buildDlnaSearchCriteria(q);
          results = await state.service.search("0", criteria, 0, 300, "");
          results = results.filter((x) => x.kind === "item" || x.kind === "container");
        } catch (err) {
          if (err?.code === "SEARCH_UNAVAILABLE") {
            setToast("DLNA Search unavailable, fallback to Local: Full");
            setState({ searchMode: SEARCH_MODE_LOCAL_FULL });
            const localItems = await buildLocalFullIndex();
            results = localItems.filter((x) => textMatchesKeyword(x, q));
          } else {
            throw err;
          }
        }
      } else if (state.searchMode === SEARCH_MODE_LOCAL_TREE) {
        const treeItems = Object.values(state.treeNodes).filter((x) => x.id !== "0");
        results = treeItems.filter((x) => textMatchesKeyword(x, q));
      } else {
        const localItems = await buildLocalFullIndex();
        results = localItems.filter((x) => textMatchesKeyword(x, q));
      }

      const merged = mergeSearchResults(results);
      setState({
        searchResults: merged,
        searchBusy: false,
        searchStatus: `Found ${merged.length} result(s) · ${searchModeLabel(state.searchMode)}`,
      });
    } catch (err) {
      setState({
        searchBusy: false,
        searchResults: [],
        searchStatus: `Search failed · ${searchModeLabel(state.searchMode)}`,
      });
      setError(`Search failed: ${err.message}`, { autoHideMs: 5000 });
    }
  }

  function makePlaylistItemFromTrack(trackNode) {
    return {
      id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceNodeId: trackNode.id,
      title: trackNode.title,
      artist: trackNode.artist || "",
      album: trackNode.album || "",
      durationSeconds: trackNode.durationSeconds || null,
      url: trackNode.bestResource.url,
      protocolInfo: trackNode.bestResource.protocolInfo || "",
    };
  }

  async function addFolderToPlaylist(nodeId) {
    const node = getTreeNode(nodeId);
    if (!node || node.kind !== "container") return;
    try {
      setState({ busy: true, error: "" });
      const entries = await state.service.browse(nodeId, 0, 500);
      const found = entries
        .filter((entry) => entry.kind === "item" && entry.playable && entry.bestResource?.url)
        .slice(0, MAX_BULK_ADD);
      if (!found.length) {
        setState({ busy: false });
        setToast("No playable items found");
        return;
      }
      const items = found.map(makePlaylistItemFromTrack);
      state.playlist.push(...items);
      setState({ playlist: state.playlist, busy: false, error: "" });
      setToast(`Added ${items.length}${items.length >= MAX_BULK_ADD ? "+" : ""} items`);
    } catch (err) {
      setState({ busy: false });
      setError(`Bulk add failed: ${err.message}`, { autoHideMs: 5000 });
    }
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

  function clearPlaylist() {
    if (!state.playlist.length) return;
    const patch = { playlist: [] };
    if (state.nowPlayingPlaylistId) patch.nowPlayingPlaylistId = "";
    setState(patch);
    setToast("Playlist cleared");
  }

  function shufflePlaylist() {
    if (state.playlist.length < 2) return;
    const currentId = state.nowPlayingPlaylistId;
    for (let i = state.playlist.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = state.playlist[i];
      state.playlist[i] = state.playlist[j];
      state.playlist[j] = tmp;
    }
    if (currentId && state.playlist.some((x) => x.id === currentId)) {
      setState({ playlist: state.playlist, nowPlayingPlaylistId: currentId });
    } else {
      setState({ playlist: state.playlist });
    }
    setToast("Playlist shuffled");
  }

  function toggleStar(nodeId) {
    if (!nodeId) return;
    if (state.stars[nodeId]) delete state.stars[nodeId];
    else state.stars[nodeId] = true;
    savePrefsToStorage();
    setState({ stars: state.stars });
  }

  function reorderPlaylist(dragId, dropId) {
    if (!dragId || !dropId || dragId === dropId) return;
    const from = state.playlist.findIndex((x) => x.id === dragId);
    const to = state.playlist.findIndex((x) => x.id === dropId);
    if (from < 0 || to < 0) return;
    const [moved] = state.playlist.splice(from, 1);
    state.playlist.splice(to, 0, moved);
    setState({ playlist: state.playlist });
  }

  function cycleMode() {
    const idx = PLAY_MODES.indexOf(state.playMode);
    const next = PLAY_MODES[(idx + 1) % PLAY_MODES.length];
    state.playMode = next;
    savePrefsToStorage();
    setState({ playMode: next });
    setToast(`Mode: ${next}`);
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
      setState({ busy: false });
      setError(`Browse failed: ${err.message}`, { autoHideMs: 5000 });
      bumpTree();
    }
  }

  async function refreshTree() {
    const rootNode = getTreeNode("0");
    if (!rootNode) return;
    setState({ busy: true });
    rootNode.childrenLoaded = false;
    invalidateFullSearchIndex();
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
      invalidateFullSearchIndex();
      state.searchResults = [];
      state.searchResultNodes = {};
      state.searchStatus = "";
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
        showAdvanced: true,
      });
      if (!silentError) setError(err.message, { autoHideMs: 6000 });
      if (silentError) {
        setToast("Auto connect failed. Set rootDesc URL.");
      }
    }
  }

  root.addEventListener("click", async (evt) => {
    const target = evt.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;

    if (action === "advanced") {
      setState({ showAdvanced: !state.showAdvanced });
      return;
    }
    if (action === "error-dismiss") {
      setError("");
      return;
    }
    if (action === "connect") {
      const value = refs.descInput?.value?.trim();
      if (!value) {
        setError("Please enter rootDesc.xml URL", { autoHideMs: 3500 });
        return;
      }
      await connectAndLoad(value);
      return;
    }
    if (action === "refresh") {
      await refreshTree();
      return;
    }
    if (action === "tab-library-tree") {
      setState({ libraryTab: "tree" });
      return;
    }
    if (action === "tab-library-search") {
      setState({ libraryTab: "search" });
      return;
    }
    if (action === "search-mode-dlna") {
      setState({ searchMode: SEARCH_MODE_DLNA });
      return;
    }
    if (action === "search-mode-local-tree") {
      setState({ searchMode: SEARCH_MODE_LOCAL_TREE });
      return;
    }
    if (action === "search-mode-local-full") {
      setState({ searchMode: SEARCH_MODE_LOCAL_FULL });
      return;
    }
    if (action === "search-run") {
      await runSearch(refs.searchInput?.value || "");
      return;
    }
    if (action === "tab-playlist") {
      setState({ listTab: "playlist" });
      return;
    }
    if (action === "tab-favorites") {
      setState({ listTab: "favorites" });
      return;
    }
    if (action === "playlist-clear") {
      clearPlaylist();
      return;
    }
    if (action === "root") {
      const rootNode = getTreeNode("0");
      if (!rootNode) return;
      rootNode.expanded = true;
      bumpTree();
      if (!rootNode.childrenLoaded) await loadChildren("0");
      return;
    }
    if (action === "play-toggle") {
      const status = mediaAdapter.getStatus();
      try {
        if (status.paused) await mediaAdapter.resume();
        else mediaAdapter.pause();
      } catch (err) {
        setError(`Playback toggle failed: ${err.message}`, { autoHideMs: 4500 });
      }
      return;
    }
    if (action === "prev") {
      await playPrevInPlaylist();
      return;
    }
    if (action === "next") {
      await playNextInPlaylist();
      return;
    }
    if (action === "shuffle-playlist") {
      shufflePlaylist();
      return;
    }
    if (action === "cycle-mode") {
      cycleMode();
      return;
    }
    if (action === "toggle") {
      await toggleNode(target.dataset.nodeId || "");
      return;
    }
    if (action === "toggle-star") {
      toggleStar(target.dataset.nodeId || "");
      return;
    }
    if (action === "toggle-star-playlist") {
      toggleStar(target.dataset.nodeId || "");
      return;
    }
    if (action === "play-item") {
      await playNode(getTreeNode(target.dataset.nodeId || ""));
      return;
    }
    if (action === "search-play-item") {
      await playNode(findSearchNode(target.dataset.searchNodeId || ""));
      return;
    }
    if (action === "add-playlist") {
      addNodeToPlaylist(getTreeNode(target.dataset.nodeId || ""));
      return;
    }
    if (action === "search-add-playlist") {
      addNodeToPlaylist(findSearchNode(target.dataset.searchNodeId || ""));
      return;
    }
    if (action === "search-toggle-star") {
      toggleStar(target.dataset.searchNodeId || "");
      return;
    }
    if (action === "add-folder-playlist") {
      await addFolderToPlaylist(target.dataset.nodeId || "");
      return;
    }
    if (action === "copy-url") {
      const url = getTreeNode(target.dataset.nodeId || "")?.bestResource?.url;
      if (!url) return;
      try {
        await copyText(url);
        setToast("Media URL copied");
      } catch (err) {
        setError(`Copy failed: ${err.message}`, { autoHideMs: 4000 });
      }
      return;
    }
    if (action === "search-copy-url") {
      const url = findSearchNode(target.dataset.searchNodeId || "")?.bestResource?.url;
      if (!url) return;
      try {
        await copyText(url);
        setToast("Media URL copied");
      } catch (err) {
        setError(`Copy failed: ${err.message}`, { autoHideMs: 4000 });
      }
      return;
    }
    if (action === "playlist-remove") {
      removePlaylistItem(target.dataset.playlistId || "");
      return;
    }
    if (action === "playlist-play") {
      await playPlaylistById(target.dataset.playlistId || "");
      return;
    }
    if (action === "playlist-copy") {
      const item = findPlaylistItem(target.dataset.playlistId || "");
      if (!item?.url) return;
      try {
        await copyText(item.url);
        setToast("Playlist URL copied");
      } catch (err) {
        setError(`Copy failed: ${err.message}`, { autoHideMs: 4000 });
      }
    }
    if (action === "favorite-copy") {
      const item = findPlaylistItem(target.dataset.playlistId || "");
      if (!item?.url) return;
      try {
        await copyText(item.url);
        setToast("Favorite URL copied");
      } catch (err) {
        setError(`Copy failed: ${err.message}`, { autoHideMs: 4000 });
      }
      return;
    }
    if (action === "favorite-play") {
      await playPlaylistById(target.dataset.playlistId || "");
    }
  });

  refs.playlist.addEventListener("dragstart", (evt) => {
    const row = evt.target.closest("[data-drag-id]");
    if (!row) return;
    playlistDragId = row.dataset.dragId || "";
    row.classList.add("dragging");
    evt.dataTransfer.effectAllowed = "move";
    evt.dataTransfer.setData("text/plain", playlistDragId);
  });

  refs.searchInput?.addEventListener("keydown", async (evt) => {
    if (evt.key !== "Enter") return;
    evt.preventDefault();
    await runSearch(refs.searchInput?.value || "");
  });

  refs.playlist.addEventListener("dragover", (evt) => {
    const row = evt.target.closest("[data-drag-id]");
    if (!row) return;
    evt.preventDefault();
    evt.dataTransfer.dropEffect = "move";
    refs.playlist.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
    row.classList.add("drop-target");
  });

  refs.playlist.addEventListener("dragleave", (evt) => {
    const row = evt.target.closest("[data-drag-id]");
    if (!row) return;
    row.classList.remove("drop-target");
  });

  refs.playlist.addEventListener("drop", (evt) => {
    const row = evt.target.closest("[data-drag-id]");
    if (!row) return;
    evt.preventDefault();
    row.classList.remove("drop-target");
    const dropId = row.dataset.dragId || "";
    const dragId = playlistDragId || evt.dataTransfer.getData("text/plain");
    reorderPlaylist(dragId, dropId);
    playlistDragId = "";
  });

  refs.playlist.addEventListener("dragend", () => {
    refs.playlist.querySelectorAll(".dragging,.drop-target").forEach((el) => {
      el.classList.remove("dragging");
      el.classList.remove("drop-target");
    });
    playlistDragId = "";
  });

  listeners.add(render);
  mediaAdapter.onState = () => renderPlayerOnly();
  const nativeAudioEl = mediaAdapter.getElement?.();
  const onAudioEnded = () => {
    playNextInPlaylist().catch((err) => {
      setError(`Next track failed: ${err.message}`, { autoHideMs: 4500 });
    });
  };
  nativeAudioEl?.addEventListener("ended", onAudioEnded);
  installMediaSessionTrackHandlers();

  return {
    render,
    connectAndLoad,
    dispose() {
      clearErrorTimer();
      clearMediaSessionTrackHandlers();
      listeners.delete(render);
      mediaAdapter.onState = null;
      nativeAudioEl?.removeEventListener("ended", onAudioEnded);
    },
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
  const resolvedVersion = version || "dev";
  const resolvedBaseUrl = baseUrl || "";
  const initialDesc = detectMockHint() || inferDefaultDescUrl();
  const existing = window[PLAYLET_RUNTIME_KEY];

  if (
    existing &&
    existing.baseUrl === resolvedBaseUrl &&
    existing.version === resolvedVersion &&
    typeof existing.reconnect === "function"
  ) {
    await existing.reconnect(initialDesc);
    return existing;
  }

  if (existing?.dispose) existing.dispose();

  clearToastTimer();
  resetTree();

  state.initialized = true;
  state.version = resolvedVersion;
  state.baseUrl = resolvedBaseUrl;
  state.busy = false;
  state.showAdvanced = false;
  state.service = null;
  state.serviceName = "";
  state.libraryTab = "tree";
  state.searchMode = SEARCH_MODE_DLNA;
  state.searchQuery = "";
  state.searchBusy = false;
  state.searchStatus = "";
  state.searchResults = [];
  state.searchResultNodes = {};
  const restored = loadPrefsFromStorage();
  state.playlist = [];
  state.stars = restored?.stars || {};
  state.playMode = restored?.playMode || MODE_LOOP_ALL;
  state.listTab = "playlist";
  state.nowPlaying = null;
  state.nowPlayingPlaylistId = "";
  state.toast = "";
  state.error = "";

  createStyles();
  const root = mountRoot();
  const mediaAdapter = new HtmlMediaAdapter();
  const ui = createUi(root, mediaAdapter);

  setState({ descUrl: initialDesc });
  ui.render();

  // Auto connect first, reveal advanced input only when failed.
  await ui.connectAndLoad(initialDesc, true);

  const runtime = {
    version: resolvedVersion,
    baseUrl: resolvedBaseUrl,
    async reconnect(descUrl) {
      const nextDesc = descUrl || detectMockHint() || inferDefaultDescUrl();
      setState({ descUrl: nextDesc });
      await ui.connectAndLoad(nextDesc, false);
    },
    dispose() {
      clearToastTimer();
      ui.dispose?.();
      mediaAdapter.destroy();
      root.remove();
    },
  };

  window[PLAYLET_RUNTIME_KEY] = runtime;
  installDebug(runtime);
  return runtime;
}

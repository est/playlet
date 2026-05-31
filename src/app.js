import {
  MODE_LOOP_ALL,
  MODE_LOOP_ONE,
  PLAYLET_ROOT_ID,
  PLAYLET_RUNTIME_KEY,
  SEARCH_MODE_DLNA,
} from "./core/constants.js";
import { createStore } from "./core/store.js";
import { loadPrefsFromStorage, savePrefsToStorage } from "./infra/storage.js";
import {
  DlnaClient,
  buildDlnaSearchCriteria as buildDlnaSearchCriteriaDomain,
  textMatchesKeyword as textMatchesKeywordDomain,
} from "./domain/dlna.js";
import {
  addNodeToPlaylist as addNodeToPlaylistDomain,
  clearPlaylist as clearPlaylistDomain,
  cycleMode as cycleModeDomain,
  findPlaylistItem as findPlaylistItemDomain,
  getFavoriteItems as getFavoriteItemsDomain,
  getNextPlaylistId,
  getPrevPlaylistId,
  makePlaylistItemFromTrack as makePlaylistItemFromTrackDomain,
  playlistRowSub as playlistRowSubDomain,
  removePlaylistItem as removePlaylistItemDomain,
  reorderPlaylist as reorderPlaylistDomain,
  shufflePlaylist as shufflePlaylistDomain,
  toggleStar as toggleStarDomain,
} from "./domain/playlist.js";
import { HtmlMediaAdapter } from "./infra/media.js";
import { createStyles } from "./ui/styles.js";
import { createPanelUi } from "./ui/panel.js";

const initialState = {
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

const store = createStore(initialState);
const state = store.getState();
const listeners = new Set();
let toastTimer = null;

store.subscribe((nextState) => {
  for (const cb of listeners) cb(nextState);
});

function setState(next) {
  store.setState(next);
}

function mutateState(mutator) {
  store.mutate(mutator);
}

function modeLabel(mode) {
  if (mode === MODE_LOOP_ONE) return "1";
  return "∞";
}

function bumpTree() {
  mutateState((draft) => {
    draft.treeTick += 1;
  });
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

export async function bootPlaylet({ baseUrl, version, testHooks = null } = {}) {
  const resolvedVersion = version || "dev";
  const resolvedBaseUrl = baseUrl || "";
  const initialDesc = detectMockHint() || inferDefaultDescUrl();
  const hooks = testHooks || {};
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

  if (typeof hooks.createStyles === "function") hooks.createStyles();
  else createStyles();

  const root = typeof hooks.mountRoot === "function" ? hooks.mountRoot() : mountRoot();
  const mediaAdapter = typeof hooks.createMediaAdapter === "function" ? hooks.createMediaAdapter() : new HtmlMediaAdapter();
  const ui =
    typeof hooks.createUi === "function"
      ? hooks.createUi({ root, mediaAdapter, state })
      : createPanelUi({
          root,
          mediaAdapter,
          state,
          listeners,
          setState,
          setToast,
          modeLabel,
          getTreeNode,
          ensureTreeNode,
          resetTree,
          bumpTree,
          DlnaClient,
          savePrefsToStorage,
          addNodeToPlaylistDomain,
          clearPlaylistDomain,
          cycleModeDomain,
          findPlaylistItemDomain,
          getFavoriteItemsDomain,
          getNextPlaylistId,
          getPrevPlaylistId,
          makePlaylistItemFromTrackDomain,
          playlistRowSubDomain,
          removePlaylistItemDomain,
          reorderPlaylistDomain,
          shufflePlaylistDomain,
          toggleStarDomain,
          buildDlnaSearchCriteriaDomain,
          textMatchesKeywordDomain,
        });

  setState({ descUrl: initialDesc });
  ui.render();

  // Auto connect first, reveal advanced input only when failed.
  if (!hooks.skipAutoConnect) {
    await ui.connectAndLoad(initialDesc, true);
  }

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

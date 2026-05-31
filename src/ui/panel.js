import { SEARCH_MODE_DLNA, SEARCH_MODE_LOCAL_TREE, SEARCH_MODE_LOCAL_FULL } from "../core/constants.js";

export function createPanelUi(deps) {
  const {
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
  } = deps;

function searchModeLabel(mode) {
  if (mode === SEARCH_MODE_LOCAL_TREE) return "Local: Tree";
  if (mode === SEARCH_MODE_LOCAL_FULL) return "Local: Full";
  return "DLNA";
}

function buildDlnaSearchCriteria(keyword) {
  return buildDlnaSearchCriteriaDomain(keyword);
}

function textMatchesKeyword(node, keyword) {
  return textMatchesKeywordDomain(node, keyword);
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
  return playlistRowSubDomain(item);
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
    return getFavoriteItemsDomain(state);
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
    return findPlaylistItemDomain(state, id);
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
    const nextId = getNextPlaylistId(state);
    if (!nextId) return;
    await playPlaylistById(nextId);
  }

  async function playPrevInPlaylist() {
    const prevId = getPrevPlaylistId(state);
    if (!prevId) return;
    await playPlaylistById(prevId);
  }

  function addNodeToPlaylist(node) {
    if (!addNodeToPlaylistDomain(state, node)) return;
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
    return makePlaylistItemFromTrackDomain(trackNode);
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
    if (!removePlaylistItemDomain(state, id)) return;
    setState({ playlist: state.playlist, nowPlayingPlaylistId: state.nowPlayingPlaylistId });
  }

  function clearPlaylist() {
    if (!clearPlaylistDomain(state)) return;
    setState({ playlist: state.playlist, nowPlayingPlaylistId: state.nowPlayingPlaylistId });
    setToast("Playlist cleared");
  }

  function shufflePlaylist() {
    if (!shufflePlaylistDomain(state)) return;
    setState({ playlist: state.playlist, nowPlayingPlaylistId: state.nowPlayingPlaylistId });
    setToast("Playlist shuffled");
  }

  function toggleStar(nodeId) {
    if (!toggleStarDomain(state, nodeId)) return;
    savePrefsToStorage({
      playMode: state.playMode,
      stars: state.stars,
    });
    setState({ stars: state.stars });
  }

  function reorderPlaylist(dragId, dropId) {
    if (!reorderPlaylistDomain(state, dragId, dropId)) return;
    setState({ playlist: state.playlist });
  }

  function cycleMode() {
    const next = cycleModeDomain(state.playMode);
    state.playMode = next;
    savePrefsToStorage({
      playMode: state.playMode,
      stars: state.stars,
    });
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

  return createUi(root, mediaAdapter);
}

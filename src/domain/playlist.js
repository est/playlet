import { MODE_LOOP_ONE, PLAY_MODES } from "../core/constants.js";

export function playlistRowSub(item) {
  const parts = [item.artist, item.album].filter(Boolean);
  return parts.length ? parts.join(" · ") : item.url;
}

export function makePlaylistItemFromTrack(trackNode, idFactory = defaultIdFactory) {
  return {
    id: idFactory(),
    sourceNodeId: trackNode.id,
    title: trackNode.title,
    artist: trackNode.artist || "",
    album: trackNode.album || "",
    durationSeconds: trackNode.durationSeconds || null,
    url: trackNode.bestResource.url,
    protocolInfo: trackNode.bestResource.protocolInfo || "",
  };
}

export function addNodeToPlaylist(state, node, idFactory = defaultIdFactory) {
  if (!node?.bestResource?.url) return false;
  state.playlist.push(makePlaylistItemFromTrack(node, idFactory));
  return true;
}

export function removePlaylistItem(state, id) {
  const idx = state.playlist.findIndex((x) => x.id === id);
  if (idx < 0) return false;

  const [removed] = state.playlist.splice(idx, 1);
  if (removed.id === state.nowPlayingPlaylistId) {
    state.nowPlayingPlaylistId = "";
  }
  return true;
}

export function clearPlaylist(state) {
  if (!state.playlist.length) return false;
  state.playlist = [];
  if (state.nowPlayingPlaylistId) state.nowPlayingPlaylistId = "";
  return true;
}

export function shufflePlaylist(state, random = Math.random) {
  if (state.playlist.length < 2) return false;
  const currentId = state.nowPlayingPlaylistId;
  for (let i = state.playlist.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = state.playlist[i];
    state.playlist[i] = state.playlist[j];
    state.playlist[j] = tmp;
  }
  if (currentId && !state.playlist.some((x) => x.id === currentId)) {
    state.nowPlayingPlaylistId = "";
  }
  return true;
}

export function reorderPlaylist(state, dragId, dropId) {
  if (!dragId || !dropId || dragId === dropId) return false;
  const from = state.playlist.findIndex((x) => x.id === dragId);
  const to = state.playlist.findIndex((x) => x.id === dropId);
  if (from < 0 || to < 0) return false;
  const [moved] = state.playlist.splice(from, 1);
  state.playlist.splice(to, 0, moved);
  return true;
}

export function findPlaylistItem(state, id) {
  return state.playlist.find((x) => x.id === id) || null;
}

export function getFavoriteItems(state) {
  return state.playlist.filter((item) => state.stars[item.sourceNodeId || item.id]);
}

export function toggleStar(state, nodeId) {
  if (!nodeId) return false;
  if (state.stars[nodeId]) delete state.stars[nodeId];
  else state.stars[nodeId] = true;
  return true;
}

export function cycleMode(currentMode) {
  const idx = PLAY_MODES.indexOf(currentMode);
  return PLAY_MODES[(idx + 1) % PLAY_MODES.length];
}

export function getNextPlaylistId(state) {
  if (!state.playlist.length) return "";

  if (state.playMode === MODE_LOOP_ONE && state.nowPlayingPlaylistId) {
    return state.nowPlayingPlaylistId;
  }

  let nextIdx = 0;
  if (state.nowPlayingPlaylistId) {
    const currentIdx = state.playlist.findIndex((x) => x.id === state.nowPlayingPlaylistId);
    if (currentIdx >= 0) nextIdx = (currentIdx + 1) % state.playlist.length;
  }

  return state.playlist[nextIdx]?.id || "";
}

export function getPrevPlaylistId(state) {
  if (!state.playlist.length) return "";
  if (!state.nowPlayingPlaylistId) return state.playlist[0].id;

  const currentIdx = state.playlist.findIndex((x) => x.id === state.nowPlayingPlaylistId);
  if (currentIdx < 0) return state.playlist[0].id;

  const prevIdx = (currentIdx - 1 + state.playlist.length) % state.playlist.length;
  return state.playlist[prevIdx]?.id || "";
}

function defaultIdFactory() {
  return `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

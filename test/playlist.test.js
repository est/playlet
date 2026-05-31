import test from "node:test";
import assert from "node:assert/strict";

import {
  addNodeToPlaylist,
  clearPlaylist,
  cycleMode,
  getNextPlaylistId,
  getPrevPlaylistId,
  makePlaylistItemFromTrack,
  removePlaylistItem,
  reorderPlaylist,
  shufflePlaylist,
  toggleStar,
} from "../src/domain/playlist.js";
import { MODE_LOOP_ALL, MODE_LOOP_ONE } from "../src/core/constants.js";

function createState() {
  return {
    playlist: [],
    stars: {},
    playMode: MODE_LOOP_ALL,
    nowPlayingPlaylistId: "",
  };
}

function node(id, title) {
  return {
    id,
    title,
    artist: "artist",
    album: "album",
    durationSeconds: 10,
    bestResource: {
      url: `http://example.com/${id}.mp3`,
      protocolInfo: "http-get:*:audio/mpeg:*",
    },
  };
}

test("addNodeToPlaylist and makePlaylistItemFromTrack keep playable fields", () => {
  const state = createState();
  const item = makePlaylistItemFromTrack(node("n1", "Track 1"), () => "pl-1");
  assert.equal(item.id, "pl-1");
  assert.equal(item.sourceNodeId, "n1");
  assert.equal(item.url, "http://example.com/n1.mp3");

  const ok = addNodeToPlaylist(state, node("n1", "Track 1"), () => "pl-1");
  assert.equal(ok, true);
  assert.equal(state.playlist.length, 1);
});

test("removePlaylistItem clears nowPlayingPlaylistId when deleting current", () => {
  const state = createState();
  addNodeToPlaylist(state, node("n1", "Track 1"), () => "pl-1");
  state.nowPlayingPlaylistId = "pl-1";

  const ok = removePlaylistItem(state, "pl-1");
  assert.equal(ok, true);
  assert.equal(state.playlist.length, 0);
  assert.equal(state.nowPlayingPlaylistId, "");
});

test("reorderPlaylist moves item to drop position", () => {
  const state = createState();
  addNodeToPlaylist(state, node("n1", "Track 1"), () => "pl-1");
  addNodeToPlaylist(state, node("n2", "Track 2"), () => "pl-2");
  addNodeToPlaylist(state, node("n3", "Track 3"), () => "pl-3");

  const ok = reorderPlaylist(state, "pl-3", "pl-1");
  assert.equal(ok, true);
  assert.deepEqual(
    state.playlist.map((x) => x.id),
    ["pl-3", "pl-1", "pl-2"]
  );
});

test("shufflePlaylist preserves nowPlaying id and uses injected random", () => {
  const state = createState();
  addNodeToPlaylist(state, node("n1", "Track 1"), () => "pl-1");
  addNodeToPlaylist(state, node("n2", "Track 2"), () => "pl-2");
  addNodeToPlaylist(state, node("n3", "Track 3"), () => "pl-3");
  state.nowPlayingPlaylistId = "pl-2";

  const ok = shufflePlaylist(state, () => 0);
  assert.equal(ok, true);
  assert.equal(state.nowPlayingPlaylistId, "pl-2");
  assert.deepEqual(
    state.playlist.map((x) => x.id),
    ["pl-2", "pl-3", "pl-1"]
  );
});

test("getNextPlaylistId and getPrevPlaylistId follow loop modes", () => {
  const state = createState();
  addNodeToPlaylist(state, node("n1", "Track 1"), () => "pl-1");
  addNodeToPlaylist(state, node("n2", "Track 2"), () => "pl-2");
  addNodeToPlaylist(state, node("n3", "Track 3"), () => "pl-3");
  state.nowPlayingPlaylistId = "pl-2";

  assert.equal(getNextPlaylistId(state), "pl-3");
  assert.equal(getPrevPlaylistId(state), "pl-1");

  state.playMode = MODE_LOOP_ONE;
  assert.equal(getNextPlaylistId(state), "pl-2");
});

test("toggleStar and clearPlaylist mutate expected fields", () => {
  const state = createState();
  addNodeToPlaylist(state, node("n1", "Track 1"), () => "pl-1");

  assert.equal(toggleStar(state, "n1"), true);
  assert.equal(Boolean(state.stars.n1), true);
  assert.equal(toggleStar(state, "n1"), true);
  assert.equal(Boolean(state.stars.n1), false);

  state.nowPlayingPlaylistId = "pl-1";
  assert.equal(clearPlaylist(state), true);
  assert.equal(state.playlist.length, 0);
  assert.equal(state.nowPlayingPlaylistId, "");
});

test("cycleMode toggles between loop modes", () => {
  assert.equal(cycleMode(MODE_LOOP_ALL), MODE_LOOP_ONE);
  assert.equal(cycleMode(MODE_LOOP_ONE), MODE_LOOP_ALL);
});

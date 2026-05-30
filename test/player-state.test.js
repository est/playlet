import test from "node:test";
import assert from "node:assert/strict";

import { createPlayerState } from "../src/player-state.js";

function sampleTrack(id, title) {
  return { id, title, url: `http://nas.local/music/${id}.mp3` };
}

test("createPlayerState can enqueue tracks and start playback", () => {
  const state = createPlayerState();
  const trackA = sampleTrack("a", "A");
  const trackB = sampleTrack("b", "B");

  state.setQueue([trackA, trackB]);
  state.playAt(1);

  assert.equal(state.snapshot().playing, true);
  assert.equal(state.snapshot().currentIndex, 1);
  assert.equal(state.currentTrack().id, "b");
});

test("createPlayerState supports next/prev bounds safely", () => {
  const state = createPlayerState();
  state.setQueue([sampleTrack("a", "A"), sampleTrack("b", "B")]);

  state.playAt(0);
  state.prev();
  assert.equal(state.snapshot().currentIndex, 0);

  state.next();
  state.next();
  assert.equal(state.snapshot().currentIndex, 1);
});

test("createPlayerState can remove a track and keep index stable", () => {
  const state = createPlayerState();
  state.setQueue([sampleTrack("a", "A"), sampleTrack("b", "B"), sampleTrack("c", "C")]);
  state.playAt(2);

  state.removeTrackById("b");

  assert.equal(state.snapshot().queue.length, 2);
  assert.equal(state.snapshot().currentIndex, 1);
  assert.equal(state.currentTrack().id, "c");
});

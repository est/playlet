import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseDlnaIndex } from "../src/parser.js";

const fixturesDir = resolve(process.cwd(), "fixtures");

async function readFixture(name) {
  return readFile(resolve(fixturesDir, name), "utf8");
}

test("parseDlnaIndex parses folders/tracks and normalizes URLs", async () => {
  const html = await readFixture("supported.html");
  const result = parseDlnaIndex(html, "http://nas.local/music/");

  assert.equal(result.supported, true);
  assert.equal(result.folders.length, 2);
  assert.equal(result.tracks.length, 2);
  assert.equal(result.tracks[0].url, "http://nas.local/music/Album%201/Track%2001.mp3");
  assert.equal(result.tracks[0].title, "Track 01");
});

test("parseDlnaIndex deduplicates duplicate track links", async () => {
  const html = await readFixture("supported.html");
  const result = parseDlnaIndex(html, "http://nas.local/music/");

  const ids = result.tracks.map((track) => track.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("parseDlnaIndex returns unsupported result with diagnostics", async () => {
  const html = await readFixture("unsupported.html");
  const result = parseDlnaIndex(html, "http://nas.local/music/");

  assert.equal(result.supported, false);
  assert.equal(result.tracks.length, 0);
  assert.equal(result.diagnostics.hasAnchorTags, false);
  assert.ok(result.warnings.length > 0);
});

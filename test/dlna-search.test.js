import test from "node:test";
import assert from "node:assert/strict";

import { buildDlnaSearchCriteria, textMatchesKeyword } from "../src/domain/dlna.js";

test("buildDlnaSearchCriteria escapes quotes and backslashes", () => {
  const criteria = buildDlnaSearchCriteria('a"b\\c');
  assert.match(criteria, /a\\"b\\\\c/);
  assert.match(criteria, /upnp:class derivedfrom "object\.item\.audioItem"/);
});

test("textMatchesKeyword checks title artist album and className", () => {
  const node = {
    title: "Song Alpha",
    artist: "Artist Beta",
    album: "Album Gamma",
    className: "object.item.audioItem.musicTrack",
  };

  assert.equal(textMatchesKeyword(node, "alpha"), true);
  assert.equal(textMatchesKeyword(node, "beta"), true);
  assert.equal(textMatchesKeyword(node, "gamma"), true);
  assert.equal(textMatchesKeyword(node, "musictrack"), true);
  assert.equal(textMatchesKeyword(node, "missing"), false);
});

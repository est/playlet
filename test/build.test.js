import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

test("build script emits bookmarklet output", async () => {
  await execFileAsync("node", ["scripts/build-bookmarklet.mjs"], {
    cwd: process.cwd(),
  });

  const outPath = resolve(process.cwd(), "dist", "bookmarklet.txt");
  const bookmarklet = await readFile(outPath, "utf8");
  assert.match(bookmarklet, /^javascript:/);
  assert.ok(bookmarklet.length > 64);
  const decoded = decodeURIComponent(bookmarklet.replace(/^javascript:/, ""));
  assert.match(decoded, /function parseDlnaIndex/);
  assert.match(decoded, /function createPlayerState/);
});

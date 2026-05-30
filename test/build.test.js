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

  const bookmarkletPath = resolve(process.cwd(), "dist", "bookmarklet.txt");
  const modulePath = resolve(process.cwd(), "dist", "playlet.module.js");
  const bookmarklet = await readFile(bookmarkletPath, "utf8");
  const moduleSource = await readFile(modulePath, "utf8");

  assert.match(bookmarklet, /^javascript:/);
  assert.ok(bookmarklet.length > 32);

  const decoded = decodeURIComponent(bookmarklet.replace(/^javascript:/, ""));
  assert.match(decoded, /type\s*=\s*["']module["']/);
  assert.match(decoded, /window\.__PLAYLET_MODULE_URL__/);
  assert.match(decoded, /\/playlet\.module\.js/);
  assert.match(decoded, /window\.__PLAYLET_BOOKMARKLET_INJECTED__/);

  assert.match(moduleSource, /function parseDlnaIndex/);
  assert.match(moduleSource, /function createPlayerState/);
  assert.match(moduleSource, /window\.__PLAYLET_MODULE_RAN__/);
});

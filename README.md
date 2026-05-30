# Playlet

Playlet is a bookmarklet-first DLNA page enhancer.
Open your NAS media index page, run the bookmarklet, and get an inline player UI without installing a native client.

## Quick Start

1. Build the bookmarklet payload:

```bash
npm run build
```

2. Open `dist/bookmarklet.txt` and copy the full `javascript:...` URL.
3. Create a browser bookmark named `Playlet`.
4. Paste the copied URL as the bookmark target.
5. Navigate to your NAS DLNA index page and click the bookmark.

## How It Works

- `scripts/build-bookmarklet.mjs` reads source modules and emits one encoded `javascript:` payload.
- The payload runs in the context of the current NAS page, so it can read the page HTML and reuse same-origin requests.
- `src/parser.js` extracts folder and media links from index-like HTML and returns:
  - supported parse results (folders + tracks), or
  - fallback diagnostics when parsing confidence is too low.
- `src/playlet.js` injects a docked UI panel into the page and wires transport controls.
- `src/player-state.js` manages queue/current index/play state in a small, testable state container.

## Project Layout

- `src/parser.js`: strict link parser and normalization.
- `src/player-state.js`: queue/playback state operations.
- `src/playlet.js`: UI mount, rendering, controls, and global `window.Playlet.init()`.
- `scripts/build-bookmarklet.mjs`: bookmarklet bundle/encode step.
- `test/*.test.js`: parser, state, and build verification.
- `fixtures/*.html`: parser fixtures for supported/unsupported layouts.
- `dist/bookmarklet.txt`: generated bookmarklet string.

## Development

Prerequisites:
- Node.js 22+ (uses built-in `node:test`)

Install:
- No dependencies required.

Common workflow:

```bash
npm test
npm run build
```

During dev:
- update source under `src/`
- add/adjust tests in `test/`
- run `npm test` first
- run `npm run build` to refresh `dist/bookmarklet.txt`

## Build Output

- `npm run build` writes:
  - `dist/bookmarklet.txt` containing a single `javascript:...` URL.
- Copy that full line into a browser bookmark target.

## Current v1 Features

- Strict parsing of DLNA-like index pages with links.
- Track/folder extraction with URL normalization and track dedupe.
- Inline player panel with queue, play/pause, prev/next, and remove from queue.
- Unsupported-page fallback with diagnostics payload for future parser adapters.

## Known Limits (v1)

- Parser is intentionally strict and may reject unusual NAS index markup.
- No persistent settings or server profiles yet.
- No search, transcoding, or multi-device sync.

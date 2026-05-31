# Playlet 💿

Playlet 💿 plays songs/media on any DLNA server from the browser, without installing a native client.

No app install, no Electron, no local daemon.

## Story

I have a NAS, it runs a DLNA server and hosts my music collection

But I hate installing a DLNA compatible app on phone/macOS. It's hard to find a good one. I even tried to build [a Chrome App with `chrome.socket`](https://github.com/est/push2air) 13 years ago but went nowhere.

On a beautiful Saturday afternoon, I decided to build a client again. While evaluating tech stack and distribution options, I talked to ChatGPT whether browsers provide SSDP/uPNP natively, turns out no. You have to choose native UI, electron (boo!), or some nerd command line utility. They are very boring.

Suddently I had an idea: a DLNA client involves speaking HTTP anyway, and the DLNA server already has a web server. There's an ancient lesser-known trick called `bookmarklet`: Inject a small `.js` into the ugly DLNA index page, then do `fetch()` calls SOAP shit and render a nice player inline. No UDP, no CORS, no bullshit.

The rest is vibe coding history.

## How it works

1. Save this to browser bookmark: `javascript:import("https://est.github.io/playlet/loader.js")`
2. Open DLNA index page, usually http://NAS-IP:8200/
3. Click the saved bookmark

the .js interally do these

1. Discover/load device description XML (`rootDesc.xml` or provided URL)
2. Find `ContentDirectory` `controlURL`
3. Send `Browse` SOAP requests (`ObjectID`, `BrowseDirectChildren`)
4. Parse `DIDL-Lite` results into containers/items
5. Play item `res` URLs in an injected UI panel

No ads, telemetry. Works offline once loaded.

## Features

For v1.2

- Tree browser with `+/-` expand/collapse (lazy-loaded by node)
- Folder hover hint on same line (`XX items`)
- Folder quick add (`≡+`) adds playable tracks from current folder level only (no recursive deep scan)
- `Library` tabs: `Tree | Search`
- Search modes:
  - `DLNA`: use `ContentDirectory:Search` when server supports it
  - `Local: Tree`: search only loaded tree nodes
  - `Local: Full`: crawl full library locally, then search
- Session playlist: add, remove, play from queue
- Playlist clear button (`Clear`)
- Playlist supports drag-drop reorder
- Shuffle does real in-place playlist reorder (`Shuffle`)
- Prev/Next follow current playlist order after shuffle
- Copy media URL from library rows and playlist rows (`⧉`)
- Search result rows support same actions as tree rows (`▶`, `+`, `☆/★`, `⧉`)
- Favorites: single-track star (`☆/★`) with localStorage persistence
- Only favorites/mode are persisted; playlist is session-only
- Playback modes: all-loop (`∞`), single-loop (`1`)
- MediaSession track controls wired: `previoustrack` / `nexttrack`
- Auto-detect `rootDesc.xml`, with hidden advanced URL override
- Scroll isolation for panel internals (better trackpad behavior on macOS)
- Native `<audio controls>` player for reliable seek/progress behavior
- Error bar supports manual dismiss (`×`) and auto-hide for transient failures (play/copy/search/etc.)
- Runtime reuse on repeated inject with same base/version (avoid full teardown/rebuild)
- Debug hooks:
  - `window.__playletDebug.getState()`
  - `window.__playletDebug.getLastRequest()`
  - `window.__playletDebug.getLastResponse()`
  - `window.__playletDebug.getPlaylist()`
  - `window.__playletDebug.getTreeState()`

## Local debug

```bash
npm run dev
```

Open:

- `http://127.0.0.1:8788/playlet/index.html?playlet_desc=http://127.0.0.1:8788/playlet/mock/rootDesc.xml`

Then in DevTools console:

```js
import("http://127.0.0.1:8788/playlet/loader.js")
```

### Live NAS proxy debug (same-origin)

Proxy a real DLNA host into local same-origin with route split:

- `/playlet/*` -> local debug assets (index, loader, debug iframe helper)
- `/*` -> reverse proxy to your DLNA server

```bash
npm run dev -- --dlna-base http://192.168.1.5:8200/
```

Then open:

- `http://127.0.0.1:8788/playlet/debug`

This page uses an iframe + one-click inject button to simulate bookmarklet behavior:

- iframe loads `/` (your real DLNA page via proxy)
- it sets `?playlet_desc=http://127.0.0.1:8788/rootDesc.xml` on iframe URL
- then executes `import("/playlet/loader.js")` inside iframe window
- Debug toolbar includes:
  - `Inject`: inject loader into iframe page

## Build

```bash
npm run build
npm run serve:dist
```

Build outputs:

- `dist/loader.js`: esbuild bundle + minified (single download path)
- `dist/index.html`: copied from editable `src/index.html`

`src/index.html` is plain editable source. You can tweak page content/style directly there.

## Architecture

Current runtime layering:

- `src/app.js`: runtime orchestrator only (`bootPlaylet`, runtime reuse/dispose, initial state/bootstrap)
- `src/ui/panel.js`: Playlet panel UI, event wiring, tree/search/playlist rendering
- `src/ui/styles.js`: injected styles
- `src/domain/dlna.js`: DLNA SOAP + DIDL parsing/search helpers
- `src/domain/playlist.js`: playlist/favorites/play-mode domain logic
- `src/infra/media.js`: media adapter (`HtmlMediaAdapter`)
- `src/infra/storage.js`: localStorage prefs I/O
- `src/core/*`: constants and lightweight store

Data flow convention:

1. UI event -> domain/infra action
2. update `state` via orchestrator helpers
3. render from `state`

Runtime lifecycle:

- First inject builds runtime and auto-connects
- Re-inject with same `baseUrl + version` reuses runtime and calls `reconnect()`
- Different version/base disposes old runtime and rebuilds

Debug and smoke checks:

- Runtime/debug hooks: `window.__playletDebug.*`
- Unit/smoke tests: `npm run test`
- Structure/boundary checks: `npm run check`

## GitHub Pages deploy

Workflow: `.github/workflows/pages.yml`

- Trigger: push `main` or manual dispatch
- Install: `npm ci`
- Build: `npm run build`
- Publish artifact: `dist/`

Repository setting required:

- Settings -> Pages -> Source: `GitHub Actions`


## Cost

|   Date   |    model      |  input      |     cache     |  output    | total |
|----------|---------------|-------------|---------------|------------|-------|
| 20250630 | gpt-5.3-codex | ¥1.75×1.39  | ¥0.175×28.14  | ¥14×0.2    | ¥10.2 |
| 20250631 | gpt-5.3-codex | ¥1.75×0.5   | ¥0.175×7.64   | ¥14×0.0485 | ¥2.89 |

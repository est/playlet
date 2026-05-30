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
- Session playlist: add, remove, play from queue
- Copy media URL from library rows and playlist rows (`⧉`)
- Auto-detect `rootDesc.xml`, with hidden advanced URL override
- Scroll isolation for panel internals (better trackpad behavior on macOS)
- Native `<audio controls>` player for reliable seek/progress behavior
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

- `http://127.0.0.1:8788/index.html?playlet_desc=http://127.0.0.1:8788/mock/rootDesc.xml`

Then in DevTools console:

```js
import("http://127.0.0.1:8788/loader.js")
```

## Build

```bash
npm run build
npm run serve:dist
```

Build outputs:

- `dist/loader.js`: esbuild bundle + minified (single download path)
- `dist/app.js`: copied source for fallback/local debug
- `dist/index.html`: copied from editable `src/index.html`

`src/index.html` is plain editable source. You can tweak page content/style directly there.

## GitHub Pages deploy

Workflow: `.github/workflows/pages.yml`

- Trigger: push `main` or manual dispatch
- Install: `npm ci`
- Build: `npm run build`
- Publish artifact: `dist/`

Repository setting required:

- Settings -> Pages -> Source: `GitHub Actions`

## Architecture notes

- `src/loader.js`: loader runtime + fallback import path
- `src/entry-inline.js`: expose `bootPlaylet` for inline single-file load
- `src/loader-inline-entry.js`: entry to ensure inline app + loader bundled together
- `src/app.js`: DLNA SOAP client + DIDL parser + tree UI + playlist + media adapter

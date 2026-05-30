# Playlet

Playlet plays songs/media on any DLNA server, without installing a native client.

## Story

I have a NAS, it provides a DLNA server to host my song collections.

But I hate install a DLNA compatible app on phone/macOS. It's hard to find a good one.

So on a Saturday I decided to build a client myself. While evaluating tech stack and distribution options, I tried to ask ChatGPT whether browsers provide SSDP/uPNP natively, turns out no. I even tried to build [a Chrome App with `chrome.socket`](https://github.com/est/push2air) 13 years ago but went nowhere. You have to choose native UI, electron (boo!), or some command line utility, which are mostly very boring.

Suddently I had an idea: a DLNA client involves speaking HTTP anyway, and the DLNA server already has a web server. There's an ancient lesser-known trick called "bookmarklet". I could inject a small `.js` into the ugly DLNA index page, then do `fetch()` calls and render a nice player inline. No UDP, no CORS, no bullshit.

The rest is vibe coding history.

## How it works

1. Save this to browser bookmark:
   `javascript:import("https://<your-user>.github.io/playlet/loader.js")`
2. Open NAS DLNA index page
3. Click the saved bookmark

`loader.js` functions:

1. Discover/load device description XML (`rootDesc.xml` or provided URL)
2. Find `ContentDirectory` `controlURL`
3. Send `Browse` SOAP requests (`ObjectID`, `BrowseDirectChildren`)
4. Parse `DIDL-Lite` results into containers/items
5. Play item `res` URLs in an injected UI panel

## Project layout

- `src/loader.js`: bookmarklet entry loader
- `src/app.js`: DLNA client + DIDL parser + UI + media adapter
- `scripts/build.mjs`: build to `dist/`
- `scripts/dev-server.mjs`: local debug server + mock DLNA endpoints
- `.github/workflows/pages.yml`: GitHub Pages custom build/deploy action

## Local debug

### 1) Run dev server

```bash
npm run dev
```

Default URL: `http://127.0.0.1:8788`

### 2) Open debug page

Open `http://127.0.0.1:8788/index.html?playlet_desc=http://127.0.0.1:8788/mock/rootDesc.xml`

Then run in DevTools console:

```js
import("http://127.0.0.1:8788/loader.js")
```

### 3) Build and preview dist

```bash
npm run build
npm run serve:dist
```

Then use `http://127.0.0.1:8788/loader.js` as the deployed artifact preview.

## GitHub Pages deploy (custom action)

Workflow: `.github/workflows/pages.yml`

- Trigger: push to `main` or manual dispatch
- Build: `node scripts/build.mjs`
- Deploy artifact: `dist/`

Enable Pages in repo settings:

- Settings -> Pages -> Build and deployment -> Source: `GitHub Actions`

After deploy, your loader URL is:

`https://<your-user>.github.io/playlet/loader.js`

## Media extensibility design

Current playback uses `HtmlMediaAdapter` (`Audio` element), but adapter boundary is ready for extension.

Adapter feature probes are exposed in UI/debug state:

- `mediaSession` (`navigator.mediaSession`)
- `pip` (`document.pictureInPictureEnabled`)
- `remotePlayback` (`HTMLMediaElement.remote`)
- `castCandidate` (`PresentationRequest`)
- `mse` (`MediaSource`)
- `webCodecs` (`VideoDecoder`)

Recommended future adapters:

1. `MseAdapter`: stitch/transmux chunked streams
2. `WebCodecsAdapter`: custom decode pipeline for advanced controls
3. `RemotePlaybackAdapter`: route playback to external devices
4. `GaplessQueueAdapter`: prebuffer next track and smooth transitions

Because UI consumes adapter status via a shared interface, adding new playback modes should not require rewriting DLNA browse logic.

## Notes

- This project assumes bookmarklet runs on the NAS/DLNA HTTP origin to avoid CORS restrictions.
- For debugging SOAP details:

```js
window.__playletDebug.getLastRequest()
window.__playletDebug.getLastResponse()
window.__playletDebug.getState()
```

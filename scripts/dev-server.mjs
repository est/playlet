import http from "node:http";
import https from "node:https";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distMode = process.argv.includes("--dist");
const publicDir = distMode ? path.join(repoRoot, "dist") : path.join(repoRoot, "src");
const port = Number(process.env.PORT || 8788);
const PLAYLET_PREFIX = "/playlet";
const SAMPLE_TRACK_PATH = "/mock/media/sample.wav";

function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i < 0) return "";
  return process.argv[i + 1] || "";
}

const liveDlnaBase = argValue("--dlna-base");
const liveDlnaTarget = liveDlnaBase ? new URL(liveDlnaBase) : null;

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function contentTypeByExt(filePath) {
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}

function stripPrefix(pathname, prefix) {
  if (pathname === prefix) return "/";
  if (pathname.startsWith(prefix + "/")) return pathname.slice(prefix.length);
  return null;
}

function createSineWaveWav({ durationSec = 2, sampleRate = 22050, freq = 440 }) {
  const frameCount = Math.floor(durationSec * sampleRate);
  const dataSize = frameCount * 2;
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < frameCount; i += 1) {
    const t = i / sampleRate;
    const v = Math.sin(2 * Math.PI * freq * t);
    const int16 = Math.max(-1, Math.min(1, v)) * 32767;
    buffer.writeInt16LE(int16, headerSize + i * 2);
  }

  return buffer;
}

const sampleWav = createSineWaveWav({});

function xmlEscape(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function browseResponse({ objectId, host }) {
  let didl = "";
  if (objectId === "0") {
    didl = `
<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
  <container id="album-1" parentID="0" restricted="1" childCount="2">
    <dc:title>Demo Album</dc:title>
    <upnp:class>object.container.album.musicAlbum</upnp:class>
  </container>
</DIDL-Lite>`;
  } else if (objectId === "album-1") {
    didl = `
<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
  <item id="track-1" parentID="album-1" restricted="1">
    <dc:title>440Hz Test Tone</dc:title>
    <upnp:artist>Playlet Mock</upnp:artist>
    <upnp:album>Demo Album</upnp:album>
    <upnp:class>object.item.audioItem.musicTrack</upnp:class>
    <res protocolInfo="http-get:*:audio/wav:DLNA.ORG_OP=01;DLNA.ORG_CI=0" duration="00:00:02">http://${host}${PLAYLET_PREFIX}${SAMPLE_TRACK_PATH}</res>
  </item>
</DIDL-Lite>`;
  } else {
    didl = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"></DIDL-Lite>`;
  }

  const escapedDidl = xmlEscape(didl.trim());
  return `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <Result>${escapedDidl}</Result>
      <NumberReturned>10</NumberReturned>
      <TotalMatches>10</TotalMatches>
      <UpdateID>1</UpdateID>
    </u:BrowseResponse>
  </s:Body>
</s:Envelope>`;
}

function rootDesc() {
  return `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>Playlet Mock DLNA</friendlyName>
    <manufacturer>Playlet</manufacturer>
    <modelName>MockServer</modelName>
    <UDN>uuid:playlet-mock-1</UDN>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:ContentDirectory</serviceId>
        <controlURL>${PLAYLET_PREFIX}/mock/control</controlURL>
        <eventSubURL>${PLAYLET_PREFIX}/mock/event</eventSubURL>
        <SCPDURL>${PLAYLET_PREFIX}/mock/scpd.xml</SCPDURL>
      </service>
    </serviceList>
  </device>
</root>`;
}

function filteredProxyHeaders(headers, targetHost) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (key === "host") continue;
    if (key === "origin") continue;
    if (key === "referer") continue;
    out[k] = v;
  }
  out.Host = targetHost;
  return out;
}

async function proxyToLiveDlna(req, res, urlPathWithQuery) {
  if (!liveDlnaTarget) {
    return send(res, 503, "Live DLNA proxy not configured", { "Content-Type": "text/plain; charset=utf-8" });
  }

  const transport = liveDlnaTarget.protocol === "https:" ? https : http;
  const options = {
    protocol: liveDlnaTarget.protocol,
    hostname: liveDlnaTarget.hostname,
    port: liveDlnaTarget.port || (liveDlnaTarget.protocol === "https:" ? 443 : 80),
    method: req.method,
    path: urlPathWithQuery,
    headers: filteredProxyHeaders(req.headers, liveDlnaTarget.host),
  };

  const upstreamReq = transport.request(options, (upstreamRes) => {
    const headers = { ...upstreamRes.headers };
    delete headers["content-security-policy"];
    delete headers["x-frame-options"];
    res.writeHead(upstreamRes.statusCode || 502, headers);
    upstreamRes.pipe(res);
  });

  upstreamReq.on("error", (err) => {
    send(res, 502, `Proxy request failed: ${err.message}`, { "Content-Type": "text/plain; charset=utf-8" });
  });

  req.pipe(upstreamReq);
}

async function serveStaticAsset(reqPath, res) {
  const safe = reqPath === "/" ? "/index.html" : reqPath;
  const fullPath = path.join(publicDir, safe);
  try {
    const st = await stat(fullPath);
    if (st.isDirectory()) {
      const idx = path.join(fullPath, "index.html");
      const content = await readFile(idx);
      return send(res, 200, content, { "Content-Type": "text/html; charset=utf-8" });
    }
    const content = await readFile(fullPath);
    return send(res, 200, content, { "Content-Type": contentTypeByExt(fullPath) });
  } catch {
    return send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
  }
}

function playletDebugHtml(host) {
  const descHint = liveDlnaTarget ? `http://${host}/rootDesc.xml` : `http://${host}${PLAYLET_PREFIX}/mock/rootDesc.xml`;
  const iframeSrc = liveDlnaTarget ? "/" : `${PLAYLET_PREFIX}/`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Playlet Proxy Debug</title>
  <style>
    body { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 10px; font-size: 12px; }
    .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; white-space: nowrap; }
    .title { font-weight: 700; font-size: 12px; color: #0f172a; }
    .hint { color: #475569; font-size: 11px; }
    input, button { font: inherit; padding: 4px 8px; }
    input { flex: 1; min-width: 220px; }
    iframe { width: 100%; height: calc(100vh - 70px); border: 1px solid #cbd5e1; border-radius: 8px; }
    code { background: #f1f5f9; padding: 1px 5px; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="title">Playlet Local Proxy Debug</span>
    <label>Desc URL</label>
    <input id="desc" size="52" value="${descHint}" />
    <button id="inject">Inject Bookmarklet (import)</button>
    <span class="hint">inject <code>import('/playlet/loader.js')</code> into iframe</span>
  </div>
  <iframe id="frame" src="${iframeSrc}"></iframe>
  <script>
    const frame = document.getElementById('frame');
    const input = document.getElementById('desc');
    document.getElementById('inject').addEventListener('click', async () => {
      const desc = input.value.trim();
      const w = frame.contentWindow;
      if (!w) return;
      w.history.replaceState({}, '', '?playlet_desc=' + encodeURIComponent(desc));
      try {
        await w.eval('import("${PLAYLET_PREFIX}/loader.js")');
      } catch (e) {
        alert('inject failed: ' + e.message);
      }
    });
  </script>
</body>
</html>`;
}

async function handlePlayletRoutes(req, res, pathOnly, host) {
  if (req.method === "GET" && pathOnly === "/debug") {
    return send(res, 200, playletDebugHtml(host), { "Content-Type": "text/html; charset=utf-8" });
  }

  if (req.method === "GET" && pathOnly === "/mock/rootDesc.xml") {
    return send(res, 200, rootDesc(), { "Content-Type": "application/xml; charset=utf-8" });
  }

  if (req.method === "POST" && pathOnly === "/mock/control") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const objectIdMatch = body.match(/<ObjectID>([^<]+)<\/ObjectID>/);
    const objectId = objectIdMatch ? objectIdMatch[1] : "0";
    const soap = browseResponse({ objectId, host });
    return send(res, 200, soap, { "Content-Type": "text/xml; charset=utf-8" });
  }

  if (req.method === "GET" && pathOnly === SAMPLE_TRACK_PATH) {
    return send(res, 200, sampleWav, {
      "Content-Type": "audio/wav",
      "Content-Length": sampleWav.byteLength,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
  }

  return serveStaticAsset(pathOnly, res);
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `127.0.0.1:${port}`;
  const url = new URL(req.url || "/", `http://${host}`);
  const playletPath = stripPrefix(url.pathname, PLAYLET_PREFIX);

  if (playletPath !== null) {
    return handlePlayletRoutes(req, res, playletPath, host);
  }

  if (liveDlnaTarget) {
    // Any non-/playlet path is forwarded to DLNA origin unchanged.
    return proxyToLiveDlna(req, res, url.pathname + url.search);
  }

  // No live target: keep root usable by serving local assets (for mock-only debug).
  return serveStaticAsset(url.pathname, res);
});

server.listen(port, "127.0.0.1", () => {
  const mode = distMode ? "dist" : "src";
  console.log(`[dev-server] mode=${mode}`);
  console.log(`[dev-server] http://127.0.0.1:${port}`);
  console.log(`[dev-server] playlet ui: http://127.0.0.1:${port}${PLAYLET_PREFIX}/`);
  console.log(`[dev-server] playlet debug: http://127.0.0.1:${port}${PLAYLET_PREFIX}/debug`);
  if (liveDlnaTarget) {
    console.log(`[dev-server] live proxy root -> ${liveDlnaTarget.href}`);
    console.log(`[dev-server] route split: /playlet/* local, /* DLNA proxy`);
  } else {
    console.log(`[dev-server] no live proxy; root serves local files`);
    console.log(`[dev-server] mock desc: http://127.0.0.1:${port}${PLAYLET_PREFIX}/mock/rootDesc.xml`);
  }
});

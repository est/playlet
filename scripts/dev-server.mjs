import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distMode = process.argv.includes("--dist");
const publicDir = distMode ? path.join(repoRoot, "dist") : path.join(repoRoot, "src");
const port = Number(process.env.PORT || 8788);

const SAMPLE_TRACK_PATH = "/mock/media/sample.wav";

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

function contentTypeByExt(filePath) {
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

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
    <res protocolInfo="http-get:*:audio/wav:DLNA.ORG_OP=01;DLNA.ORG_CI=0" duration="00:00:02">http://${host}${SAMPLE_TRACK_PATH}</res>
  </item>
  <item id="track-2" parentID="album-1" restricted="1">
    <dc:title>Broken Track (for error test)</dc:title>
    <upnp:artist>Playlet Mock</upnp:artist>
    <upnp:album>Demo Album</upnp:album>
    <upnp:class>object.item.audioItem.musicTrack</upnp:class>
    <res protocolInfo="http-get:*:audio/mpeg:*">http://${host}/mock/media/missing.mp3</res>
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

function rootDesc(host) {
  return `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion>
    <major>1</major><minor>0</minor>
  </specVersion>
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
        <controlURL>/mock/control</controlURL>
        <eventSubURL>/mock/event</eventSubURL>
        <SCPDURL>/mock/scpd.xml</SCPDURL>
      </service>
    </serviceList>
  </device>
</root>`;
}

async function serveStatic(reqPath, res) {
  const safe = reqPath === "/" ? "/index.html" : reqPath;
  const fullPath = path.join(publicDir, safe);
  try {
    const st = await stat(fullPath);
    if (st.isDirectory()) {
      const idx = path.join(fullPath, "index.html");
      const content = await readFile(idx);
      send(res, 200, content, { "Content-Type": "text/html; charset=utf-8" });
      return;
    }
    const content = await readFile(fullPath);
    send(res, 200, content, { "Content-Type": contentTypeByExt(fullPath) });
  } catch {
    send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${port}`}`);

  if (req.method === "GET" && url.pathname === "/mock/rootDesc.xml") {
    return send(res, 200, rootDesc(req.headers.host || `127.0.0.1:${port}`), {
      "Content-Type": "application/xml; charset=utf-8",
    });
  }

  if (req.method === "POST" && url.pathname === "/mock/control") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const objectIdMatch = body.match(/<ObjectID>([^<]+)<\/ObjectID>/);
    const objectId = objectIdMatch ? objectIdMatch[1] : "0";
    const soap = browseResponse({ objectId, host: req.headers.host || `127.0.0.1:${port}` });

    return send(res, 200, soap, {
      "Content-Type": "text/xml; charset=utf-8",
    });
  }

  if (req.method === "GET" && url.pathname === SAMPLE_TRACK_PATH) {
    return send(res, 200, sampleWav, {
      "Content-Type": "audio/wav",
      "Content-Length": sampleWav.byteLength,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
  }

  if (req.method === "GET" && url.pathname === "/index.html" && !distMode) {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Playlet Local Debug</title>
  <style>
    body { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>Playlet Local Debug</h1>
  <p>Open this page and run this in DevTools console:</p>
  <pre>import("http://127.0.0.1:${port}/loader.js")</pre>
  <p>Mock DLNA description URL:</p>
  <pre>http://127.0.0.1:${port}/mock/rootDesc.xml</pre>
  <p>Or add query param to auto-fill:</p>
  <pre>?playlet_desc=http://127.0.0.1:${port}/mock/rootDesc.xml</pre>
</body>
</html>`;
    return send(res, 200, html, { "Content-Type": "text/html; charset=utf-8" });
  }

  return serveStatic(url.pathname, res);
});

server.listen(port, "127.0.0.1", () => {
  const mode = distMode ? "dist" : "src";
  console.log(`[dev-server] mode=${mode}`);
  console.log(`[dev-server] http://127.0.0.1:${port}`);
  console.log(`[dev-server] mock desc: http://127.0.0.1:${port}/mock/rootDesc.xml`);
});

import { CONTENT_DIRECTORY_SERVICE } from "../core/constants.js";

export function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizeUrl(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

export function firstElementByLocalName(node, localName) {
  const byNs = node.getElementsByTagNameNS ? node.getElementsByTagNameNS("*", localName) : [];
  if (byNs && byNs.length) return byNs[0];
  const byTag = node.getElementsByTagName ? node.getElementsByTagName(localName) : [];
  return byTag && byTag.length ? byTag[0] : null;
}

export function allElementsByLocalName(node, localName) {
  const list = node.getElementsByTagNameNS ? node.getElementsByTagNameNS("*", localName) : [];
  if (list && list.length) return Array.from(list);
  const fallback = node.getElementsByTagName ? node.getElementsByTagName(localName) : [];
  return Array.from(fallback || []);
}

export function textByLocalName(node, localName) {
  const el = firstElementByLocalName(node, localName);
  return el?.textContent?.trim() || "";
}

export function parseDurationToSeconds(input) {
  if (!input) return null;
  const match = input.match(/^(\d+):(\d+):(\d+)(?:\.\d+)?$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function parseProtocolInfo(info) {
  const [protocol = "", network = "", mime = "", extras = ""] = String(info || "").split(":");
  const flags = Object.fromEntries(
    extras
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((entry) => {
        const [k, v = ""] = entry.split("=");
        return [k, v];
      })
  );
  return { protocol, network, mime, flags, raw: info || "" };
}

export function pickPlayableResource(resources) {
  const scored = resources
    .map((res) => {
      const protocol = parseProtocolInfo(res.protocolInfo);
      let score = 0;
      if (protocol.protocol === "http-get") score += 4;
      if (protocol.mime.startsWith("audio/")) score += 4;
      if (protocol.mime === "audio/flac") score += 3;
      if (protocol.mime === "audio/mp4") score += 3;
      if (protocol.mime === "audio/mpeg") score += 2;
      if (protocol.mime === "audio/x-wav") score += 2;
      if (protocol.flags["DLNA.ORG_OP"] && protocol.flags["DLNA.ORG_OP"] !== "00") score += 1;
      return { ...res, protocol, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

export function parseDidlEntries(xmlText, baseUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`DIDL parse failed: ${parseError.textContent?.trim() || "Unknown parser error"}`);
  }

  const containers = allElementsByLocalName(doc, "container").map((node) => ({
    kind: "container",
    id: node.getAttribute("id") || "",
    parentId: node.getAttribute("parentID") || "",
    title: textByLocalName(node, "title") || "(untitled folder)",
    childCount: Number(node.getAttribute("childCount") || "0") || 0,
  }));

  const items = allElementsByLocalName(doc, "item").map((node) => {
    const resources = allElementsByLocalName(node, "res")
      .map((resNode) => {
        const url = (resNode.textContent || "").trim();
        if (!url) return null;
        return {
          url: normalizeUrl(url, baseUrl),
          protocolInfo: resNode.getAttribute("protocolInfo") || "",
          bitrate: Number(resNode.getAttribute("bitrate") || "0") || null,
          duration: resNode.getAttribute("duration") || "",
        };
      })
      .filter(Boolean);

    const best = pickPlayableResource(resources);

    return {
      kind: "item",
      id: node.getAttribute("id") || "",
      parentId: node.getAttribute("parentID") || "",
      title: textByLocalName(node, "title") || "(untitled track)",
      artist: textByLocalName(node, "artist"),
      album: textByLocalName(node, "album"),
      className: textByLocalName(node, "class"),
      resources,
      playable: Boolean(best),
      bestResource: best,
      durationSeconds: parseDurationToSeconds(best?.duration || ""),
    };
  });

  return [...containers, ...items];
}

export function escapeSearchValue(input) {
  return String(input || "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function buildDlnaSearchCriteria(keyword) {
  const q = escapeSearchValue(keyword);
  return `upnp:class derivedfrom "object.item.audioItem" and (dc:title contains "${q}" or upnp:artist contains "${q}" or upnp:album contains "${q}")`;
}

export function textMatchesKeyword(node, keyword) {
  const q = String(keyword || "").trim().toLowerCase();
  if (!q) return false;
  const fields = [node.title, node.artist, node.album, node.className];
  return fields.some((x) => String(x || "").toLowerCase().includes(q));
}

export class DlnaClient {
  constructor(descUrl) {
    this.descUrl = descUrl;
    this.descBase = new URL(descUrl, location.href).href;
    this.controlUrl = "";
    this.serviceType = CONTENT_DIRECTORY_SERVICE;
    this.serviceName = "";
    this.lastRequest = null;
    this.lastResponse = null;
    this.searchAvailable = true;
  }

  async init() {
    const res = await fetch(this.descBase);
    if (!res.ok) throw new Error(`Description fetch failed: ${res.status} ${res.statusText}`);

    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      throw new Error(`Description XML parse failed: ${parseError.textContent?.trim() || "Unknown parser error"}`);
    }

    this.serviceName = textByLocalName(doc, "friendlyName") || "DLNA Device";
    const serviceNodes = allElementsByLocalName(doc, "service");
    const target = serviceNodes.find((node) => textByLocalName(node, "serviceType") === CONTENT_DIRECTORY_SERVICE);

    if (!target) throw new Error("ContentDirectory service not found in device description");

    const rawControlUrl = textByLocalName(target, "controlURL");
    if (!rawControlUrl) throw new Error("ContentDirectory controlURL is empty");

    this.controlUrl = normalizeUrl(rawControlUrl, this.descBase);
    return this;
  }

  async browse(objectId = "0", start = 0, count = 200) {
    const action = "Browse";
    const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Browse xmlns:u="${this.serviceType}">
      <ObjectID>${escapeHtml(objectId)}</ObjectID>
      <BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>${start}</StartingIndex>
      <RequestedCount>${count}</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse>
  </s:Body>
</s:Envelope>`;

    this.lastRequest = { url: this.controlUrl, action, objectId, body };

    const res = await fetch(this.controlUrl, {
      method: "POST",
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPAction: `"${this.serviceType}#${action}"`,
      },
      body,
    });

    const xml = await res.text();
    this.lastResponse = { status: res.status, ok: res.ok, xml };

    if (!res.ok) throw new Error(`Browse failed: ${res.status} ${res.statusText}`);

    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) throw new Error(`SOAP parse failed: ${parseError.textContent?.trim() || "Unknown parser error"}`);

    const fault = firstElementByLocalName(doc, "Fault");
    if (fault) throw new Error(`SOAP Fault: ${fault.textContent?.trim() || "Unknown fault"}`);

    const resultNode = firstElementByLocalName(doc, "Result");
    if (!resultNode) return [];

    return parseDidlEntries(resultNode.textContent || "", this.controlUrl);
  }

  async search(containerId = "0", searchCriteria = "", start = 0, count = 200, sortCriteria = "") {
    if (this.searchAvailable === false) {
      const err = new Error("DLNA Search action not available");
      err.code = "SEARCH_UNAVAILABLE";
      throw err;
    }

    const action = "Search";
    const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Search xmlns:u="${this.serviceType}">
      <ContainerID>${escapeHtml(containerId)}</ContainerID>
      <SearchCriteria>${escapeHtml(searchCriteria)}</SearchCriteria>
      <Filter>*</Filter>
      <StartingIndex>${start}</StartingIndex>
      <RequestedCount>${count}</RequestedCount>
      <SortCriteria>${escapeHtml(sortCriteria)}</SortCriteria>
    </u:Search>
  </s:Body>
</s:Envelope>`;

    this.lastRequest = { url: this.controlUrl, action, containerId, searchCriteria, body };

    const res = await fetch(this.controlUrl, {
      method: "POST",
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        SOAPAction: `"${this.serviceType}#${action}"`,
      },
      body,
    });

    const xml = await res.text();
    this.lastResponse = { status: res.status, ok: res.ok, xml };

    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) throw new Error(`SOAP parse failed: ${parseError.textContent?.trim() || "Unknown parser error"}`);

    const fault = firstElementByLocalName(doc, "Fault");
    if (fault) {
      const faultText = fault.textContent?.trim() || "Unknown fault";
      if (faultText.includes("401") || faultText.toLowerCase().includes("invalid action")) {
        this.searchAvailable = false;
        const err = new Error("DLNA Search action not available");
        err.code = "SEARCH_UNAVAILABLE";
        throw err;
      }
      throw new Error(`SOAP Fault: ${faultText}`);
    }

    if (!res.ok) throw new Error(`Search failed: ${res.status} ${res.statusText}`);

    const resultNode = firstElementByLocalName(doc, "Result");
    if (!resultNode) return [];

    return parseDidlEntries(resultNode.textContent || "", this.controlUrl);
  }
}

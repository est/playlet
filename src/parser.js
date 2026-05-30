const MEDIA_EXTENSIONS = [".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus"];

function decodeHtml(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function stripTags(text) {
  return text.replace(/<[^>]*>/g, "");
}

function normalizeUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function trackTitleFromUrl(url) {
  const pathname = new URL(url).pathname;
  const file = pathname.split("/").pop() || "Unknown";
  return decodeURIComponent(file).replace(/\.[^.]+$/, "");
}

function isTrackUrl(url) {
  const cleanPath = new URL(url).pathname.toLowerCase();
  return MEDIA_EXTENSIONS.some((ext) => cleanPath.endsWith(ext));
}

function parseAnchors(html) {
  const anchors = [];
  const regex = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match = regex.exec(html);
  while (match) {
    anchors.push({
      href: decodeHtml(match[2].trim()),
      text: decodeHtml(stripTags(match[3]).trim()),
    });
    match = regex.exec(html);
  }
  return anchors;
}

function dedupeTracks(tracks) {
  const seen = new Set();
  const deduped = [];
  for (const track of tracks) {
    if (seen.has(track.url)) continue;
    seen.add(track.url);
    deduped.push(track);
  }
  return deduped;
}

export function parseDlnaIndex(html, baseUrl) {
  const anchors = parseAnchors(html);
  const folders = [];
  const tracks = [];
  const warnings = [];

  for (const anchor of anchors) {
    const normalized = normalizeUrl(anchor.href, baseUrl);
    if (!normalized) continue;

    if (isTrackUrl(normalized)) {
      tracks.push({
        id: normalized,
        title: anchor.text || trackTitleFromUrl(normalized),
        url: normalized,
      });
      continue;
    }

    if (anchor.href.endsWith("/") || normalized.endsWith("/")) {
      folders.push({
        id: normalized,
        title: anchor.text || decodeURIComponent(new URL(normalized).pathname.split("/").filter(Boolean).pop() || "Folder"),
        url: normalized,
      });
    }
  }

  const dedupedTracks = dedupeTracks(tracks);
  if (anchors.length === 0) warnings.push("No anchor tags found.");
  if (dedupedTracks.length === 0) warnings.push("No playable media links found.");

  const supported = anchors.length > 0 && dedupedTracks.length > 0;
  const confidence = supported ? 1 : anchors.length > 0 ? 0.4 : 0;

  return {
    supported,
    confidence,
    folders,
    tracks: dedupedTracks,
    warnings,
    diagnostics: {
      baseUrl,
      hasAnchorTags: anchors.length > 0,
      anchorCount: anchors.length,
      folderCount: folders.length,
      trackCount: dedupedTracks.length,
    },
  };
}

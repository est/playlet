import { MODE_LOOP_ALL, PLAY_MODES, PLAYLET_STORAGE_KEY } from "../core/constants.js";

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage quota/permission failures
  }
}

export function savePrefsToStorage({ playMode, stars }) {
  const payload = {
    playMode,
    stars,
  };
  safeLocalStorageSet(PLAYLET_STORAGE_KEY, JSON.stringify(payload));
}

export function loadPrefsFromStorage() {
  const raw = safeLocalStorageGet(PLAYLET_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      playMode: PLAY_MODES.includes(parsed?.playMode) ? parsed.playMode : MODE_LOOP_ALL,
      stars: parsed?.stars && typeof parsed.stars === "object" ? parsed.stars : {},
    };
  } catch {
    return null;
  }
}

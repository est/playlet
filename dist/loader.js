const PLAYLET_LOADER_KEY = "__playletLoaderState";
const DEFAULT_APP_FILE = "app.js";
const LOADER_VERSION = "local-20260530-090535";

function resolveBaseUrl() {
  const scriptUrl = new URL(import.meta.url);
  return new URL("./", scriptUrl).href;
}

function shouldReloadApp(existingVersion, nextVersion) {
  return existingVersion !== nextVersion;
}

function getGlobalState() {
  if (!window[PLAYLET_LOADER_KEY]) {
    window[PLAYLET_LOADER_KEY] = {
      loading: null,
      appVersion: null,
      baseUrl: null,
    };
  }
  return window[PLAYLET_LOADER_KEY];
}

async function loadPlayletApp() {
  const state = getGlobalState();
  const baseUrl = resolveBaseUrl();

  if (state.loading && state.baseUrl === baseUrl && !shouldReloadApp(state.appVersion, LOADER_VERSION)) {
    return state.loading;
  }

  state.baseUrl = baseUrl;
  state.appVersion = LOADER_VERSION;

  const appUrl = new URL(DEFAULT_APP_FILE, baseUrl);
  appUrl.searchParams.set("v", LOADER_VERSION);

  state.loading = import(appUrl.href)
    .then((mod) => {
      if (typeof mod.bootPlaylet !== "function") {
        throw new Error("Playlet app module missing bootPlaylet()");
      }
      return mod.bootPlaylet({
        baseUrl,
        version: LOADER_VERSION,
      });
    })
    .catch((err) => {
      state.loading = null;
      throw err;
    });

  return state.loading;
}

loadPlayletApp().catch((err) => {
  console.error("[Playlet] Failed to load", err);
  alert(`[Playlet] Failed to load: ${err.message}`);
});

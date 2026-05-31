import test from "node:test";
import assert from "node:assert/strict";

import { PLAYLET_RUNTIME_KEY } from "../src/core/constants.js";
import { bootPlaylet } from "../src/app.js";

function installGlobals({ href = "http://example.test/", search = "" } = {}) {
  const oldWindow = globalThis.window;
  const oldLocation = globalThis.location;
  const oldLocalStorage = globalThis.localStorage;

  globalThis.window = {};
  globalThis.location = {
    href,
    search,
  };
  globalThis.localStorage = {
    getItem() {
      return null;
    },
    setItem() {},
  };

  return () => {
    globalThis.window = oldWindow;
    globalThis.location = oldLocation;
    globalThis.localStorage = oldLocalStorage;
  };
}

function createHooks(counters, options = {}) {
  const root = {
    remove() {
      counters.rootRemoved += 1;
    },
  };

  const mediaAdapter = {
    destroy() {
      counters.mediaDestroyed += 1;
    },
  };

  return {
    skipAutoConnect: Boolean(options.skipAutoConnect),
    createStyles() {
      counters.stylesCreated += 1;
    },
    mountRoot() {
      counters.mounted += 1;
      return root;
    },
    createMediaAdapter() {
      counters.mediaCreated += 1;
      return mediaAdapter;
    },
    createUi() {
      counters.uiCreated += 1;
      return {
        render() {
          counters.rendered += 1;
        },
        async connectAndLoad(descUrl) {
          counters.connectCalls += 1;
          counters.lastDesc = descUrl;
        },
        dispose() {
          counters.uiDisposed += 1;
        },
      };
    },
  };
}

test("bootPlaylet reuses runtime for same base/version and reconnects", async () => {
  const restore = installGlobals({
    href: "http://example.test/page",
    search: "?playlet_desc=http%3A%2F%2Fexample.test%2FrootDesc.xml",
  });

  const counters = {
    stylesCreated: 0,
    mounted: 0,
    mediaCreated: 0,
    uiCreated: 0,
    rendered: 0,
    connectCalls: 0,
    lastDesc: "",
    uiDisposed: 0,
    mediaDestroyed: 0,
    rootRemoved: 0,
  };

  try {
    const hooks = createHooks(counters, { skipAutoConnect: true });

    const runtime1 = await bootPlaylet({ baseUrl: "http://cdn/a/", version: "v1", testHooks: hooks });
    assert.equal(counters.connectCalls, 0);

    const runtime2 = await bootPlaylet({ baseUrl: "http://cdn/a/", version: "v1", testHooks: hooks });
    assert.equal(runtime2, runtime1);
    assert.equal(counters.connectCalls, 1);
    assert.equal(counters.lastDesc, "http://example.test/rootDesc.xml");
    assert.equal(counters.uiDisposed, 0);
    assert.equal(counters.mediaDestroyed, 0);
  } finally {
    restore();
  }
});

test("bootPlaylet replaces runtime on version change and dispose tears down", async () => {
  const restore = installGlobals({ href: "http://example.test/page", search: "" });

  const countersA = {
    stylesCreated: 0,
    mounted: 0,
    mediaCreated: 0,
    uiCreated: 0,
    rendered: 0,
    connectCalls: 0,
    lastDesc: "",
    uiDisposed: 0,
    mediaDestroyed: 0,
    rootRemoved: 0,
  };
  const countersB = {
    stylesCreated: 0,
    mounted: 0,
    mediaCreated: 0,
    uiCreated: 0,
    rendered: 0,
    connectCalls: 0,
    lastDesc: "",
    uiDisposed: 0,
    mediaDestroyed: 0,
    rootRemoved: 0,
  };

  try {
    const runtime1 = await bootPlaylet({
      baseUrl: "http://cdn/a/",
      version: "v1",
      testHooks: createHooks(countersA, { skipAutoConnect: true }),
    });

    const runtime2 = await bootPlaylet({
      baseUrl: "http://cdn/a/",
      version: "v2",
      testHooks: createHooks(countersB, { skipAutoConnect: true }),
    });

    assert.notEqual(runtime2, runtime1);
    assert.equal(countersA.uiDisposed, 1);
    assert.equal(countersA.mediaDestroyed, 1);
    assert.equal(countersA.rootRemoved, 1);

    runtime2.dispose();
    assert.equal(countersB.uiDisposed, 1);
    assert.equal(countersB.mediaDestroyed, 1);
    assert.equal(countersB.rootRemoved, 1);
    assert.equal(window[PLAYLET_RUNTIME_KEY], runtime2);
  } finally {
    restore();
  }
});

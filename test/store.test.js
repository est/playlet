import test from "node:test";
import assert from "node:assert/strict";

import { createStore } from "../src/core/store.js";

test("createStore setState and subscribe", () => {
  const store = createStore({ a: 1, b: 2 });
  const updates = [];
  const unsubscribe = store.subscribe((s) => updates.push({ ...s }));

  store.setState({ b: 3 });
  assert.deepEqual(store.getState(), { a: 1, b: 3 });
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], { a: 1, b: 3 });

  unsubscribe();
  store.setState({ b: 4 });
  assert.equal(updates.length, 1);
});

test("createStore mutate applies callback and publishes", () => {
  const store = createStore({ count: 1 });
  let called = 0;
  store.subscribe(() => {
    called += 1;
  });

  store.mutate((state) => {
    state.count += 2;
  });

  assert.equal(store.getState().count, 3);
  assert.equal(called, 1);
});

export function createStore(initialState) {
  const state = { ...initialState };
  const listeners = new Set();

  function getState() {
    return state;
  }

  function setState(next) {
    Object.assign(state, next);
    for (const cb of listeners) cb(state);
  }

  function subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  function mutate(mutator) {
    mutator(state);
    for (const cb of listeners) cb(state);
  }

  return {
    getState,
    setState,
    mutate,
    subscribe,
  };
}

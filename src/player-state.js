export function createPlayerState() {
  const state = {
    queue: [],
    currentIndex: -1,
    playing: false,
    position: 0,
    volume: 1,
  };

  function clampIndex(index) {
    if (state.queue.length === 0) return -1;
    return Math.max(0, Math.min(index, state.queue.length - 1));
  }

  return {
    setQueue(queue) {
      state.queue = [...queue];
      state.currentIndex = state.queue.length > 0 ? 0 : -1;
      state.playing = false;
      state.position = 0;
    },
    playAt(index) {
      const nextIndex = clampIndex(index);
      if (nextIndex === -1) return;
      state.currentIndex = nextIndex;
      state.playing = true;
      state.position = 0;
    },
    currentTrack() {
      if (state.currentIndex < 0 || state.currentIndex >= state.queue.length) return null;
      return state.queue[state.currentIndex];
    },
    next() {
      if (state.queue.length === 0) return;
      state.currentIndex = clampIndex(state.currentIndex + 1);
    },
    prev() {
      if (state.queue.length === 0) return;
      state.currentIndex = clampIndex(state.currentIndex - 1);
    },
    removeTrackById(trackId) {
      const removeIndex = state.queue.findIndex((track) => track.id === trackId);
      if (removeIndex === -1) return;
      state.queue.splice(removeIndex, 1);
      if (state.queue.length === 0) {
        state.currentIndex = -1;
        state.playing = false;
        return;
      }
      if (removeIndex < state.currentIndex) {
        state.currentIndex -= 1;
      } else if (removeIndex === state.currentIndex) {
        state.currentIndex = clampIndex(state.currentIndex);
      }
    },
    snapshot() {
      return {
        queue: [...state.queue],
        currentIndex: state.currentIndex,
        playing: state.playing,
        position: state.position,
        volume: state.volume,
      };
    },
  };
}

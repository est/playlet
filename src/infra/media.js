export class BaseMediaAdapter {
  constructor() {
    this.features = {
      pip: false,
      mediaSession: false,
      remotePlayback: false,
      castCandidate: false,
      mse: false,
      webCodecs: false,
    };
  }

  playResource() {
    throw new Error("playResource() must be implemented");
  }

  pause() {}
  destroy() {}

  getStatus() {
    return {
      currentTime: 0,
      duration: NaN,
      paused: true,
      volume: 1,
      features: this.features,
      error: "",
    };
  }
}

export class HtmlMediaAdapter extends BaseMediaAdapter {
  constructor(onState) {
    super();
    this.onState = onState;
    this.audio = new Audio();
    this.audio.preload = "metadata";
    this.audio.controls = true;
    this.audio.playsInline = true;

    this.features = {
      pip: typeof document.pictureInPictureEnabled === "boolean",
      mediaSession: "mediaSession" in navigator,
      remotePlayback: "remote" in this.audio,
      castCandidate: "PresentationRequest" in window,
      mse: "MediaSource" in window,
      webCodecs: "VideoDecoder" in window,
    };

    this.boundEmit = this.emitState.bind(this);
    ["play", "pause", "ended", "volumechange", "loadedmetadata", "error"].forEach((evt) => {
      this.audio.addEventListener(evt, this.boundEmit);
    });
  }

  emitState() {
    if (this.onState) this.onState(this.getStatus());
  }

  async playResource(resource, metadata) {
    if (!resource?.url) throw new Error("No media URL to play");
    this.audio.src = resource.url;

    if (this.features.mediaSession && metadata) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: metadata.title || "Unknown",
        artist: metadata.artist || "",
        album: metadata.album || "",
      });
    }

    await this.audio.play();
    this.emitState();
  }

  pause() {
    this.audio.pause();
    this.emitState();
  }

  async resume() {
    await this.audio.play();
    this.emitState();
  }

  setVolume(volume) {
    this.audio.volume = Math.max(0, Math.min(1, volume));
    this.emitState();
  }

  getStatus() {
    return {
      currentTime: this.audio.currentTime || 0,
      duration: this.audio.duration,
      paused: this.audio.paused,
      volume: this.audio.volume,
      features: this.features,
      error: this.audio.error ? `MediaError code ${this.audio.error.code}` : "",
    };
  }

  getElement() {
    return this.audio;
  }

  destroy() {
    this.audio.pause();
    this.audio.src = "";
    ["play", "pause", "ended", "volumechange", "loadedmetadata", "error"].forEach((evt) => {
      this.audio.removeEventListener(evt, this.boundEmit);
    });
  }
}

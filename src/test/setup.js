import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/* jsdom has no SpeechSynthesis. This stand-in records what was spoken and
   fires `onend` asynchronously, the way a real engine does, so the queueing
   and sentence-advance logic is genuinely exercised rather than stubbed out. */
class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.onend = null;
    this.onerror = null;
  }
}

export const spoken = [];

const synth = {
  paused: false,
  speaking: false,
  _pending: [],
  speak(u) {
    spoken.push(u.text);
    this.speaking = true;
    const timer = setTimeout(() => {
      this.speaking = false;
      this._pending = this._pending.filter((t) => t !== timer);
      u.onend?.();
    }, 0);
    this._pending.push(timer);
  },
  cancel() {
    this._pending.forEach(clearTimeout);
    this._pending = [];
    this.speaking = false;
  },
  pause() { this.paused = true; },
  resume() { this.paused = false; },
  getVoices() {
    return [
      { name: "Test English", lang: "en-IN" },
      { name: "Test Hindi", lang: "hi-IN" },
    ];
  },
  addEventListener() {},
  removeEventListener() {},
};

vi.stubGlobal("speechSynthesis", synth);
vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
window.speechSynthesis = synth;
window.SpeechSynthesisUtterance = FakeUtterance;

// jsdom implements neither, and both are called during navigation.
window.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

/* jsdom has no media pipeline, so play() throws "not implemented" and the
   landing page's autoplay path would never be exercised. This stand-in
   resolves by default; a test can make it reject to check the behaviour
   when a browser refuses autoplay. */
export const media = { rejectPlay: false };

window.HTMLMediaElement.prototype.play = function play() {
  if (media.rejectPlay) return Promise.reject(new DOMException("NotAllowedError"));
  this.dispatchEvent(new Event("play"));
  return Promise.resolve();
};
window.HTMLMediaElement.prototype.pause = function pause() {};

/* Nothing about the entrance is persisted: App starts at the landing page
   on every fresh mount, and the suites that test the application pass
   `startAtLanding={false}` instead. */

export function resetSpoken() {
  spoken.length = 0;
  synth.cancel();
  synth.paused = false;
}

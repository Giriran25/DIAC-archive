/* ---------------------------------------------------------------------- *
 * Read-aloud built on the browser's own SpeechSynthesis engine.
 *
 * No API key and no network call — the voices ship with the OS. That also
 * means voice availability differs per device, so pickVoice() degrades
 * politely instead of assuming an Indian-language voice exists.
 * ---------------------------------------------------------------------- */

import { useCallback, useEffect, useRef, useState } from "react";

export const SPEECH_LOCALE = {
  en: "en-IN",
  hi: "hi-IN",
  mr: "mr-IN",
  kn: "kn-IN",
  ta: "ta-IN",
};

export function speechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(voices, locale) {
  if (!voices.length) return null;
  const exact = voices.find((v) => v.lang?.toLowerCase() === locale.toLowerCase());
  if (exact) return exact;
  const base = locale.split("-")[0].toLowerCase();
  const sameLang = voices.find((v) => v.lang?.toLowerCase().startsWith(base));
  if (sameLang) return sameLang;
  // Nothing for this language on this device — fall back to any English voice
  // rather than letting the engine pick something unintelligible.
  return voices.find((v) => v.lang?.toLowerCase().startsWith("en")) || voices[0];
}

/**
 * Reads an array of sentences aloud, reporting which one is being spoken so
 * the UI can highlight it. Speaking one sentence per utterance (rather than
 * one long utterance with boundary events) is what makes the highlight
 * reliable across browsers — Chrome and Safari disagree about charIndex.
 */
export function useReadAloud() {
  const [speakingId, setSpeakingId] = useState(null);
  const [sentenceIndex, setSentenceIndex] = useState(-1);
  const [paused, setPaused] = useState(false);
  const [voices, setVoices] = useState([]);

  const queueRef = useRef([]);
  const cursorRef = useRef(0);
  const idRef = useRef(null);
  const localeRef = useRef("en-IN");

  useEffect(() => {
    if (!speechSupported()) return;
    const load = () => setVoices(window.speechSynthesis.getVoices() || []);
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const stop = useCallback(() => {
    if (!speechSupported()) return;
    queueRef.current = [];
    cursorRef.current = 0;
    idRef.current = null;
    window.speechSynthesis.cancel();
    setSpeakingId(null);
    setSentenceIndex(-1);
    setPaused(false);
  }, []);

  // Anything still queued when the component unmounts would keep talking over
  // the next view, so tear the queue down explicitly.
  useEffect(() => stop, [stop]);

  const speakNext = useCallback(() => {
    const queue = queueRef.current;
    const i = cursorRef.current;

    if (i >= queue.length) {
      // Clear the id too — otherwise pressing Listen again on the same item
      // takes the toggle-off path and refuses to replay.
      idRef.current = null;
      setSpeakingId(null);
      setSentenceIndex(-1);
      setPaused(false);
      return;
    }

    setSentenceIndex(i);

    const utter = new SpeechSynthesisUtterance(queue[i]);
    utter.lang = localeRef.current;
    const voice = pickVoice(voices, localeRef.current);
    if (voice) utter.voice = voice;
    utter.rate = 0.95;
    utter.pitch = 1;

    utter.onend = () => {
      cursorRef.current += 1;
      speakNext();
    };
    utter.onerror = () => {
      // "interrupted" fires on every deliberate cancel — treat it as a stop,
      // not as a failure worth surfacing.
      idRef.current = null;
      setSpeakingId(null);
      setSentenceIndex(-1);
      setPaused(false);
    };

    window.speechSynthesis.speak(utter);
  }, [voices]);

  const speak = useCallback(
    (id, sentences, lang = "en") => {
      if (!speechSupported()) return;

      // Tapping the same item again stops it — the expected toggle.
      if (idRef.current === id) {
        stop();
        return;
      }

      window.speechSynthesis.cancel();
      queueRef.current = sentences.filter((s) => s && s.trim());
      cursorRef.current = 0;
      idRef.current = id;
      localeRef.current = SPEECH_LOCALE[lang] || SPEECH_LOCALE.en;
      setSpeakingId(id);
      setPaused(false);
      speakNext();
    },
    [speakNext, stop]
  );

  const togglePause = useCallback(() => {
    if (!speechSupported() || !idRef.current) return;
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setPaused(false);
    } else {
      window.speechSynthesis.pause();
      setPaused(true);
    }
  }, []);

  const voiceFor = useCallback(
    (lang) => pickVoice(voices, SPEECH_LOCALE[lang] || SPEECH_LOCALE.en),
    [voices]
  );

  return {
    speak,
    stop,
    togglePause,
    speakingId,
    sentenceIndex,
    paused,
    voiceFor,
    supported: speechSupported(),
    voicesLoaded: voices.length > 0,
  };
}

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
  return voices.find((v) => v.lang?.toLowerCase().startsWith("en")) || voices[0];
}

/**
 * Reads an array of sentences aloud, reporting which one is being spoken so
 * the UI can highlight it. Supports adjustable speed rate and pause/resume.
 */
export function useReadAloud() {
  const [speakingId, setSpeakingId] = useState(null);
  const [sentenceIndex, setSentenceIndex] = useState(-1);
  const [paused, setPaused] = useState(false);
  const [voices, setVoices] = useState([]);
  const [rate, setRate] = useState(1.0); // 0.8, 1.0, 1.2

  const queueRef = useRef([]);
  const cursorRef = useRef(0);
  const idRef = useRef(null);
  const localeRef = useRef("en-IN");
  const rateRef = useRef(1.0);

  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

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

  // Cleanup on unmount
  useEffect(() => stop, [stop]);

  const speakNext = useCallback(() => {
    const queue = queueRef.current;
    const i = cursorRef.current;

    if (i >= queue.length) {
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
    utter.rate = rateRef.current;
    utter.pitch = 1;

    utter.onend = () => {
      cursorRef.current += 1;
      speakNext();
    };

    utter.onerror = () => {
      cursorRef.current += 1;
      speakNext();
    };

    window.speechSynthesis.speak(utter);
  }, [voices]);

  const speak = useCallback(
    (id, sentences, lang = "en") => {
      if (!speechSupported() || !sentences?.length) return;

      // If already playing this exact item, toggle stop
      if (idRef.current === id && !paused) {
        stop();
        return;
      }

      window.speechSynthesis.cancel();

      idRef.current = id;
      queueRef.current = sentences;
      cursorRef.current = 0;
      localeRef.current = SPEECH_LOCALE[lang] || "en-IN";

      setSpeakingId(id);
      setSentenceIndex(0);
      setPaused(false);

      speakNext();
    },
    [paused, speakNext, stop]
  );

  const togglePause = useCallback(() => {
    if (!speechSupported() || !speakingId) return;
    if (paused) {
      window.speechSynthesis.resume();
      setPaused(false);
    } else {
      window.speechSynthesis.pause();
      setPaused(true);
    }
  }, [paused, speakingId]);

  return {
    supported: speechSupported(),
    speakingId,
    sentenceIndex,
    paused,
    rate,
    setRate,
    speak,
    stop,
    togglePause,
  };
}

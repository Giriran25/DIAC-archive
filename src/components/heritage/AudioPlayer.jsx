import { useState, useRef } from "react";
import { Play, Pause, RotateCcw, Volume2, VolumeX, Clock, Disc } from "lucide-react";
import {
  FONT_DISPLAY, FONT_BODY, FONT_UI,
  GOLD, INKTEXT, CREAM
} from "../../lib/tokens.js";

/* ---------------------------------------------------------------------- */
/* AudioPlayer — Archival player with synchronized timestamp transcript    */
/* ---------------------------------------------------------------------- */

function formatSeconds(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function AudioPlayer({ mediaItem, t }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [failed, setFailed] = useState(false);
  const audioRef = useRef(null);

  /* This used to advance a progress bar on a setInterval with no audio
     element attached: the recording appeared to be playing when nothing was
     being played, and the transcript highlighted along with it. Position now
     comes from the media element, so it is the truth or it is nothing.
     The parent remounts this component per recording, so there is no stale
     position to reset here. */
  if (!mediaItem) return null;

  /* The archive says outright when it cannot serve an asset, and why. */
  const playable = Boolean(mediaItem.servable && mediaItem.streamUrl) && !failed;

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => setFailed(true));
    } else {
      el.pause();
    }
  };

  const seekTo = (seconds) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = seconds;
    setCurrentTime(seconds);
  };

  const handleSliderChange = (e) => seekTo(parseFloat(e.target.value));

  const toggleMute = () => {
    const el = audioRef.current;
    const next = !isMuted;
    setIsMuted(next);
    if (el) el.muted = next;
  };

  // Segment timings are in milliseconds in the archive; the element is in seconds.
  const activeSegmentIndex = mediaItem.segments?.findIndex(
    (seg) => currentTime * 1000 >= seg.startMs && currentTime * 1000 < seg.endMs
  );

  return (
    <div className="daic-reveal rounded-xl border border-[#d8c79a] bg-[#faf4e4] overflow-hidden">
      {/* Audio Controller Deck */}
      <div className="p-6 border-b border-[#d8c79a] bg-[#1c2c4d] text-[#f4ead0]">
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#141c30] border border-[#d8c79a] flex items-center justify-center shrink-0">
              <Disc size={20} className={isPlaying ? "daic-spin text-[#d9ac4f]" : "text-[#b3862c]"} />
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-widest text-[#d9ac4f]" style={{ fontFamily: FONT_UI }}>
                {t.audioArchive || "Archival Audio"}
              </span>
              <h3 className="text-lg md:text-xl font-semibold leading-snug" style={{ fontFamily: FONT_DISPLAY, color: CREAM }}>
                {mediaItem.title}
              </h3>
              {mediaItem.source && (
                <p className="text-xs text-[#b8c6e0] mt-0.5" style={{ fontFamily: FONT_UI }}>
                  Source: <span className="text-white font-medium">{mediaItem.source}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {playable && (
          <audio
            ref={audioRef}
            src={mediaItem.streamUrl}
            preload="metadata"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onError={() => setFailed(true)}
          />
        )}

        {!playable && (
          <div
            className="mb-3 px-3 py-2.5 rounded-lg text-[11px] leading-relaxed"
            style={{ backgroundColor: "#2a1f1a", color: "#e8cfc4", fontFamily: FONT_UI }}
            role="status"
          >
            <span className="font-semibold uppercase tracking-[0.12em]">Recording not playable</span>
            <br />
            {failed
              ? "The archive could not stream this recording from this device."
              : mediaItem.unservableReason || "This asset is catalogued but no playable file is held."}
            {" "}The transcript below is still the archive's own record.
          </div>
        )}

        {/* Playback Controls & Scrubber */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              disabled={!playable}
              onClick={togglePlay}
              className="daic-btn w-10 h-10 rounded-full bg-[#d9ac4f] text-[#141c30] flex items-center justify-center font-bold shrink-0 hover:bg-[#b3862c] transition-colors"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
            </button>

            <button
              disabled={!playable}
              onClick={() => seekTo(0)}
              className="daic-chip p-2 rounded-full border border-white/20 text-white/80 hover:text-white"
              title="Restart"
              aria-label="Restart audio"
            >
              <RotateCcw size={14} />
            </button>

            {/* Time progress */}
            <div className="flex-1 flex items-center gap-2">
              <span className="text-xs font-mono text-[#d9ac4f] w-12 text-right">
                {formatSeconds(currentTime)}
              </span>
              <input
                type="range"
                min="0"
                max={duration || 0}
                value={currentTime}
                disabled={!playable}
                onChange={handleSliderChange}
                className="flex-1 accent-[#d9ac4f] cursor-pointer"
                aria-label="Seek audio"
              />
              <span className="text-xs font-mono text-[#b8c6e0] w-12">
                {duration ? formatSeconds(duration) : mediaItem.durationLabel || "--:--"}
              </span>
            </div>

            {/* Mute button */}
            <button
              disabled={!playable}
              onClick={toggleMute}
              className="daic-chip p-2 rounded-full border border-white/20 text-white/80 hover:text-white"
              title={isMuted ? "Unmute" : "Mute"}
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* Synchronized Transcripts Section */}
      {mediaItem.segments && mediaItem.segments.length > 0 && (
        <div className="p-5 md:p-6 bg-[#faf4e4]">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-[#d8c79a]">
            <div className="flex items-center gap-2">
              <Clock size={15} color={GOLD} />
              <h4 className="text-sm font-semibold uppercase tracking-wider text-[#5a4420]" style={{ fontFamily: FONT_UI }}>
                {t.interactiveTranscript || "Interactive Timecoded Transcript"}
              </h4>
            </div>
            <span className="text-[11px] text-[#8a7f63]" style={{ fontFamily: FONT_UI }}>
              {t.clickToSeek || "Click timestamp to seek"}
            </span>
          </div>

          {/* Timecoded segments list */}
          <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
            {mediaItem.segments.map((seg, idx) => {
              const isActive = activeSegmentIndex === idx;
              return (
                <div
                  key={idx}
                  onClick={() => seekTo(seg.startMs / 1000)}
                  className={`p-3.5 rounded-lg border cursor-pointer transition-all duration-200 ${
                    isActive
                      ? "bg-[#efe0bb] border-[#b3862c] shadow-sm transform translate-x-1"
                      : "bg-[#faf7ee] border-[#e6d9b3] hover:border-[#c9b98c]"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <button
                      className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                        isActive
                          ? "bg-[#1c2c4d] text-[#f4ead0]"
                          : "bg-[#e8dcc0] text-[#5a4420]"
                      }`}
                    >
                      {seg.start}
                    </button>
                    {isActive && (
                      <span className="text-[10px] uppercase font-bold tracking-widest text-[#9c3d2e] animate-pulse">
                        ● Playing
                      </span>
                    )}
                  </div>
                  <p
                    className="text-sm md:text-base leading-relaxed"
                    style={{
                      fontFamily: FONT_BODY,
                      color: isActive ? INKTEXT : "#4a4330",
                      fontWeight: isActive ? 500 : 400,
                    }}
                  >
                    {seg.text}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Provenance note */}
      <div className="p-4 bg-[#f4ead0] border-t border-[#d8c79a] text-xs text-[#6b6350]" style={{ fontFamily: FONT_UI }}>
        <p>
          <span className="font-semibold text-[#5a4420]">{t.provenance || "Provenance"}: </span>
          {mediaItem.provenance || mediaItem.source || "Not recorded"}
        </p>
      </div>
    </div>
  );
}

import { useState, useCallback } from "react";
import { Mic, Film, Disc, ChevronRight, AlertOctagon } from "lucide-react";
import AudioPlayer from "../components/heritage/AudioPlayer.jsx";
import VideoPlayer from "../components/heritage/VideoPlayer.jsx";
import AsyncState from "../components/ui/AsyncState.jsx";
import { api } from "../lib/api/endpoints.js";
import { useArchive } from "../lib/api/useArchive.js";
import {
  FONT_DISPLAY, FONT_UI,
  GOLD, INKTEXT,
} from "../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * MediaView — recorded holdings, and an honest account of which of them
 * can actually be played.
 *
 * The archive marks an asset `servable` only when a playable file is really
 * held, and gives a reason when it is not. Both are surfaced: a catalogued
 * recording with no file is still worth listing, and its transcript is
 * still citable, but the interface must not offer a play button that
 * silently does nothing.
 * ---------------------------------------------------------------------- */

export default function MediaView({ t }) {
  const [activeTab, setActiveTab] = useState("all"); // 'all' | 'audio' | 'video'
  const [selectedId, setSelectedId] = useState(null);

  const listFetcher = useCallback(
    (signal) => api.media({ media_type: activeTab === "all" ? undefined : activeTab }, { signal }),
    [activeTab]
  );
  const { data, loading, error, retry } = useArchive(listFetcher, [activeTab]);

  const items = data?.media ?? [];
  const active = items.find((m) => m.id === selectedId) || items[0] || null;
  const activeId = active?.id ?? null;

  /* Segments are a separate request: the list endpoint returns a count, not
     the transcript, and a long recording's transcript is the large part. */
  const segFetcher = useCallback(
    (signal) => (activeId ? api.mediaSegments(activeId, undefined, { signal }) : Promise.resolve(null)),
    [activeId]
  );
  const { data: segData } = useArchive(segFetcher, [activeId]);

  const activeWithSegments = active
    ? { ...active, segments: segData?.segments ?? [] }
    : null;

  return (
    <main id="main-content" className="max-w-5xl mx-auto px-4 sm:px-6 pb-24">
      {/* Header */}
      <div className="pt-12 pb-8 text-center daic-reveal">
        <p className="uppercase text-xs tracking-[0.25em] mb-3" style={{ fontFamily: FONT_UI, color: GOLD }}>
          {t.media || "Audio & Video Archive"}
        </p>
        <h1 className="text-3xl md:text-5xl font-bold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
          Recorded Voices &amp; Archival Reels
        </h1>
        <p className="max-w-xl mx-auto text-sm md:text-base text-[#6b6350] mt-3" style={{ fontFamily: FONT_UI }}>
          Recordings held by the archive, with their timecoded transcripts. Each
          segment is citable by media identifier and timestamp.
        </p>
      </div>

      {/* Format filter */}
      <div className="flex justify-center gap-2 mb-8 flex-wrap">
        {[
          { id: "all", label: t.allMedia || "All Media", icon: <Disc size={13} /> },
          { id: "audio", label: t.audioArchive || "Audio Recordings", icon: <Mic size={13} /> },
          { id: "video", label: t.videoArchive || "Archival Video", icon: <Film size={13} /> },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`daic-chip px-4 py-2 rounded-full border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              activeTab === tab.id
                ? "bg-[#1c2c4d] text-[#f4ead0] border-[#b3862c] shadow-sm"
                : "bg-[#faf4e4] border-[#d8c79a] text-[#5a4420] hover:border-[#b3862c]"
            }`}
            style={{ fontFamily: FONT_UI }}
            aria-pressed={activeTab === tab.id}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <AsyncState
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={retry}
        labels={{
          loading: "Reading the recorded holdings…",
          error: "The media shelf could not be read.",
          empty: activeTab === "all"
            ? "No recordings are held yet."
            : `No ${activeTab} recordings are held yet.`,
        }}
      >
        <>
          {/* Media selector */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            {items.map((item) => {
              const isSelected = active && item.id === active.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  aria-pressed={isSelected}
                  className={`daic-card text-left p-4 rounded-xl border transition-all duration-200 flex flex-col justify-between ${
                    isSelected
                      ? "bg-[#1c2c4d] text-[#f4ead0] border-[#b3862c] shadow-md ring-2 ring-[#b3862c]/50"
                      : "bg-[#faf4e4] border-[#d8c79a] text-[#5a4420] hover:border-[#b3862c]"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-2">
                      <span className="text-[10px] uppercase font-semibold tracking-wider opacity-80 flex items-center gap-1" style={{ fontFamily: FONT_UI }}>
                        {item.type === "audio" ? <Mic size={11} /> : <Film size={11} />}
                        {item.type}
                      </span>
                      {item.durationLabel && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/10">
                          {item.durationLabel}
                        </span>
                      )}
                    </div>
                    <h3 className={`text-sm font-bold mb-1 leading-snug ${isSelected ? "text-[#f4ead0]" : "text-[#141c30]"}`} style={{ fontFamily: FONT_DISPLAY }}>
                      {item.title}
                    </h3>
                    {item.description && (
                      <p className={`text-[11px] line-clamp-2 ${isSelected ? "text-[#b8c6e0]" : "text-[#6b6350]"}`} style={{ fontFamily: FONT_UI }}>
                        {item.description}
                      </p>
                    )}
                  </div>

                  <div className="mt-3 pt-2 border-t border-current/20 flex items-center justify-between text-[10px] gap-2" style={{ fontFamily: FONT_UI }}>
                    {/* Whether it will actually play, said on the card. */}
                    <span className="inline-flex items-center gap-1 truncate">
                      {item.servable
                        ? `${item.segmentCount ?? 0} segments`
                        : <><AlertOctagon size={10} aria-hidden="true" /> Catalogued only</>}
                    </span>
                    <span className="font-semibold inline-flex items-center gap-0.5 shrink-0">
                      {item.servable ? "Play media" : "Open record"}
                      <ChevronRight size={11} className="daic-arrow" aria-hidden="true" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Player */}
          {activeWithSegments && (
            <div className="space-y-6">
              {activeWithSegments.type === "audio" ? (
                <AudioPlayer key={activeWithSegments.id} mediaItem={activeWithSegments} t={t} />
              ) : (
                <VideoPlayer key={activeWithSegments.id} mediaItem={activeWithSegments} t={t} />
              )}
            </div>
          )}
        </>
      </AsyncState>
    </main>
  );
}

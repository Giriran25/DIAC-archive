import { useState } from "react";
import { Film, AlertOctagon, ShieldAlert } from "lucide-react";
import {
  FONT_DISPLAY, FONT_BODY, FONT_UI,
  GOLD, INKTEXT, CREAM
} from "../../lib/tokens.js";

/* ---------------------------------------------------------------------- */
/* VideoPlayer — Documentary-style player with preservation status        */
/* ---------------------------------------------------------------------- */

export default function VideoPlayer({ mediaItem, t }) {
  const [activeSegment, setActiveSegment] = useState(0);

  if (!mediaItem) return null;

  return (
    <div className="daic-reveal rounded-xl border border-[#d8c79a] bg-[#faf4e4] overflow-hidden">
      {/* Header */}
      <div className="p-4 md:p-5 border-b border-[#d8c79a] bg-[#f4ead0] flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Film size={18} color={GOLD} />
          <div>
            <span className="text-[10px] uppercase tracking-wider text-[#8a7f63]" style={{ fontFamily: FONT_UI }}>
              {t.videoArchive || "Archival Video"}
            </span>
            <h3 className="text-lg font-semibold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
              {mediaItem.title}
            </h3>
          </div>
        </div>
        {mediaItem.durationLabel && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-[#efe0bb] text-[#5a4420]" style={{ fontFamily: FONT_UI }}>
            Duration: {mediaItem.durationLabel}
          </span>
        )}
      </div>

      {/* Video Display / Player Area */}
      <div className="bg-[#141c30] p-4 flex items-center justify-center">
        {mediaItem.servable && mediaItem.streamUrl ? (
          <div className="w-full max-w-2xl rounded-lg overflow-hidden border border-[#d8c79a]/30 shadow-lg">
            <video
              controls
              className="w-full max-h-[380px] bg-black object-cover"
              poster="/hero.png"
            >
              <source src={mediaItem.streamUrl} type="video/mp4" />
              Your browser does not support HTML5 video.
            </video>
          </div>
        ) : (
          /* Preservation Holding Notice when servable: false */
          <div className="w-full max-w-lg py-12 px-6 rounded-lg border border-[#c99a3f] bg-[#241f16] text-center text-[#f4ead0]">
            <div className="w-12 h-12 rounded-full bg-[#3d2b1f] border border-[#d9ac4f] flex items-center justify-center mx-auto mb-3">
              <ShieldAlert size={24} color={GOLD} />
            </div>
            <h4 className="text-base font-semibold mb-1" style={{ fontFamily: FONT_DISPLAY, color: CREAM }}>
              Not available for playback
            </h4>
            {/* The reason is the archive’s own. The previous copy invented a
                restoration programme that may not exist for this asset. */}
            <p className="text-xs text-[#b8a98c] max-w-sm mx-auto mb-4" style={{ fontFamily: FONT_UI }}>
              {mediaItem.unservableReason
                || "This recording is catalogued but no playable file is held by the archive."}
            </p>
            <div className="inline-flex items-center gap-1.5 text-[10px] font-mono px-3 py-1 rounded bg-[#352a1a] text-[#d9ac4f] border border-[#c99a3f]/40">
              <AlertOctagon size={11} /> {mediaItem.id}
            </div>
          </div>
        )}
      </div>

      {/* Transcripts or Description */}
      <div className="p-5 md:p-6 bg-[#faf4e4]">
        <p className="text-sm md:text-base text-[#4a4330] mb-4" style={{ fontFamily: FONT_BODY }}>
          {mediaItem.description}
        </p>

        {mediaItem.segments && mediaItem.segments.length > 0 && (
          <div className="space-y-2 mt-4 pt-4 border-t border-[#d8c79a]">
            <h4 className="text-xs uppercase font-semibold text-[#5a4420] tracking-wider mb-2" style={{ fontFamily: FONT_UI }}>
              {t.interactiveTranscript || "Archival Segment Notes"}
            </h4>
            <div className="grid sm:grid-cols-2 gap-2">
              {mediaItem.segments.map((seg, idx) => (
                <div
                  key={idx}
                  onClick={() => setActiveSegment(idx)}
                  className={`p-2.5 rounded border text-xs cursor-pointer transition-colors ${
                    activeSegment === idx
                      ? "bg-[#efe0bb] border-[#b3862c] text-[#141c30]"
                      : "bg-[#faf7ee] border-[#e6d9b3] text-[#5a4420]"
                  }`}
                >
                  <span className="font-mono font-semibold block text-[10px] text-[#8a7f63] mb-0.5">
                    {seg.start}
                  </span>
                  <p style={{ fontFamily: FONT_BODY }}>{seg.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Provenance Footer */}
      <div className="p-4 bg-[#f4ead0] border-t border-[#d8c79a] text-xs text-[#6b6350]" style={{ fontFamily: FONT_UI }}>
        <p>
          <span className="font-semibold text-[#5a4420]">{t.provenance || "Provenance"}: </span>
          {mediaItem.provenance || mediaItem.source || "Not recorded"}
        </p>
      </div>
    </div>
  );
}

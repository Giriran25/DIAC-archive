import { Volume2, Square, Pause, Play, Gauge } from "lucide-react";
import { GOLD, FONT_UI } from "../../lib/tokens.js";

/* Play / pause / stop cluster for read-aloud with speed selector */
export default function ListenControls({ id, sentences, lang, reader, t, compact = false }) {
  if (!reader.supported) return null;
  const active = reader.speakingId === id;
  const size = compact ? 11 : 12;

  const speeds = [0.8, 1.0, 1.2];

  const cycleSpeed = () => {
    const nextIdx = (speeds.indexOf(reader.rate) + 1) % speeds.length;
    reader.setRate(speeds[nextIdx]);
  };

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <button
        onClick={() => reader.speak(id, sentences, lang)}
        className="daic-chip inline-flex items-center gap-1.5 px-3 py-1 rounded-full border transition-colors hover:bg-[#f2e2c6]"
        style={{
          borderColor: active ? GOLD : "#c9b98c",
          backgroundColor: active ? "#f2e2c6" : "transparent",
          color: "#5a4420", fontFamily: FONT_UI,
          fontSize: compact ? 10 : 11,
          fontWeight: 600,
        }}
        aria-label={active ? t.stop : t.listen}
      >
        {active ? <Square size={size} /> : <Volume2 size={size} />}
        {active ? t.stop : t.listen}
      </button>

      {active && (
        <>
          <button
            onClick={reader.togglePause}
            className="daic-chip inline-flex items-center justify-center rounded-full border w-6 h-6 hover:bg-[#f2e2c6]"
            style={{ borderColor: "#c9b98c", color: "#5a4420" }}
            aria-label={reader.paused ? t.resume || "Resume" : t.pause || "Pause"}
          >
            {reader.paused ? <Play size={10} /> : <Pause size={10} />}
          </button>

          <button
            onClick={cycleSpeed}
            className="daic-chip inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full border text-[10px] font-mono hover:bg-[#f2e2c6]"
            style={{ borderColor: "#c9b98c", color: "#5a4420", fontFamily: FONT_UI }}
            aria-label={`Playback speed: ${reader.rate}x`}
          >
            <Gauge size={10} /> {reader.rate}x
          </button>
        </>
      )}
    </span>
  );
}

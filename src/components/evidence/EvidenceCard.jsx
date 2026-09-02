import { Quote, ChevronRight } from "lucide-react";
import { FONT_UI, FONT_BODY, GOLD, INKTEXT, INDIGO } from "../../lib/tokens.js";
import TypeIcon from "../ui/TypeIcon.jsx";

/* Enhanced evidence card — preserves parchment/editorial design.
   Shows source, title, type, page, date, language, relevance,
   verification, provenance. Actions: OPEN SOURCE, READ FULL TEXT. */

export default function EvidenceCard({ ev, t, showRelevance, onOpenSource, onReadArticle }) {
  /* The backend reports confidence only where an engine actually scored the
     text; a clean embedded text layer has none. Rendering the absent case as
     a number invents a measurement — and `Math.round(null * 100)` would have
     printed "NaN% OCR" on every passage read straight from a PDF. */
  const hasConfidence = typeof ev.confidence === "number" && Number.isFinite(ev.confidence);
  const conf = hasConfidence ? Math.round(ev.confidence * 100) : null;
  const confColor = !hasConfidence
    ? "#8a7f63"
    : ev.confidence > 0.8 ? "#2f4a33" : ev.confidence > 0.5 ? "#5a4420" : "#5a2020";

  return (
    <div className="daic-card rounded-lg border bg-[#faf4e4] p-4" style={{ borderColor: "#d8c79a" }}>
      {/* Header: type + relevance + confidence */}
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <span
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full"
          style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}
        >
          <TypeIcon type={ev.kind === "Manuscript" ? "Manuscript" : "Writing"} size={10} /> {ev.kind}
        </span>
        <span className="flex items-center gap-1.5">
          {showRelevance && ev.relevance != null && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full"
              style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}
            >
              {t.relevance} {Math.round(ev.relevance * 100)}%
            </span>
          )}
          <span
            className="text-[10px] px-2 py-0.5 rounded-full text-white"
            style={{ backgroundColor: confColor, fontFamily: FONT_UI }}
            title={hasConfidence
              ? "Confidence reported by the engine that extracted this text"
              : "This text was not produced by a scoring engine, so no confidence exists"}
          >
            {hasConfidence ? `${conf}% OCR` : "Not scored"}
          </span>
        </span>
      </div>

      {/* Date, theme, language if available */}
      {(ev.date || ev.theme) && (
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {ev.date && (
            <span className="text-[10px]" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
              {ev.date}
            </span>
          )}
          {ev.theme && (
            <span className="text-[10px]" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
              · {ev.theme}
            </span>
          )}
        </div>
      )}

      {/* Quote */}
      <div className="flex gap-2 mb-2">
        <Quote size={14} color={GOLD} className="shrink-0 mt-1" />
        <p className="text-sm italic" style={{ fontFamily: FONT_BODY, color: INKTEXT }}>{ev.quote}</p>
      </div>

      {/* Relevance bar */}
      {showRelevance && ev.relevance != null && (
        <div className="mb-2">
          <div className="h-0.5 rounded-full bg-[#e6d9b3] overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.round(ev.relevance * 100)}%`,
                backgroundColor: GOLD,
                transition: "width 400ms ease",
              }}
            />
          </div>
        </div>
      )}

      {/* Citation */}
      <p className="text-[11px] mb-1.5" style={{ fontFamily: FONT_UI, color: "#5a4420", fontWeight: 600 }}>
        {ev.citation}
      </p>

      {/* Provenance */}
      <p className="text-[11px] mb-3" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
        <span className="uppercase tracking-wide">{t.provenance}: </span>{ev.provenance}
      </p>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        {onOpenSource && (
          <button
            onClick={() => onOpenSource(ev)}
            className="daic-btn daic-arrow-parent text-[11px] inline-flex items-center gap-1 hover:underline"
            style={{ fontFamily: FONT_UI, color: INDIGO }}
          >
            {t.openSource} <ChevronRight size={11} className="daic-arrow" />
          </button>
        )}
        {onReadArticle && ev.articleId && (
          <button
            onClick={() => onReadArticle(ev.articleId)}
            className="daic-btn daic-arrow-parent text-[11px] inline-flex items-center gap-1 hover:underline"
            style={{ fontFamily: FONT_UI, color: INDIGO }}
          >
            {ev.articleTitle || t.readFull} <ChevronRight size={11} className="daic-arrow" />
          </button>
        )}
      </div>
    </div>
  );
}

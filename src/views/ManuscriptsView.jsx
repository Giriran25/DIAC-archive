import { useState, useCallback } from "react";
import { ChevronRight, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import ManuscriptViewer from "../components/heritage/ManuscriptViewer.jsx";
import AsyncState from "../components/ui/AsyncState.jsx";
import { api } from "../lib/api/endpoints.js";
import { useArchive } from "../lib/api/useArchive.js";
import {
  FONT_DISPLAY, FONT_UI,
  GOLD, INKTEXT,
} from "../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * ManuscriptsView — the manuscripts the archive actually holds.
 *
 * The card used to carry an "OCR: 94%" figure that was an average of
 * invented per-page scores. The archive records no such aggregate, so the
 * card now shows what it does record: how many leaves are approved and how
 * many are still waiting for a human.
 * ---------------------------------------------------------------------- */

const REVIEW_ICON = {
  approved: <CheckCircle2 size={11} className="text-[#2f4a33]" />,
  in_review: <AlertTriangle size={11} className="text-[#5a4420]" />,
  pending: <Clock size={11} className="text-[#4a3a3a]" />,
};

/** "2 approved · 1 pending" from the backend's own per-status counts. */
function reviewSummary(review = {}) {
  const order = ["approved", "in_review", "pending", "rejected"];
  return order
    .filter((k) => review[k])
    .map((k) => `${review[k]} ${k.replace("_", " ")}`)
    .join(" · ");
}

export default function ManuscriptsView({ t }) {
  const [selectedId, setSelectedId] = useState(null);

  const fetcher = useCallback((signal) => api.manuscripts({ signal }), []);
  const { data, loading, error, retry } = useArchive(fetcher, []);

  const manuscripts = data?.manuscripts ?? [];
  const active = manuscripts.find((m) => m.id === selectedId) || manuscripts[0] || null;

  return (
    <main id="main-content" className="max-w-5xl mx-auto px-4 sm:px-6 pb-24">
      {/* Header */}
      <div className="pt-12 pb-8 text-center daic-reveal">
        <p className="uppercase text-xs tracking-[0.25em] mb-3" style={{ fontFamily: FONT_UI, color: GOLD }}>
          {t.manuscripts || "Manuscript Facsimiles"}
        </p>
        <h1 className="text-3xl md:text-5xl font-bold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
          Original Scans &amp; Verified Transcriptions
        </h1>
        <p className="max-w-xl mx-auto text-sm md:text-base text-[#6b6350] mt-3" style={{ fontFamily: FONT_UI }}>
          Inspect manuscript leaves beside their transcriptions. A transcription
          becomes searchable only once an archivist has approved it.
        </p>
      </div>

      <AsyncState
        loading={loading}
        error={error}
        empty={manuscripts.length === 0}
        onRetry={retry}
        labels={{
          loading: "Opening the manuscript shelf…",
          error: "The manuscript shelf could not be read.",
          empty: "No manuscripts have been digitised yet.",
        }}
      >
        <>
          {/* Manuscript selection */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
            {manuscripts.map((ms) => {
              const isSelected = active && ms.id === active.id;
              const summary = reviewSummary(ms.review);
              const dominant = ms.review?.approved ? "approved"
                : ms.review?.in_review ? "in_review" : "pending";
              return (
                <button
                  key={ms.id}
                  onClick={() => setSelectedId(ms.id)}
                  aria-pressed={isSelected}
                  className={`daic-card min-w-0 w-full text-left p-5 rounded-xl border transition-all duration-200 flex flex-col justify-between ${
                    isSelected
                      ? "bg-[#1c2c4d] text-[#f4ead0] border-[#b3862c] shadow-md ring-2 ring-[#b3862c]/50"
                      : "bg-[#faf4e4] border-[#d8c79a] text-[#5a4420] hover:border-[#b3862c]"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] uppercase font-semibold tracking-wider opacity-80" style={{ fontFamily: FONT_UI }}>
                        {ms.pageCount != null ? `${ms.pageCount} pages` : "Page count unknown"}
                      </span>
                      {summary && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-bold flex items-center gap-1 ${
                          isSelected ? "bg-white/20 text-white" : "bg-[#efe0bb] text-[#5a4420]"
                        }`}>
                          {REVIEW_ICON[dominant]} {summary}
                        </span>
                      )}
                    </div>
                    <h3
                      className={`text-base font-bold mb-1.5 leading-snug ${isSelected ? "text-[#f4ead0]" : "text-[#141c30]"}`}
                      style={{ fontFamily: FONT_DISPLAY }}
                    >
                      {ms.title}
                    </h3>
                    {ms.description && (
                      <p className={`text-xs line-clamp-2 ${isSelected ? "text-[#b8c6e0]" : "text-[#6b6350]"}`} style={{ fontFamily: FONT_UI }}>
                        {ms.description}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-current/20 flex items-center justify-between text-[11px]" style={{ fontFamily: FONT_UI }}>
                    <span className="truncate">{ms.collection || ms.source || "Provenance not recorded"}</span>
                    <span className="font-semibold inline-flex items-center gap-1 shrink-0">
                      Inspect leaves <ChevronRight size={12} className="daic-arrow" aria-hidden="true" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {active && <ManuscriptViewer key={active.id} manuscript={active} t={t} />}
        </>
      </AsyncState>
    </main>
  );
}

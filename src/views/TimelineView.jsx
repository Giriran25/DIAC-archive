import { useState, useMemo, useCallback } from "react";
import { ChevronRight, MapPin, Tag, Quote } from "lucide-react";
import ListenControls from "../components/ui/ListenControls.jsx";
import AsyncState from "../components/ui/AsyncState.jsx";
import { splitSentences } from "../lib/retrieval.js";
import { api } from "../lib/api/endpoints.js";
import { useArchive } from "../lib/api/useArchive.js";
import { FONT_DISPLAY, FONT_BODY, FONT_UI, GOLD, INKTEXT, PARCH } from "../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * TimelineView — dated events, each answerable to the passages under it.
 *
 * The track used to be a hardcoded list in the translation file, which meant
 * the chronology could drift from the archive without anyone noticing. Events
 * now come from the archive, and opening one shows the passages it rests on,
 * with volume and printed page — so a date on this page can be checked.
 * ---------------------------------------------------------------------- */

export default function TimelineView({ t, reader, lang, openArticle }) {
  const [activeId, setActiveId] = useState(null);

  const listFetcher = useCallback((signal) => api.timeline(undefined, { signal }), []);
  const { data, loading, error, retry } = useArchive(listFetcher, []);

  const events = useMemo(() => data?.events ?? [], [data]);
  const currentId = activeId ?? events[0]?.id ?? null;

  const detailFetcher = useCallback(
    (signal) => (currentId ? api.timelineEvent(currentId, { signal }) : Promise.resolve(null)),
    [currentId]
  );
  const { data: detail, loading: detailLoading, error: detailError, retry: retryDetail } =
    useArchive(detailFetcher, [currentId]);

  const entry = detail?.event ?? null;
  const sources = detail?.sources ?? [];

  const sentences = useMemo(
    () => (entry ? [entry.title, ...splitSentences(entry.detail || entry.summary || "")] : []),
    [entry]
  );

  return (
    <main id="main-content" className="max-w-5xl mx-auto px-4 sm:px-6 pb-20">
      <div className="pt-12 pb-8 text-center daic-reveal">
        <p className="uppercase text-xs tracking-[0.25em] mb-3" style={{ fontFamily: FONT_UI, color: GOLD }}>
          Interactive timeline
        </p>
        <h2 className="text-3xl md:text-4xl" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
          A life read across formats
        </h2>
        <p className="max-w-xl mx-auto text-sm text-[#6b6350] mt-2" style={{ fontFamily: FONT_UI }}>
          Milestones, declarations and speeches, each shown with the archival
          passages that record it.
        </p>
      </div>

      <AsyncState
        loading={loading}
        error={error}
        empty={events.length === 0}
        onRetry={retry}
        labels={{
          loading: "Reading the chronology…",
          error: "The timeline could not be read.",
          empty: "No dated events have been recorded in the archive yet.",
        }}
      >
        <>
          {/* Timeline track */}
          <div className="relative mb-12 overflow-x-auto" aria-label="Interactive timeline track">
            <div className="min-w-[620px] px-4">
              <div className="absolute left-4 right-4 top-5 h-px" style={{ backgroundColor: "#c9b98c" }} />
              <div className="flex justify-between relative">
                {events.map((e) => {
                  const isSelected = e.id === currentId;
                  return (
                    <button
                      key={e.id}
                      onClick={() => setActiveId(e.id)}
                      className="flex flex-col items-center gap-2 group transition-all duration-200"
                      style={{ width: `${100 / events.length}%` }}
                      aria-label={`${e.year} — ${e.title}`}
                      aria-current={isSelected ? "true" : undefined}
                    >
                      <span
                        className={`w-4 h-4 rounded-full border-2 daic-dot z-10 transition-all duration-200 ${
                          isSelected
                            ? "daic-dot-active ring-4 ring-[#b3862c]/30 scale-125"
                            : "group-hover:scale-110 group-hover:border-[#b3862c]"
                        }`}
                        style={{
                          backgroundColor: isSelected ? GOLD : PARCH,
                          borderColor: isSelected ? GOLD : "#c9b98c",
                        }}
                      />
                      <span
                        className={`text-[11px] text-center leading-tight transition-colors ${
                          isSelected ? "font-bold text-[#141c30]" : "text-[#8a7f63] group-hover:text-[#141c30]"
                        }`}
                        style={{ fontFamily: FONT_UI }}
                      >
                        {e.year}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Active entry */}
          <div className="daic-reveal rounded-xl border border-[#d8c79a] bg-[#faf4e4] p-7 md:p-9 shadow-sm" key={currentId}>
            <AsyncState
              loading={detailLoading}
              error={detailError}
              onRetry={retryDetail}
              labels={{ loading: "Opening the record…", error: "That event could not be opened." }}
            >
              {entry && (
                <>
                  <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      {entry.category && (
                        <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}>
                          <Tag size={10} className="inline mr-1" aria-hidden="true" /> {entry.category}
                        </span>
                      )}
                      <span className="text-xs font-semibold" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                        {entry.date || entry.year}
                      </span>
                      {entry.location && (
                        <span className="text-xs inline-flex items-center gap-1 text-[#6b6350]" style={{ fontFamily: FONT_UI }}>
                          <MapPin size={11} color={GOLD} aria-hidden="true" /> {entry.location}
                        </span>
                      )}
                    </div>
                    <ListenControls id={`tl:${entry.id}`} sentences={sentences} lang={lang} reader={reader} t={t} compact />
                  </div>

                  <h3 className="text-2xl md:text-3xl mb-3 font-bold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
                    {entry.title}
                  </h3>
                  <p className="text-base md:text-lg mb-6 max-w-2xl leading-relaxed" style={{ fontFamily: FONT_BODY, color: "#4a4330" }}>
                    {entry.detail || entry.summary}
                  </p>

                  {/* The passages the event rests on. Without these the date is
                      just an assertion; with them it is a citation. */}
                  {sources.length > 0 ? (
                    <div className="pt-5 border-t border-[#d8c79a]">
                      <h4 className="text-xs uppercase font-bold tracking-wider text-[#5a4420] mb-3" style={{ fontFamily: FONT_UI }}>
                        Archival sources ({sources.length})
                      </h4>
                      <div className="space-y-2.5">
                        {sources.map((s) => (
                          <button
                            key={s.uid}
                            onClick={() => openArticle?.(s.documentId)}
                            className="daic-card daic-arrow-parent w-full text-left p-4 rounded-lg border border-[#d8c79a] bg-white hover:border-[#b3862c]"
                          >
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap text-[11px]" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                              <Quote size={11} color={GOLD} aria-hidden="true" />
                              <span className="font-semibold text-[#5a4420]">{s.documentTitle}</span>
                              {s.volume && <span>· {s.volume}</span>}
                              {s.page != null && <span>· p. {s.page}</span>}
                              <ChevronRight size={11} className="daic-arrow ml-auto" aria-hidden="true" />
                            </div>
                            <p className="text-sm italic" style={{ fontFamily: FONT_BODY, color: INKTEXT }}>
                              {s.excerpt}
                            </p>
                            {s.note && (
                              <p className="mt-1.5 text-[11px]" style={{ fontFamily: FONT_UI, color: "#6f6549" }}>
                                {s.note}
                              </p>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="pt-5 border-t border-[#d8c79a] text-xs" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                      No archival passage has been linked to this event yet.
                    </p>
                  )}
                </>
              )}
            </AsyncState>
          </div>
        </>
      </AsyncState>
    </main>
  );
}

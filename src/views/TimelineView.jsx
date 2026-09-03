import { useState, useMemo, useCallback } from "react";
import { ChevronRight, MapPin, Tag, Quote } from "lucide-react";
import ListenControls from "../components/ui/ListenControls.jsx";
import AsyncState from "../components/ui/AsyncState.jsx";
import { splitSentences } from "../lib/retrieval.js";
import { api } from "../lib/api/endpoints.js";
import { useArchive } from "../lib/api/useArchive.js";
import { eventHeading } from "../lib/text.js";
import { pageTitle, archivalBody, eyebrow, meta, provenance } from "../lib/type.js";
import { FONT_UI, GOLD, INKTEXT } from "../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * TimelineView — dated events, each answerable to the passages under it.
 *
 * The track used to be a hardcoded list in the translation file, which meant
 * the chronology could drift from the archive without anyone noticing. Events
 * now come from the archive, and opening one shows the passages it rests on,
 * with volume and printed page — so a date on this page can be checked.
 *
 * The events are plate captions, and some of them are OCR fragments: "Dr",
 * "V", "R O L L -C A L L O P T H E". Set at heading size those took over the
 * page and told a reader nothing. The hierarchy is therefore DATE first,
 * then the caption at reading size, then context, then source — and a
 * caption that cannot carry a heading is not made to. No caption text is
 * altered; only its role on the page changes.
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
  const { heading, caption, captionIsPrimary } = eventHeading(entry || {});

  const sentences = useMemo(
    () => (entry ? [heading, ...splitSentences(entry.detail || entry.summary || "")] : []),
    [entry, heading]
  );

  return (
    <main id="main-content" className="max-w-5xl mx-auto px-4 sm:px-6 pb-20">
      <div className="pt-12 pb-8 text-center daic-reveal">
        <p className="mb-3" style={{ ...eyebrow, color: GOLD }}>
          Interactive timeline
        </p>
        <h1 className="text-3xl md:text-4xl" style={pageTitle}>
          A life read across formats
        </h1>
        <p className="max-w-xl mx-auto mt-3 text-sm" style={{ ...provenance, color: "#6b6350" }}>
          Milestones, declarations and photographic plates, each shown with the
          archival passages that record it.
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
          {/* ---- The track ------------------------------------------------
              Scrolls inside itself on narrow screens so the page never
              scrolls sideways; the rail and the nodes share one grid so the
              dots always sit on the line. */}
          <div className="daic-timeline mb-10" aria-label="Timeline of events">
            <div className="daic-timeline-track">
              <span className="daic-timeline-rail" aria-hidden="true" />
              {events.map((e) => {
                const isSelected = e.id === currentId;
                const label = `${e.year}${e.title ? ` — ${e.title}` : ""}`;
                return (
                  <button
                    key={e.id}
                    onClick={() => setActiveId(e.id)}
                    className={`daic-timeline-node${isSelected ? " is-selected" : ""}`}
                    aria-label={label}
                    aria-current={isSelected ? "true" : undefined}
                  >
                    <span className="daic-timeline-dot" aria-hidden="true" />
                    <span className="daic-timeline-year" style={{ fontFamily: FONT_UI }}>
                      {e.year}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---- The selected event -------------------------------------- */}
          <div className="daic-reveal rounded-xl border border-[#d8c79a] bg-[#faf4e4] p-6 md:p-8 shadow-sm" key={currentId}>
            <AsyncState
              loading={detailLoading}
              error={detailError}
              onRetry={retryDetail}
              labels={{ loading: "Opening the record…", error: "That event could not be opened." }}
            >
              {entry && (
                <>
                  {/* DATE and context first */}
                  <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      {entry.category && (
                        <span
                          className="px-2.5 py-1 rounded-full inline-flex items-center gap-1"
                          style={{ ...meta, backgroundColor: "#efe0bb", color: "#5a4420", fontWeight: 600 }}
                        >
                          <Tag size={10} aria-hidden="true" /> {entry.category}
                        </span>
                      )}
                      {!captionIsPrimary && (
                        <span style={{ ...meta, fontWeight: 600 }}>{entry.date || entry.year}</span>
                      )}
                      {entry.location && (
                        <span className="inline-flex items-center gap-1" style={meta}>
                          <MapPin size={11} color={GOLD} aria-hidden="true" /> {entry.location}
                        </span>
                      )}
                    </div>
                    <ListenControls id={`tl:${entry.id}`} sentences={sentences} lang={lang} reader={reader} t={t} compact />
                  </div>

                  {/* EVENT TITLE — the year leads when the caption cannot */}
                  <h2 className="text-2xl md:text-3xl mb-3" style={pageTitle}>
                    {heading}
                  </h2>

                  {caption && (
                    <p className="mb-3 text-base" style={archivalBody}>
                      <span style={{ ...meta, marginRight: "0.4em" }}>Plate caption:</span>
                      {caption}
                    </p>
                  )}

                  {/* CONTEXT */}
                  {!captionIsPrimary && (entry.detail || entry.summary) && (
                    <p className="text-base md:text-lg mb-6 max-w-2xl" style={archivalBody}>
                      {entry.detail || entry.summary}
                    </p>
                  )}

                  {/* SOURCE */}
                  {sources.length > 0 ? (
                    <div className="pt-5 border-t border-[#d8c79a]">
                      <h3 className="mb-3" style={{ ...eyebrow, color: "#5a4420", letterSpacing: "0.18em" }}>
                        Archival sources ({sources.length})
                      </h3>
                      <div className="space-y-2.5">
                        {sources.map((s) => (
                          <button
                            key={s.uid}
                            onClick={() => openArticle?.(s.documentId)}
                            className="daic-card daic-arrow-parent w-full min-w-0 text-left p-4 rounded-lg border border-[#d8c79a] bg-white hover:border-[#b3862c]"
                          >
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap" style={provenance}>
                              <Quote size={11} color={GOLD} aria-hidden="true" />
                              <span className="font-semibold text-[#5a4420]">{s.documentTitle}</span>
                              {s.volume && <span>· {s.volume}</span>}
                              {s.page != null && <span>· p. {s.page}</span>}
                              <ChevronRight size={11} className="daic-arrow ml-auto" aria-hidden="true" />
                            </div>
                            <p className="text-sm italic" style={{ ...archivalBody, color: INKTEXT }}>
                              {s.excerpt}
                            </p>
                            {s.note && (
                              <p className="mt-1.5" style={provenance}>{s.note}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="pt-5 border-t border-[#d8c79a]" style={provenance}>
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

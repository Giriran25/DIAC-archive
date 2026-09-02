import { useState, useCallback } from "react";
import {
  Quote, ChevronRight, MapPin, Calendar, ArrowLeft, ShieldCheck,
} from "lucide-react";
import AsyncState from "../components/ui/AsyncState.jsx";
import { api } from "../lib/api/endpoints.js";
import { useArchive } from "../lib/api/useArchive.js";
import {
  FONT_DISPLAY, FONT_BODY, FONT_UI,
  GOLD, INKTEXT,
} from "../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * StoriesView — landmark episodes, told only as far as the sources go.
 *
 * This screen used to render authored "chapters" with pull-quotes attributed
 * to Ambedkar that no holding in this archive supports. Nothing here is
 * written by the interface any more: the narrative is the archive's own
 * event record, and every quotation below it is a passage the archive holds,
 * shown with the document it came from. Where the archive has linked no
 * passage, the screen says so rather than filling the space.
 *
 * The archive has no "stories" collection; /api/stories does not exist. The
 * timeline event IS the story record — the backend documents it as carrying
 * the narrative and the passages it rests on.
 * ---------------------------------------------------------------------- */

export default function StoriesView({ t, openArticle }) {
  const [selectedId, setSelectedId] = useState(null);
  const [sourceIndex, setSourceIndex] = useState(0);

  const listFetcher = useCallback((signal) => api.timeline(undefined, { signal }), []);
  const { data, loading, error, retry } = useArchive(listFetcher, []);

  /* An episode worth telling is one the archive can actually evidence. */
  const stories = (data?.events ?? []).filter((e) => (e.sourceCount ?? 0) > 0);
  const currentId = selectedId ?? stories[0]?.id ?? null;

  const detailFetcher = useCallback(
    (signal) => (currentId ? api.timelineEvent(currentId, { signal }) : Promise.resolve(null)),
    [currentId]
  );
  const { data: detail, loading: detailLoading, error: detailError, retry: retryDetail } =
    useArchive(detailFetcher, [currentId]);

  const story = detail?.event ?? null;
  const sources = detail?.sources ?? [];
  const source = sources[Math.min(sourceIndex, Math.max(0, sources.length - 1))] || null;

  const select = (id) => {
    setSelectedId(id);
    setSourceIndex(0);
  };

  return (
    <main id="main-content" className="max-w-5xl mx-auto px-4 sm:px-6 pb-24">
      {/* Header */}
      <div className="pt-12 pb-8 text-center daic-reveal">
        <p className="uppercase text-xs tracking-[0.25em] mb-3" style={{ fontFamily: FONT_UI, color: GOLD }}>
          {t.storyWalkthrough || "Memorial Storytelling"}
        </p>
        <h1 className="text-3xl md:text-5xl font-bold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
          Oral Histories &amp; Landmark Narratives
        </h1>
        <p className="max-w-xl mx-auto text-sm md:text-base text-[#6b6350] mt-3" style={{ fontFamily: FONT_UI }}>
          Turning points told through the archive&rsquo;s own record, read beside the
          passages that document them.
        </p>
      </div>

      <AsyncState
        loading={loading}
        error={error}
        empty={stories.length === 0}
        onRetry={retry}
        labels={{
          loading: "Gathering the episodes…",
          error: "The episodes could not be read.",
          empty: "No episode in the archive has archival passages linked to it yet.",
          emptyHint: "An event appears here once an archivist has linked the sources that record it.",
        }}
      >
        <>
          {/* Episode selector */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
            {stories.map((s) => {
              const isSelected = s.id === currentId;
              return (
                <button
                  key={s.id}
                  onClick={() => select(s.id)}
                  aria-pressed={isSelected}
                  className={`daic-card text-left p-5 rounded-xl border transition-all duration-200 flex flex-col justify-between ${
                    isSelected
                      ? "bg-[#1c2c4d] text-[#f4ead0] border-[#b3862c] shadow-md ring-2 ring-[#b3862c]/50"
                      : "bg-[#faf4e4] border-[#d8c79a] text-[#5a4420] hover:border-[#b3862c]"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1.5 text-[10px] uppercase font-semibold tracking-wider mb-2 opacity-80" style={{ fontFamily: FONT_UI }}>
                      <Calendar size={11} aria-hidden="true" /> {s.date || s.year}
                    </div>
                    <h3 className={`text-lg font-bold mb-1.5 leading-snug ${isSelected ? "text-[#f4ead0]" : "text-[#141c30]"}`} style={{ fontFamily: FONT_DISPLAY }}>
                      {s.title}
                    </h3>
                    <p className={`text-xs line-clamp-2 ${isSelected ? "text-[#b8c6e0]" : "text-[#6b6350]"}`} style={{ fontFamily: FONT_UI }}>
                      {s.summary}
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-current/20 flex items-center justify-between text-[11px]" style={{ fontFamily: FONT_UI }}>
                    <span>{s.sourceCount} sourced passage{s.sourceCount === 1 ? "" : "s"}</span>
                    <span className="font-semibold inline-flex items-center gap-1">
                      Read story <ChevronRight size={12} className="daic-arrow" aria-hidden="true" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* The episode */}
          <article className="daic-reveal rounded-2xl border border-[#d8c79a] bg-[#faf4e4] overflow-hidden shadow-sm">
            <AsyncState
              loading={detailLoading}
              error={detailError}
              onRetry={retryDetail}
              labels={{ loading: "Opening the episode…", error: "That episode could not be opened." }}
            >
              {story && (
                <>
                  {/* Banner */}
                  <div className="p-7 md:p-10 border-b border-[#d8c79a] bg-[#f4ead0]">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {story.category && (
                        <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#efe0bb] text-[#5a4420] font-semibold uppercase tracking-wider" style={{ fontFamily: FONT_UI }}>
                          {story.category}
                        </span>
                      )}
                      {story.location && (
                        <span className="text-xs text-[#8a7f63] inline-flex items-center gap-1" style={{ fontFamily: FONT_UI }}>
                          <MapPin size={11} color={GOLD} aria-hidden="true" /> {story.location}
                        </span>
                      )}
                    </div>
                    <h2 className="text-2xl md:text-4xl font-bold mb-2" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
                      {story.title}
                    </h2>
                    <p className="text-base md:text-lg text-[#4a4330] max-w-3xl leading-relaxed" style={{ fontFamily: FONT_BODY }}>
                      {story.detail || story.summary}
                    </p>
                  </div>

                  {/* Passage navigation — one tab per real source */}
                  {sources.length > 0 && (
                    <div className="flex border-b border-[#d8c79a] bg-[#ede2c8] overflow-x-auto px-4" role="tablist" aria-label="Archival passages">
                      {sources.map((s, idx) => (
                        <button
                          key={s.uid}
                          role="tab"
                          aria-selected={sourceIndex === idx}
                          onClick={() => setSourceIndex(idx)}
                          className={`daic-chip py-3 px-4 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                            sourceIndex === idx
                              ? "border-[#b3862c] text-[#141c30] bg-[#faf4e4]"
                              : "border-transparent text-[#6b6350] hover:text-[#141c30]"
                          }`}
                          style={{ fontFamily: FONT_UI }}
                        >
                          {t.passage || "Passage"} {idx + 1}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* The passage itself */}
                  {source ? (
                    <div className="p-7 md:p-10 space-y-6 daic-reveal" key={source.uid}>
                      <div>
                        <span className="text-xs font-bold uppercase tracking-widest text-[#9c3d2e] block mb-1" style={{ fontFamily: FONT_UI }}>
                          {t.passage || "Passage"} {sourceIndex + 1}
                        </span>
                        <h3 className="text-xl md:text-2xl font-bold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
                          {source.documentTitle}
                        </h3>
                        <p className="text-xs mt-1" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                          {[source.volume, source.section, source.page != null ? `p. ${source.page}` : null]
                            .filter(Boolean).join(" · ") || "Location in volume not recorded"}
                        </p>
                      </div>

                      {/* Quoted verbatim, with its document named. No quotation
                          appears here that the archive does not hold. */}
                      <div className="my-4 p-6 rounded-xl border border-[#d8c79a] bg-[#f9f3e3]">
                        <Quote size={24} color={GOLD} className="mb-2 opacity-60" aria-hidden="true" />
                        <p className="font-serif italic text-lg md:text-xl text-[#241f16] leading-relaxed mb-3">
                          {source.excerpt}
                        </p>
                        <p className="text-xs uppercase tracking-wider font-semibold text-[#5a4420]" style={{ fontFamily: FONT_UI }}>
                          — {source.documentTitle}
                          {source.page != null ? `, p. ${source.page}` : ""}
                        </p>
                      </div>

                      {source.note && (
                        <p className="text-xs p-3 rounded-lg bg-[#efe0bb]" style={{ fontFamily: FONT_UI, color: "#5a4420" }}>
                          <span className="font-semibold">Archivist note: </span>{source.note}
                        </p>
                      )}

                      <button
                        onClick={() => openArticle?.(source.documentId)}
                        className="daic-btn daic-arrow-parent text-xs font-semibold px-4 py-2 rounded-full border border-[#c9b98c] bg-[#1c2c4d] text-white inline-flex items-center gap-1.5"
                        style={{ fontFamily: FONT_UI }}
                      >
                        <ShieldCheck size={12} aria-hidden="true" /> Open this document
                        <ChevronRight size={12} className="daic-arrow" aria-hidden="true" />
                      </button>

                      {/* Passage stepper */}
                      <div className="flex items-center justify-between pt-6 border-t border-[#d8c79a]">
                        <button
                          onClick={() => setSourceIndex((i) => Math.max(0, i - 1))}
                          disabled={sourceIndex <= 0}
                          className="daic-btn text-xs font-semibold px-4 py-2 rounded-full border border-[#c9b98c] bg-[#faf4e4] text-[#5a4420] disabled:opacity-30 inline-flex items-center gap-1"
                          style={{ fontFamily: FONT_UI }}
                        >
                          <ArrowLeft size={12} aria-hidden="true" /> Previous passage
                        </button>

                        <span className="text-xs text-[#8a7f63]" style={{ fontFamily: FONT_UI }}>
                          {sourceIndex + 1} of {sources.length}
                        </span>

                        <button
                          onClick={() => setSourceIndex((i) => Math.min(sources.length - 1, i + 1))}
                          disabled={sourceIndex >= sources.length - 1}
                          className="daic-btn text-xs font-semibold px-4 py-2 rounded-full border border-[#c9b98c] bg-[#1c2c4d] text-white disabled:opacity-30 inline-flex items-center gap-1"
                          style={{ fontFamily: FONT_UI }}
                        >
                          Next passage <ChevronRight size={12} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-7 md:p-10">
                      <p className="text-sm" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                        No archival passage has been linked to this episode yet, so
                        there is nothing here that could be quoted.
                      </p>
                    </div>
                  )}
                </>
              )}
            </AsyncState>
          </article>
        </>
      </AsyncState>
    </main>
  );
}

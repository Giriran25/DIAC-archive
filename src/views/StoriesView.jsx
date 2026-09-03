import { useState, useCallback } from "react";
import {
  Quote, ChevronRight, MapPin, Calendar, ArrowLeft, ShieldCheck,
} from "lucide-react";
import AsyncState from "../components/ui/AsyncState.jsx";
import { api } from "../lib/api/endpoints.js";
import { useArchive } from "../lib/api/useArchive.js";
import { eventHeading, shorten } from "../lib/text.js";
import {
  pageTitle, itemTitle, archivalBody, eyebrow, meta, provenance,
  CARD_CLASS, CARD_SELECTED_CLASS, CARD_PAD, clampLines,
} from "../lib/type.js";
import { FONT_UI, GOLD, INKTEXT } from "../lib/tokens.js";

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

  const { heading: storyHeading, caption: storyCaption } = eventHeading(story || {});
  const storyDate = story ? (story.date || story.year) : "";

  const select = (id) => {
    setSelectedId(id);
    setSourceIndex(0);
  };

  return (
    <main id="main-content" className="max-w-5xl mx-auto px-4 sm:px-6 pb-24">
      {/* Header */}
      <div className="pt-12 pb-8 text-center daic-reveal">
        <p className="mb-3" style={{ ...eyebrow, color: GOLD }}>
          {t.storyWalkthrough || "Memorial Storytelling"}
        </p>
        <h1 className="text-3xl md:text-4xl" style={pageTitle}>
          Oral Histories &amp; Landmark Narratives
        </h1>
        <p className="max-w-xl mx-auto mt-3 text-sm" style={{ ...provenance, color: "#6b6350" }}>
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
              /* Plate captions are not all usable as titles. When one is
                 not, the date leads and the caption sits beneath it at
                 reading size — the text is unchanged, only its role is. */
              const { heading, caption } = eventHeading(s);
              return (
                <button
                  key={s.id}
                  onClick={() => select(s.id)}
                  aria-pressed={isSelected}
                  className={`${isSelected ? CARD_SELECTED_CLASS : CARD_CLASS} ${CARD_PAD} text-left flex flex-col justify-between gap-4`}
                >
                  <div className="min-w-0">
                    <div
                      className="flex items-center gap-1.5 mb-2"
                      style={{ ...meta, color: isSelected ? "#d9ac4f" : undefined,
                               textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600 }}
                    >
                      <Calendar size={11} aria-hidden="true" /> {s.date || s.year}
                    </div>

                    <h3
                      className="mb-1.5 text-base"
                      style={{ ...itemTitle, color: isSelected ? "#f4ead0" : INKTEXT, ...clampLines(2) }}
                    >
                      {heading}
                    </h3>

                    {caption && (
                      <p
                        className="text-xs"
                        style={{ ...archivalBody, color: isSelected ? "#b8c6e0" : "#6b6350",
                                 lineHeight: 1.5, ...clampLines(2) }}
                      >
                        {shorten(caption, 120)}
                      </p>
                    )}
                  </div>

                  <div
                    className="pt-3 border-t border-current/20 flex items-center justify-between gap-2"
                    style={{ ...meta, color: isSelected ? "#b8c6e0" : undefined }}
                  >
                    <span className="truncate">
                      {s.sourceCount} sourced passage{s.sourceCount === 1 ? "" : "s"}
                    </span>
                    <span className="font-semibold inline-flex items-center gap-1 shrink-0">
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
                        <span
                          className="px-2.5 py-0.5 rounded-full bg-[#efe0bb] text-[#5a4420]"
                          style={{ ...meta, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600 }}
                        >
                          {story.category}
                        </span>
                      )}
                      <span style={{ ...meta, fontWeight: 600 }}>{storyDate}</span>
                      {story.location && (
                        <span className="inline-flex items-center gap-1" style={meta}>
                          <MapPin size={11} color={GOLD} aria-hidden="true" /> {story.location}
                        </span>
                      )}
                    </div>

                    {/* The date leads when the plate caption cannot carry a
                        heading. A caption is never enlarged into a title it
                        was not written to be. */}
                    <h2 className="text-2xl md:text-3xl mb-2" style={pageTitle}>
                      {storyHeading}
                    </h2>

                    {storyCaption && (
                      <p className="max-w-3xl text-base" style={archivalBody}>
                        <span style={{ ...meta, marginRight: "0.4em" }}>Plate caption:</span>
                        {storyCaption}
                      </p>
                    )}

                    {!storyCaption && (story.detail || story.summary) && (
                      <p className="max-w-3xl text-base md:text-lg" style={archivalBody}>
                        {story.detail || story.summary}
                      </p>
                    )}
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
                        <h3 className="text-lg md:text-xl" style={itemTitle}>
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

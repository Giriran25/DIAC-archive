import { useState, useCallback } from "react";
import {
  Network, ArrowRight, BookOpen, Scale,
  Milestone, Sparkles, ScrollText, ChevronRight, Quote,
} from "lucide-react";
import AsyncState from "../ui/AsyncState.jsx";
import { api } from "../../lib/api/endpoints.js";
import { useArchive } from "../../lib/api/useArchive.js";
import {
  FONT_DISPLAY, FONT_BODY, FONT_UI,
  GOLD, INKTEXT,
} from "../../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * KnowledgeMap — relationships the archive can actually justify.
 *
 * A connection here is co-occurrence in real passages, and the archive
 * returns the count as the reason, so the interface says WHY two things are
 * related instead of asserting an authored relation ("influenced", "led to")
 * that no source underwrites. The passages themselves are shown beneath,
 * with document and page, so a claim can be followed to its page.
 * ---------------------------------------------------------------------- */

const KIND_ICONS = {
  person: <ScrollText size={13} />,
  place: <Milestone size={13} />,
  organisation: <Scale size={13} />,
  work: <BookOpen size={13} />,
  concept: <Sparkles size={13} />,
  event: <Milestone size={13} />,
};

export default function KnowledgeMap({ t, openArticle }) {
  const [selectedId, setSelectedId] = useState(null);

  const listFetcher = useCallback((signal) => api.entities(undefined, { signal }), []);
  const { data: list, loading, error, retry } = useArchive(listFetcher, []);

  const entities = list?.entities ?? [];
  const activeId = selectedId ?? entities[0]?.id ?? null;

  const detailFetcher = useCallback(
    (signal) => (activeId == null
      ? Promise.resolve(null)
      : Promise.all([
          api.entity(activeId, { signal }),
          api.entityRelated(activeId, { signal }),
        ]).then(([detail, related]) => ({ detail, related }))),
    [activeId]
  );
  const { data: detailData, loading: detailLoading, error: detailError, retry: retryDetail } =
    useArchive(detailFetcher, [activeId]);

  const entity = detailData?.detail?.entity ?? null;
  const mentions = detailData?.detail?.mentions ?? [];
  const relatedEntities = detailData?.related?.related ?? [];

  return (
    <div className="daic-reveal space-y-6">
      {/* Entity selector */}
      <div className="p-5 md:p-6 rounded-xl border border-[#d8c79a] bg-[#faf4e4]">
        <div className="flex items-center gap-2 mb-4">
          <Network size={18} color={GOLD} aria-hidden="true" />
          <h3 className="text-base md:text-lg font-semibold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
            {t.knowledgeExplorer || "Knowledge Graph & Conceptual Relationships"}
          </h3>
        </div>
        <p className="text-xs text-[#6b6350] mb-5" style={{ fontFamily: FONT_UI }}>
          {t.selectNodeToExplore
            || "Select a name, place or work to see the passages it appears in, and what else appears alongside it."}
        </p>

        <AsyncState
          loading={loading}
          error={error}
          empty={entities.length === 0}
          onRetry={retry}
          labels={{
            loading: "Reading the index of names…",
            error: "The knowledge index could not be read.",
            empty: "No entities have been extracted from the archive yet.",
          }}
        >
          <div className="flex flex-wrap gap-2.5">
            {entities.map((ent) => {
              const isSelected = ent.id === activeId;
              return (
                <button
                  key={ent.id}
                  onClick={() => setSelectedId(ent.id)}
                  className={`daic-chip px-3.5 py-2 rounded-full border text-xs flex items-center gap-2 transition-all duration-200 ${
                    isSelected
                      ? "bg-[#1c2c4d] text-[#f4ead0] border-[#b3862c] shadow-md ring-2 ring-[#b3862c]/50"
                      : "bg-[#faf4e4] border-[#c9b98c] text-[#5a4420] hover:border-[#b3862c]"
                  }`}
                  style={{ fontFamily: FONT_UI }}
                  aria-pressed={isSelected}
                >
                  <span className={isSelected ? "text-[#d9ac4f]" : "text-[#b3862c]"} aria-hidden="true">
                    {KIND_ICONS[ent.kind] || <Sparkles size={12} />}
                  </span>
                  <span className="font-medium">{ent.name}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full uppercase ${
                    isSelected ? "bg-white/20 text-white" : "bg-[#efe0bb] text-[#5a4420]"
                  }`}>
                    {ent.kind}
                  </span>
                </button>
              );
            })}
          </div>
        </AsyncState>
      </div>

      {/* Selected entity */}
      {activeId != null && (
        <div className="rounded-xl border border-[#d8c79a] bg-[#faf4e4] p-6 md:p-8 space-y-6">
          <AsyncState
            loading={detailLoading}
            error={detailError}
            onRetry={retryDetail}
            labels={{ loading: "Following the references…", error: "That entity could not be opened." }}
          >
            <>
              {entity && (
                <div className="border-b border-[#d8c79a] pb-4">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#efe0bb] text-[#5a4420] font-semibold uppercase tracking-wider" style={{ fontFamily: FONT_UI }}>
                      {entity.kind}
                    </span>
                    <span className="text-xs text-[#8a7f63]" style={{ fontFamily: FONT_UI }}>
                      {detailData?.detail?.mentionCount ?? mentions.length} passage
                      {(detailData?.detail?.mentionCount ?? mentions.length) === 1 ? "" : "s"}
                    </span>
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
                    {entity.name}
                  </h2>
                  {entity.description && (
                    <p className="text-sm md:text-base text-[#4a4330] mt-2 max-w-2xl leading-relaxed" style={{ fontFamily: FONT_BODY }}>
                      {entity.description}
                    </p>
                  )}
                </div>
              )}

              {/* Related, with the archive's own reason attached */}
              <div>
                <h4 className="text-xs uppercase font-bold tracking-wider text-[#5a4420] mb-3" style={{ fontFamily: FONT_UI }}>
                  {t.relatedEntities || "Appears alongside"} ({relatedEntities.length})
                </h4>

                {relatedEntities.length === 0 ? (
                  <p className="text-xs text-[#8a7f63]" style={{ fontFamily: FONT_UI }}>
                    Nothing else in the archive shares a passage with this entity.
                  </p>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-3">
                    {relatedEntities.map((rel) => (
                      <button
                        key={rel.id}
                        onClick={() => setSelectedId(rel.id)}
                        className="daic-card text-left p-4 rounded-lg border border-[#d8c79a] bg-white hover:border-[#b3862c] flex flex-col justify-between gap-3 group"
                      >
                        <div>
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#9c3d2e] uppercase tracking-wider mb-1" style={{ fontFamily: FONT_UI }}>
                            <ArrowRight size={12} aria-hidden="true" /> {rel.sharedPassages} shared
                          </div>
                          <h5 className="text-base font-semibold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
                            {rel.name}
                          </h5>
                          {/* The reason, verbatim from the archive. */}
                          <p className="text-xs text-[#6b6350] mt-1" style={{ fontFamily: FONT_UI }}>
                            {rel.reason}
                          </p>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-[#f0e6cb] text-[11px]" style={{ fontFamily: FONT_UI }}>
                          <span className="px-2 py-0.5 rounded bg-[#efe0bb] text-[#5a4420] uppercase text-[9px] font-bold">
                            {rel.kind}
                          </span>
                          <span className="text-[#1c2c4d] font-semibold inline-flex items-center gap-1 group-hover:underline">
                            Explore node <ChevronRight size={12} className="daic-arrow" aria-hidden="true" />
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* The passages themselves — a relationship you can follow to a page */}
              {mentions.length > 0 && (
                <div className="pt-4 border-t border-[#d8c79a]">
                  <h4 className="text-xs uppercase font-bold tracking-wider text-[#5a4420] mb-3" style={{ fontFamily: FONT_UI }}>
                    Passages in the archive
                  </h4>
                  <div className="space-y-2.5">
                    {mentions.slice(0, 8).map((m) => (
                      <button
                        key={m.uid}
                        onClick={() => openArticle?.(m.documentId)}
                        className="daic-card w-full text-left p-3.5 rounded-lg border border-[#d8c79a] bg-white hover:border-[#b3862c]"
                      >
                        <div className="flex items-center gap-2 mb-1 flex-wrap text-[11px]" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                          <Quote size={11} color={GOLD} aria-hidden="true" />
                          <span className="font-semibold text-[#5a4420]">{m.documentTitle}</span>
                          {m.section && <span>· {m.section}</span>}
                          {m.page != null && <span>· p. {m.page}</span>}
                        </div>
                        <p className="text-sm italic" style={{ fontFamily: FONT_BODY, color: INKTEXT }}>
                          {m.excerpt}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          </AsyncState>
        </div>
      )}
    </div>
  );
}

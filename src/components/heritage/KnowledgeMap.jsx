import { useState, useCallback, useMemo } from "react";
import {
  Network, ArrowRight, BookOpen, Scale,
  Milestone, Sparkles, ChevronRight, Quote, Search, X, Users, MapPin,
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
  person: <Users size={13} />,
  place: <MapPin size={13} />,
  organisation: <Scale size={13} />,
  work: <BookOpen size={13} />,
  concept: <Sparkles size={13} />,
  theme: <Sparkles size={13} />,
  event: <Milestone size={13} />,
};

/* ---------------------------------------------------------------------- *
 * Categories
 *
 * These are the archive's OWN entity kinds, relabelled for a reader - not
 * a scheme invented here. The extractor records person, place, work, theme
 * and event, and grouping by anything else would be asserting a
 * classification of history that nobody made.
 *
 * The grouping exists because 121 of the 140 entities are `work`: every
 * section and chapter across the volumes. Rendered as one flat list that
 * is a wall of 140 chips, which is what this page used to be. An entity
 * whose kind is not one of these falls into "Other" rather than being
 * forced into a category it does not belong to.
 * ---------------------------------------------------------------------- */
const CATEGORIES = [
  { id: "theme", label: "Themes & Ideas", kinds: ["theme", "concept"] },
  { id: "work", label: "Writings & Works", kinds: ["work"] },
  { id: "person", label: "People", kinds: ["person", "organisation"] },
  { id: "place", label: "Places", kinds: ["place"] },
  { id: "event", label: "Events", kinds: ["event"] },
];

const OTHER = { id: "other", label: "Other", kinds: [] };

/** How many entities a category shows before "show more". */
const PAGE = 12;

function categoryOf(kind) {
  return CATEGORIES.find((c) => c.kinds.includes(kind))?.id ?? OTHER.id;
}

export default function KnowledgeMap({ t, openArticle }) {
  const [selectedId, setSelectedId] = useState(null);
  const [category, setCategory] = useState("theme");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);

  const listFetcher = useCallback((signal) => api.entities(undefined, { signal }), []);
  const { data: list, loading, error, retry } = useArchive(listFetcher, []);

  const entities = useMemo(() => list?.entities ?? [], [list]);

  /* Categories are only offered when the archive actually has entities in
     them, so the page never shows a tab that leads to an empty shelf. */
  const groups = useMemo(() => {
    const counts = {};
    for (const e of entities) {
      const id = categoryOf(e.kind);
      counts[id] = (counts[id] || 0) + 1;
    }
    return [...CATEGORIES, OTHER]
      .filter((c) => counts[c.id])
      .map((c) => ({ ...c, count: counts[c.id] }));
  }, [entities]);

  const activeCategory = groups.some((g) => g.id === category)
    ? category
    : groups[0]?.id ?? "theme";

  /* Within a category, the most-referenced entities come first: "appears in
     400 passages" is the archive's own measure of prominence, not an
     editorial judgement about importance. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entities
      .filter((e) => categoryOf(e.kind) === activeCategory)
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => (b.links || 0) - (a.links || 0) || a.name.localeCompare(b.name));
  }, [entities, activeCategory, query]);

  const activeId = selectedId ?? visible[0]?.id ?? entities[0]?.id ?? null;

  const selectCategory = (id) => {
    setCategory(id);
    setShown(PAGE);
    setQuery("");
  };

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
          <>
            {/* Category tabs, built from the kinds the archive records */}
            <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Entity categories">
              {groups.map((g) => {
                const on = g.id === activeCategory;
                return (
                  <button
                    key={g.id}
                    role="tab"
                    aria-selected={on}
                    onClick={() => selectCategory(g.id)}
                    className={`daic-chip px-3.5 py-2 rounded-full border text-xs transition-colors ${
                      on
                        ? "bg-[#1c2c4d] text-[#f4ead0] border-[#b3862c]"
                        : "bg-[#faf4e4] border-[#c9b98c] text-[#5a4420] hover:border-[#b3862c]"
                    }`}
                    style={{ fontFamily: FONT_UI, fontWeight: 600 }}
                  >
                    {g.label}
                    <span className={`ml-2 text-[10px] ${on ? "text-[#d9ac4f]" : "text-[#8a7f63]"}`}>
                      {g.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Filter within the category. "Writings & Works" holds 121
                sections, which is a list to search rather than to scroll. */}
            <div className="flex items-center gap-2 bg-white/60 border border-[#c9b98c] rounded-full pl-3 pr-2 py-1.5 mb-4 max-w-sm focus-within:border-[#b3862c] transition-colors">
              <Search size={14} color={GOLD} aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }}
                placeholder="Filter by name…"
                aria-label="Filter entities by name"
                className="flex-1 bg-transparent outline-none text-xs min-w-0"
                style={{ fontFamily: FONT_UI, color: INKTEXT }}
              />
              {query && (
                <button
                  onClick={() => { setQuery(""); setShown(PAGE); }}
                  aria-label="Clear filter"
                  className="daic-chip w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ color: "#8a7f63" }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {visible.length === 0 ? (
              <p className="text-xs" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                Nothing in this category matches “{query}”.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2.5">
                  {visible.slice(0, shown).map((ent) => {
                    const isSelected = ent.id === activeId;
                    return (
                      <button
                        key={ent.id}
                        onClick={() => setSelectedId(ent.id)}
                        className={`daic-chip px-3.5 py-2 rounded-full border text-xs flex items-center gap-2 max-w-full transition-all duration-200 ${
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
                        {/* A section title from a volume can be long; it
                            truncates on the chip and is shown in full in the
                            panel below. */}
                        <span className="font-medium truncate max-w-[15rem]">{ent.name}</span>
                      </button>
                    );
                  })}
                </div>

                {visible.length > shown && (
                  <button
                    onClick={() => setShown((n) => n + PAGE * 2)}
                    className="daic-btn mt-4 text-xs px-3 py-1.5 rounded-full border"
                    style={{ borderColor: "#c9b98c", color: "#5a4420", fontFamily: FONT_UI, fontWeight: 600 }}
                  >
                    Show more ({visible.length - shown} remaining)
                  </button>
                )}
              </>
            )}
          </>
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
                            View connections <ChevronRight size={12} className="daic-arrow" aria-hidden="true" />
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

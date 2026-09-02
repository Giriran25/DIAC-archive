import { useState, useMemo, useCallback } from "react";
import {
  Search, ChevronRight, ShieldCheck, Volume2, Database,
  MessageCircle, ScrollText, Clock, Film, Heart, Network
} from "lucide-react";
import ChakraMark from "../components/ChakraMark.jsx";
import TypeIcon from "../components/ui/TypeIcon.jsx";
import { api } from "../lib/api/endpoints.js";
import { useArchive } from "../lib/api/useArchive.js";
import {
  FONT_DISPLAY, FONT_BODY, FONT_UI,
  INKTEXT, INDIGO, GOLD, GOLD_LIGHT, CREAM,
} from "../lib/tokens.js";

/* ---------------------------------------------------------------------- */
/* HomeView — enhanced with Phase 2 feature discovery and exploration     */
/* ---------------------------------------------------------------------- */

export default function HomeView({ _lang, t, onAsk, setTab, openArticle }) {
  const [q, setQ] = useState("");

  const submit = (e) => {
    e.preventDefault();
    onAsk(q.trim());
  };

  /* Suggestions are titles the archive really holds, matched by the archive
     itself. Ranking here in the browser would have meant a second, different
     search living beside the real one. */
  const query = q.trim();
  const suggestFetcher = useCallback(
    (signal) => (query ? api.archive({ q: query }, { signal }) : Promise.resolve(null)),
    [query]
  );
  const { data: suggestData } = useArchive(suggestFetcher, [query]);
  const suggestions = useMemo(() => (suggestData?.documents ?? []).slice(0, 4), [suggestData]);

  /* Counts come from the archive's own health report. A figure on this page
     is either the archive's or it is not shown — the old card counted rows
     in a demo fixture and presented the total as the size of the holdings. */
  const healthFetcher = useCallback((signal) => api.health({ signal }), []);
  const { data: health } = useArchive(healthFetcher, []);
  const stats = health?.stats ?? null;

  const features = [
    { key: "ai",     icon: <MessageCircle size={20} />, label: t.featureAI,          sub: t.featureAISub,          action: () => setTab("ask") },
    { key: "arch",   icon: <Database size={20} />,      label: t.featureArchive,      sub: t.featureArchiveSub,      action: () => setTab("archive") },
    { key: "manu",   icon: <ScrollText size={20} />,    label: t.featureManuscripts,  sub: t.featureManuscriptsSub,  action: () => setTab("manuscripts") },
    { key: "time",   icon: <Clock size={20} />,         label: t.featureTimeline,     sub: t.featureTimelineSub,     action: () => setTab("timeline") },
    { key: "media",  icon: <Film size={20} />,          label: t.featureMedia,        sub: t.featureMediaSub,        action: () => setTab("media") },
    { key: "memo",   icon: <Heart size={20} />,         label: t.featureMemorial,     sub: t.featureMemorialSub,     action: () => setTab("stories") },
  ];

  return (
    <main id="main-content" className="max-w-5xl mx-auto px-6 pb-24">
      {/* Hero section */}
      <div className="pt-16 pb-14 text-center daic-reveal">
        <div className="flex justify-center mb-6 opacity-90"><ChakraMark size={40} /></div>
        <p
          className="uppercase text-xs tracking-[0.25em] mb-4"
          style={{ fontFamily: FONT_UI, color: GOLD }}
        >
          Dr. Ambedkar International Centre · Digital Heritage Archive
        </p>
        <h1
          className="text-4xl md:text-6xl leading-[1.1] mb-6"
          style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}
        >
          {(t.heroTitle || "Every word, dated,\nsourced, and open to ask.").split("\n").map((line, i) => (
            <span key={i}>{line}{i === 0 && <br />}</span>
          ))}
        </h1>
        <p
          className="max-w-xl mx-auto text-base md:text-lg mb-10"
          style={{ fontFamily: FONT_BODY, color: "#4a4330" }}
        >
          {t.tagline}
        </p>

        {/* Search bar */}
        <form
          onSubmit={submit}
          className="max-w-xl mx-auto flex items-center gap-2 bg-[#faf4e4] border border-[#c9b98c] rounded-full pl-5 pr-2 py-2 shadow-sm focus-within:border-[#b3862c] transition-colors"
        >
          <Search size={18} color={GOLD} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.placeholder}
            className="flex-1 bg-transparent outline-none text-sm py-1.5"
            style={{ fontFamily: FONT_UI, color: INKTEXT }}
            aria-label={t.placeholder}
          />
          <button
            type="submit"
            data-testid="ask-archive"
            className="daic-btn rounded-full px-4 py-2 text-sm text-white hover:opacity-90 transition-opacity flex items-center gap-1.5 shrink-0"
            style={{ backgroundColor: INDIGO, fontFamily: FONT_UI }}
          >
            {t.cta} <ChevronRight size={14} />
          </button>
        </form>

        {/* Search suggestions */}
        {suggestions.length > 0 && (
          <div className="max-w-xl mx-auto mt-4">
            <p
              className="text-[11px] uppercase tracking-wide mb-2"
              style={{ fontFamily: FONT_UI, color: "#8a7f63" }}
            >
              {t.results} — {t.jumpTo}
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestions.map((a) => (
                <button
                  key={a.id}
                  onClick={() => openArticle(a.id)}
                  className="daic-chip inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border hover:bg-[#f2e2c6] transition-colors"
                  style={{ borderColor: "#c9b98c", color: "#5a4420", fontFamily: FONT_UI }}
                >
                  <TypeIcon type={a.docType} size={11} color={GOLD} /> {a.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Archive statistics — only what the archive reports about itself */}
      <div className="grid sm:grid-cols-3 gap-4 mb-16">
        {[
          {
            icon: <Database size={18} />,
            value: stats ? stats.documents : "—",
            label: t.statArticles,
            sub: stats ? `${stats.chunks} ${t.statPassages}` : "Counts unavailable",
          },
          {
            icon: <ShieldCheck size={18} />,
            value: stats ? stats.documents_approved : "—",
            label: "Approved holdings",
            sub: stats
              ? `${stats.documents_pending} awaiting review`
              : "No source above threshold, no answer",
          },
          {
            icon: <Volume2 size={18} />,
            value: 5,
            label: t.statLanguages,
            sub: "Every article reads aloud",
          },
        ].map((c, i) => (
          <div key={i} className={`daic-card daic-reveal rounded-lg border border-[#d8c79a] bg-[#faf4e4] p-5 daic-reveal-${i + 1}`}>
            <div style={{ color: GOLD }} className="mb-2">{c.icon}</div>
            <div className="text-2xl mb-1" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>{c.value}</div>
            <div className="text-sm mb-0.5" style={{ fontFamily: FONT_UI, color: INKTEXT, fontWeight: 600 }}>{c.label}</div>
            <div className="text-xs" style={{ fontFamily: FONT_UI, color: "#6b6350" }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Feature discovery */}
      <section className="mb-16">
        <p
          className="uppercase text-xs tracking-[0.25em] mb-3 text-center"
          style={{ fontFamily: FONT_UI, color: GOLD }}
        >
          Explore the archive
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <button
              key={f.key}
              onClick={f.action}
              className={`daic-card daic-arrow-parent daic-reveal text-left rounded-lg border border-[#d8c79a] bg-[#faf4e4] p-5 flex flex-col gap-2 transition-colors hover:border-[#b3862c] cursor-pointer daic-reveal-${i + 1}`}
            >
              <div style={{ color: GOLD }}>{f.icon}</div>
              <div className="text-base flex items-center gap-1.5" style={{ fontFamily: FONT_UI, color: INKTEXT, fontWeight: 600 }}>
                {f.label}
                <ChevronRight size={14} className="daic-arrow" style={{ color: GOLD }} />
              </div>
              <div className="text-xs" style={{ fontFamily: FONT_UI, color: "#6b6350" }}>{f.sub}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Cross-format banner */}
      <div className="daic-reveal rounded-xl overflow-hidden border border-[#d8c79a]" style={{ backgroundColor: INDIGO }}>
        <div className="p-7 md:p-9">
          <p
            className="uppercase text-[11px] tracking-[0.2em] mb-3"
            style={{ fontFamily: FONT_UI, color: GOLD_LIGHT }}
          >
            {t.crossFormat}
          </p>
          <p
            className="text-lg md:text-xl mb-6 max-w-2xl"
            style={{ fontFamily: FONT_DISPLAY, color: CREAM }}
          >
            {t.crossFormatDesc}
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Debate transcript", tab: "archive" },
              { label: "Manuscript page", tab: "manuscripts" },
              { label: "Audio recording", tab: "media" },
              { label: "Knowledge Map", tab: "knowledge" },
            ].map((x) => (
              <button
                key={x.label}
                onClick={() => setTab(x.tab)}
                className="daic-chip text-xs px-3 py-1.5 rounded-full border hover:bg-white/10 transition-colors"
                style={{ borderColor: "rgba(244,234,208,0.25)", color: CREAM, fontFamily: FONT_UI }}
              >
                {x.label} →
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline & Knowledge CTA */}
      <div className="flex justify-center items-center gap-6 mt-10 flex-wrap">
        <button
          onClick={() => setTab("timeline")}
          className="daic-btn daic-arrow-parent text-sm inline-flex items-center gap-1 hover:underline font-medium"
          style={{ fontFamily: FONT_UI, color: INDIGO }}
        >
          {t.walkTimeline} <ChevronRight size={14} className="daic-arrow" />
        </button>
        <span className="text-[#8a7f63]">·</span>
        <button
          onClick={() => setTab("knowledge")}
          className="daic-btn daic-arrow-parent text-sm inline-flex items-center gap-1 hover:underline font-medium"
          style={{ fontFamily: FONT_UI, color: INDIGO }}
        >
          <Network size={14} className="inline mr-0.5" /> Explore Knowledge Graph <ChevronRight size={14} className="daic-arrow" />
        </button>
      </div>
    </main>
  );
}

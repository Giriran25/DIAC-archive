import KnowledgeMap from "../components/heritage/KnowledgeMap.jsx";
import {
  FONT_DISPLAY, FONT_UI,
  GOLD, INKTEXT
} from "../lib/tokens.js";

/* ---------------------------------------------------------------------- */
/* KnowledgeView — Full Knowledge Mapping Explorer                         */
/* ---------------------------------------------------------------------- */

export default function KnowledgeView({ t, openArticle }) {
  return (
    <main id="main-content" className="max-w-5xl mx-auto px-6 pb-24">
      {/* Header */}
      <div className="pt-12 pb-8 text-center daic-reveal">
        <p className="uppercase text-xs tracking-[0.25em] mb-3" style={{ fontFamily: FONT_UI, color: GOLD }}>
          {t.knowledge || "Knowledge Graph"}
        </p>
        <h1 className="text-3xl md:text-5xl font-bold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
          Conceptual Knowledge Map
        </h1>
        <p className="max-w-xl mx-auto text-sm md:text-base text-[#6b6350] mt-3" style={{ fontFamily: FONT_UI }}>
          Traverse the philosophical, constitutional, and historical relationships connecting writings, movements, statutes, and ideas.
        </p>
      </div>

      {/* Embedded Knowledge Map Component */}
      <KnowledgeMap t={t} openArticle={openArticle} />
    </main>
  );
}

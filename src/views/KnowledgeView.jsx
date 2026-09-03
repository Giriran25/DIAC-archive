import KnowledgeMap from "../components/heritage/KnowledgeMap.jsx";
import { pageTitle, eyebrow, provenance } from "../lib/type.js";
import { GOLD } from "../lib/tokens.js";

/* ---------------------------------------------------------------------- */
/* KnowledgeView — Full Knowledge Mapping Explorer                         */
/* ---------------------------------------------------------------------- */

export default function KnowledgeView({ t, openArticle }) {
  return (
    <main id="main-content" className="max-w-5xl mx-auto px-4 sm:px-6 pb-24">
      {/* Header */}
      <div className="pt-12 pb-8 text-center daic-reveal">
        <p className="mb-3" style={{ ...eyebrow, color: GOLD }}>
          {t.knowledge || "Knowledge Graph"}
        </p>
        <h1 className="text-3xl md:text-4xl" style={pageTitle}>
          Conceptual Knowledge Map
        </h1>
        <p className="max-w-xl mx-auto mt-3 text-sm" style={{ ...provenance, color: "#6b6350" }}>
          The names, places, works and events the archive has indexed, and the
          passages in which they appear together.
        </p>
      </div>

      {/* Embedded Knowledge Map Component */}
      <KnowledgeMap t={t} openArticle={openArticle} />
    </main>
  );
}

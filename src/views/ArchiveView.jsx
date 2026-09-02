import { useState, useMemo, useCallback } from "react";
import { Search, ShieldCheck, ChevronRight, X } from "lucide-react";
import TypeIcon from "../components/ui/TypeIcon.jsx";
import StatusChip from "../components/ui/StatusChip.jsx";
import AsyncState from "../components/ui/AsyncState.jsx";
import { api } from "../lib/api/endpoints.js";
import { useArchive } from "../lib/api/useArchive.js";
import { FONT_DISPLAY, FONT_UI, GOLD, INKTEXT, INDIGO, CREAM } from "../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * Archive — a list of what the archive actually holds.
 *
 * Filters come from the backend's own facets rather than a hardcoded list,
 * so a filter can never offer a category the holdings do not contain. The
 * card shows only fields the archive really stores: there is no per-document
 * "theme" and no editorial summary, and inventing either would put words
 * next to a primary source that nobody wrote.
 * ---------------------------------------------------------------------- */

const ALL = "All";

export default function ArchiveView({ t, openArticle }) {
  const [docType, setDocType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [query, setQuery] = useState("");

  const fetcher = useCallback(
    (signal) => api.archive({
      doc_type: docType === ALL ? undefined : docType,
      status: status === ALL ? undefined : status,
      q: query.trim() || undefined,
    }, { signal }),
    [docType, status, query]
  );

  const { data, loading, error, retry } = useArchive(fetcher, [docType, status, query]);

  const documents = useMemo(() => data?.documents ?? [], [data]);
  const facets = data?.facets ?? {};
  const docTypes = [ALL, ...(facets.docTypes ?? [])];
  const statuses = [ALL, ...(facets.statuses ?? [])];

  const hasFilters = docType !== ALL || status !== ALL || query.trim();

  const clearAll = () => {
    setDocType(ALL);
    setStatus(ALL);
    setQuery("");
  };

  return (
    <main id="main-content" className="max-w-5xl mx-auto px-4 sm:px-6 pb-20">
      <div className="pt-12 pb-8 daic-reveal">
        <p className="uppercase text-xs tracking-[0.25em] mb-3" style={{ fontFamily: FONT_UI, color: GOLD }}>
          {t.searchTitle || "Browse the archive"}
        </p>
        <h2 className="text-3xl md:text-4xl mb-6" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
          By theme, not by shelf
        </h2>

        {/* Search bar */}
        <div className="max-w-xl mb-6 flex items-center gap-2 bg-[#faf4e4] border border-[#c9b98c] rounded-full pl-4 pr-2 py-2 focus-within:border-[#b3862c] transition-colors">
          <Search size={16} color={GOLD} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder || "Search writings, speeches, debates…"}
            className="flex-1 bg-transparent outline-none text-sm min-w-0"
            style={{ fontFamily: FONT_UI, color: INKTEXT }}
            aria-label={t.searchPlaceholder || "Search the archive"}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="daic-chip w-6 h-6 rounded-full flex items-center justify-center"
              style={{ color: "#8a7f63" }}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Document-type filters, offered only where the archive has them */}
        {docTypes.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label={t.filterType || "Filter by type"}>
            {docTypes.map((x) => (
              <button
                key={x}
                onClick={() => setDocType(x)}
                className="daic-chip text-xs px-3 py-1.5 rounded-full border transition-colors"
                style={{
                  borderColor: x === docType ? GOLD : "#c9b98c",
                  backgroundColor: x === docType ? "#efe0bb" : "transparent",
                  color: "#5a4420",
                  fontFamily: FONT_UI,
                }}
                aria-pressed={x === docType}
              >
                {x}
              </button>
            ))}
          </div>
        )}

        {/* Verification-status filters */}
        {statuses.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Filter by verification status">
            {statuses.map((x) => (
              <button
                key={x}
                onClick={() => setStatus(x)}
                className="daic-chip text-xs px-3 py-1.5 rounded-full border transition-colors"
                style={{
                  borderColor: x === status ? INDIGO : "#c9b98c",
                  backgroundColor: x === status ? INDIGO : "transparent",
                  color: x === status ? CREAM : "#5a4420",
                  fontFamily: FONT_UI,
                }}
                aria-pressed={x === status}
              >
                {x}
              </button>
            ))}
          </div>
        )}

        {hasFilters && !loading && !error && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[11px]" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
              {documents.length} {t.results?.toLowerCase() || "results"}
            </span>
            <button
              onClick={clearAll}
              className="daic-chip text-[11px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1"
              style={{ borderColor: "#c9b98c", color: "#5a4420", fontFamily: FONT_UI }}
            >
              <X size={10} aria-hidden="true" /> {t.clearFilters || "Clear filters"}
            </button>
          </div>
        )}
      </div>

      <AsyncState
        loading={loading}
        error={error}
        empty={documents.length === 0}
        onRetry={retry}
        labels={{
          loading: "Reading the archive…",
          error: "The archive could not be listed.",
          empty: t.noResults || "No items match this filter yet.",
          emptyHint: hasFilters ? "Try clearing the filters or searching for a different title." : undefined,
        }}
      >
        <div className="grid sm:grid-cols-2 gap-4">
          {documents.map((it, i) => (
            <button
              key={it.id}
              onClick={() => openArticle(it.id)}
              className={`daic-card daic-arrow-parent daic-reveal text-left rounded-lg border border-[#d8c79a] bg-[#faf4e4] p-5 flex flex-col gap-3 hover:border-[#b3862c] transition-colors daic-reveal-${Math.min(i + 1, 6)}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2" style={{ color: GOLD }}>
                  <TypeIcon type={it.docType} size={16} />
                  <span className="text-[11px] uppercase tracking-wide" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                    {[it.docType, it.date].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <StatusChip status={it.verificationStatus} />
              </div>

              <h3 className="text-lg" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>{it.title}</h3>

              {/* Real catalogue metadata in place of an invented blurb. */}
              <p className="text-xs" style={{ fontFamily: FONT_UI, color: "#6b6350" }}>
                {[it.author, it.volume, it.publisher].filter(Boolean).join(" · ")}
              </p>

              <span
                className="text-[11px] inline-flex items-center gap-1 mt-auto"
                style={{ fontFamily: FONT_UI, color: INDIGO }}
              >
                <ShieldCheck size={11} aria-hidden="true" />
                {it.chunks != null ? `${it.chunks} sourced passages` : "Passages not yet indexed"}
                <ChevronRight size={11} className="daic-arrow" aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>
      </AsyncState>
    </main>
  );
}

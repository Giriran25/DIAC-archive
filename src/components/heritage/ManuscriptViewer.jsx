import { useState, useCallback } from "react";
import {
  ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight,
  ShieldCheck, FileText, CheckCircle2, Clock, AlertTriangle,
  Columns, Image as ImageIcon, EyeOff,
} from "lucide-react";
import AsyncState from "../ui/AsyncState.jsx";
import { api } from "../../lib/api/endpoints.js";
import { useArchive } from "../../lib/api/useArchive.js";
import {
  FONT_DISPLAY, FONT_BODY, FONT_UI,
  GOLD, INKTEXT,
} from "../../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * ManuscriptViewer — the real scan beside the real transcription.
 *
 * The previous version drew a facsimile out of CSS and rendered a
 * per-line confidence the archive does not record, on pages whose text it
 * had invented. Both halves now come from the archive: the leaf is the
 * page image endpoint, and the transcription is whichever text the review
 * loop has made authoritative — with the state of that review visible,
 * because an unapproved transcription is not yet a source.
 * ---------------------------------------------------------------------- */

const REVIEW_BADGES = {
  approved: { bg: "bg-[#2f4a33]", text: "text-[#dcefd6]", icon: <CheckCircle2 size={12} />, label: "Approved" },
  in_review: { bg: "bg-[#5a4420]", text: "text-[#f3dfa8]", icon: <AlertTriangle size={12} />, label: "In review" },
  pending: { bg: "bg-[#4a3a3a]", text: "text-[#e8d0d0]", icon: <Clock size={12} />, label: "Pending review" },
  rejected: { bg: "bg-[#5a3a3a]", text: "text-[#e8d0d0]", icon: <EyeOff size={12} />, label: "Rejected" },
};

export default function ManuscriptViewer({ manuscript, t }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState("split"); // 'split' | 'scan' | 'ocr'
  const [imageFailed, setImageFailed] = useState(false);

  const manuscriptId = manuscript?.id;

  /* Page text is fetched per page: the list endpoint deliberately omits it,
     because a manuscript can be long and the transcription is the large part. */
  const fetcher = useCallback(
    (signal) => api.manuscriptPage(manuscriptId, currentPage, { signal }),
    [manuscriptId, currentPage]
  );
  const { data, loading, error, retry } = useArchive(fetcher, [manuscriptId, currentPage]);
  /* The endpoint wraps the leaf: { page: {...} }. */
  const page = data?.page ?? null;

  if (!manuscript) return null;

  const totalPages = manuscript.pageCount ?? 1;
  const badge = REVIEW_BADGES[page?.reviewStatus] || REVIEW_BADGES.pending;

  /* A confidence exists only where an engine produced one. */
  const hasConfidence = typeof page?.ocrConfidence === "number" && Number.isFinite(page.ocrConfidence);

  const text = page?.authoritativeText || page?.correctedText || page?.ocrText || "";

  const goTo = (n) => {
    setImageFailed(false);
    setCurrentPage(Math.min(Math.max(1, n), totalPages));
  };

  return (
    <div className="rounded-xl border border-[#d8c79a] bg-[#faf4e4] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#d8c79a] flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-bold inline-flex items-center gap-1 ${badge.bg} ${badge.text}`}
              style={{ fontFamily: FONT_UI }}
            >
              {badge.icon} {badge.label}
            </span>
            <span className="text-[11px]" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
              {[manuscript.collection, manuscript.source].filter(Boolean).join(" · ")}
            </span>
          </div>
          <h3 className="text-lg font-bold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
            {manuscript.title}
          </h3>
        </div>

        {/* View mode */}
        <div className="flex items-center gap-1" role="group" aria-label="Viewer layout">
          {[
            { id: "split", icon: <Columns size={13} />, label: "Split view" },
            { id: "scan", icon: <ImageIcon size={13} />, label: "Scan only" },
            { id: "ocr", icon: <FileText size={13} />, label: "Transcription only" },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => setViewMode(m.id)}
              aria-pressed={viewMode === m.id}
              aria-label={m.label}
              title={m.label}
              className="daic-chip w-8 h-8 rounded-lg border flex items-center justify-center transition-colors"
              style={{
                borderColor: viewMode === m.id ? GOLD : "#c9b98c",
                backgroundColor: viewMode === m.id ? "#efe0bb" : "transparent",
                color: "#5a4420",
              }}
            >
              {m.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Page navigation */}
      <div className="px-5 py-2.5 border-b border-[#d8c79a] flex items-center justify-between gap-3 flex-wrap bg-[#f4ead0]">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => goTo(currentPage - 1)}
            disabled={currentPage <= 1}
            className="daic-btn w-8 h-8 rounded-lg border border-[#c9b98c] flex items-center justify-center disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft size={14} color="#5a4420" />
          </button>
          <span className="text-xs px-2" style={{ fontFamily: FONT_UI, color: "#5a4420" }}>
            {t.page || "Page"} {currentPage} {t.of || "of"} {totalPages}
          </span>
          <button
            onClick={() => goTo(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="daic-btn w-8 h-8 rounded-lg border border-[#c9b98c] flex items-center justify-center disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight size={14} color="#5a4420" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                  className="daic-btn w-8 h-8 rounded-lg border border-[#c9b98c] flex items-center justify-center"
                  aria-label="Zoom out">
            <ZoomOut size={14} color="#5a4420" />
          </button>
          <span className="text-[11px] w-10 text-center" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                  className="daic-btn w-8 h-8 rounded-lg border border-[#c9b98c] flex items-center justify-center"
                  aria-label="Zoom in">
            <ZoomIn size={14} color="#5a4420" />
          </button>
          <button onClick={() => setZoom(1)}
                  className="daic-btn w-8 h-8 rounded-lg border border-[#c9b98c] flex items-center justify-center"
                  aria-label="Reset zoom">
            <RotateCcw size={13} color="#5a4420" />
          </button>
        </div>
      </div>

      <AsyncState
        loading={loading}
        error={error}
        onRetry={retry}
        labels={{ loading: "Opening the leaf…", error: "That page could not be opened." }}
      >
        <div className={`p-5 grid gap-5 ${viewMode === "split" ? "md:grid-cols-2" : "grid-cols-1"}`}>
          {/* ---- The scan itself ---- */}
          {viewMode !== "ocr" && (
            <div>
              <p className="text-[10px] uppercase tracking-widest mb-2" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                Original leaf
              </p>
              <div className="rounded-lg border border-[#c9b98c] bg-[#efe0bb] overflow-auto" style={{ maxHeight: "70vh" }}>
                {page?.hasImage && !imageFailed ? (
                  <img
                    src={api.manuscriptPageImageUrl(manuscript.id, currentPage, 1600)}
                    alt={page.caption || `${manuscript.title}, page ${currentPage}`}
                    onError={() => setImageFailed(true)}
                    className="block"
                    style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
                  />
                ) : (
                  /* No scan is a fact about the archive, stated plainly —
                     not an excuse to draw one. */
                  <div className="flex flex-col items-center justify-center gap-2 py-16 px-6 text-center">
                    <ImageIcon size={22} style={{ color: "#8a7f63" }} aria-hidden="true" />
                    <p className="text-xs" style={{ fontFamily: FONT_UI, color: "#6f6549" }}>
                      {imageFailed
                        ? "The scan for this page could not be loaded."
                        : "No scan is held for this page."}
                    </p>
                  </div>
                )}
              </div>
              {page?.caption && (
                <p className="mt-2 text-[11px]" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                  {page.caption}
                </p>
              )}
            </div>
          )}

          {/* ---- The transcription ---- */}
          {viewMode !== "scan" && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <p className="text-[10px] uppercase tracking-widest" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                  Transcription
                </p>
                <span className="text-[10px] inline-flex items-center gap-1.5" style={{ fontFamily: FONT_UI, color: "#5a4420" }}>
                  <ShieldCheck size={12} color={GOLD} />
                  {t.confidence || "Confidence"}:{" "}
                  {hasConfidence ? `${Math.round(page.ocrConfidence * 100)}%` : "not scored"}
                  {page?.ocrEngine ? ` · ${page.ocrEngine}` : ""}
                </span>
              </div>

              <div className="rounded-lg border border-[#c9b98c] bg-white/60 p-4 overflow-auto" style={{ maxHeight: "70vh" }}>
                {text ? (
                  <p className="text-sm md:text-base leading-relaxed whitespace-pre-wrap"
                     style={{ fontFamily: FONT_BODY, color: INKTEXT }}>
                    {text}
                  </p>
                ) : (
                  <p className="text-xs" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                    No transcription has been produced for this page yet.
                  </p>
                )}
              </div>

              {/* Whether this page can be found by a search is a property of
                  the review loop, and the reader is entitled to know it. */}
              <p className="mt-2 text-[11px]" style={{ fontFamily: FONT_UI, color: "#6f6549" }}>
                {page?.searchable
                  ? "Approved and indexed — this page is retrievable by search."
                  : "Not yet approved, so this text is not retrievable by search."}
                {page?.reviewer ? ` Reviewed by ${page.reviewer}.` : ""}
              </p>

              {page?.reviewNote && (
                <p className="mt-1.5 text-[11px] p-2.5 rounded-lg bg-[#efe0bb]"
                   style={{ fontFamily: FONT_UI, color: "#5a4420" }}>
                  <span className="font-semibold">Archivist note: </span>{page.reviewNote}
                </p>
              )}
            </div>
          )}
        </div>
      </AsyncState>

      {/* Provenance */}
      {(manuscript.source || manuscript.licence) && (
        <div className="mx-5 mb-5 p-3 rounded-lg bg-[#efe0bb] text-xs space-y-1"
             style={{ fontFamily: FONT_UI, color: "#5a4420" }}>
          {manuscript.source && <p className="font-semibold">{manuscript.source}</p>}
          {manuscript.licence && <p className="text-[11px] text-[#6b6350]">{manuscript.licence}</p>}
        </div>
      )}
    </div>
  );
}

import { useState, useMemo, useCallback } from "react";
import {
  ShieldCheck, ArrowLeft, ChevronRight, ChevronLeft,
  Globe2, Sparkles, AlertCircle,
} from "lucide-react";
import ChakraMark from "../components/ChakraMark.jsx";
import TypeIcon from "../components/ui/TypeIcon.jsx";
import StatusChip from "../components/ui/StatusChip.jsx";
import ListenControls from "../components/ui/ListenControls.jsx";
import EvidenceCard from "../components/evidence/EvidenceCard.jsx";
import AsyncState from "../components/ui/AsyncState.jsx";
import { splitSentences } from "../lib/retrieval.js";
import { api } from "../lib/api/endpoints.js";
import { ApiError } from "../lib/api/client.js";
import { useArchive } from "../lib/api/useArchive.js";
import {
  FONT_DISPLAY, FONT_BODY, FONT_UI,
  GOLD, INKTEXT, INDIGO,
} from "../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * ReaderView — a primary source, read from the archive.
 *
 * A document here has no editorial "body" and no blurb: it has catalogue
 * metadata, sections, and pages of transcribed text. That is what the
 * archive stores, so that is what is read, one printed page at a time, with
 * the page number visible — because a citation to this text has to name a
 * page a reader can turn to.
 * ---------------------------------------------------------------------- */

export default function ReaderView({ documentId, lang, t, reader, openArticle, back }) {
  const [page, setPage] = useState(null);
  const [summaryData, setSummaryData] = useState(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState(null);
  const [showTranslateModal, setShowTranslateModal] = useState(false);
  const [translationResult, setTranslationResult] = useState(null);
  const [translating, setTranslating] = useState(false);

  const docFetcher = useCallback(
    (signal) => api.document(documentId, { signal }),
    [documentId]
  );
  const { data, loading, error, retry } = useArchive(docFetcher, [documentId]);

  const doc = data?.document ?? null;
  const totals = data?.totals ?? {};
  const firstPage = totals.printedPageStart ?? 1;
  const lastPage = totals.printedPageEnd ?? firstPage;
  const currentPage = page ?? firstPage;

  const pageFetcher = useCallback(
    (signal) => (doc ? api.sourcePage(documentId, currentPage, { signal }) : Promise.resolve(null)),
    [documentId, currentPage, doc]
  );
  const { data: pageData, loading: pageLoading, error: pageError, retry: retryPage } =
    useArchive(pageFetcher, [documentId, currentPage, Boolean(doc)]);

  const pageText = pageData?.text || "";

  const sentences = useMemo(
    () => (doc ? [doc.title, ...splitSentences(pageText)] : []),
    [doc, pageText]
  );

  const active = reader.speakingId === `article:${documentId}`;
  let cursor = 1;

  const handleSummarize = async () => {
    try {
      setSummarizing(true);
      setSummaryError(null);
      const res = await api.summarize({ document_id: documentId });
      setSummaryData(res);
    } catch (err) {
      setSummaryError(err);
      setSummaryData(null);
    } finally {
      setSummarizing(false);
    }
  };

  /* `translated: false` means the text coming back is the ORIGINAL English.
     The flag decides what is rendered, never the presence of a string. */
  const handleTranslate = async (targetLang) => {
    try {
      setTranslating(true);
      const res = await api.translate({
        text: doc?.title || "",
        source_language: "en",
        target_language: targetLang,
      });
      setTranslationResult(res);
    } catch (err) {
      setTranslationResult({
        ok: false,
        translated: false,
        notice: err instanceof ApiError ? err.userMessage : "Translation is unavailable on this device.",
      });
    } finally {
      setTranslating(false);
    }
  };

  return (
    <main id="main-content" className="max-w-3xl mx-auto px-4 sm:px-6 pb-20">
      <button
        onClick={back}
        className="daic-btn mt-8 mb-6 text-sm inline-flex items-center gap-1.5 hover:underline font-medium"
        style={{ fontFamily: FONT_UI, color: INDIGO }}
      >
        <ArrowLeft size={14} aria-hidden="true" /> {t.backToArchive}
      </button>

      <AsyncState
        loading={loading}
        error={error}
        onRetry={retry}
        labels={{ loading: "Opening the document…", error: "That document could not be opened." }}
      >
        {doc && (
          <>
            {/* Catalogue header */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <span
                className="text-xs px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 font-semibold"
                style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}
              >
                <TypeIcon type={doc.docType} size={11} /> {doc.docType}
              </span>
              {doc.date && (
                <span className="text-xs" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>{doc.date}</span>
              )}
              {doc.volume && (
                <span className="text-xs" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>· {doc.volume}</span>
              )}
              <StatusChip status={doc.verificationStatus} />
            </div>

            <h1
              className={`text-3xl md:text-4xl mb-3 transition-colors ${active && reader.sentenceIndex === 0 ? "rounded px-1 -mx-1" : ""}`}
              style={{
                fontFamily: FONT_DISPLAY,
                color: INKTEXT,
                backgroundColor: active && reader.sentenceIndex === 0 ? "#f6e3b4" : "transparent",
              }}
            >
              {doc.title}
            </h1>

            {/* Real catalogue metadata, in place of an editorial summary the
                archive does not hold. */}
            <p className="text-sm mb-5" style={{ fontFamily: FONT_UI, color: "#6b6350" }}>
              {[doc.author, doc.publisher, doc.source].filter(Boolean).join(" · ")}
              {totals.chunks != null ? ` · ${totals.chunks} indexed passages` : ""}
            </p>

            {/* Actions */}
            <div className="flex items-center justify-between gap-3 mb-8 pb-6 border-b flex-wrap" style={{ borderColor: "#d8c79a" }}>
              <div className="flex items-center gap-3 flex-wrap">
                <ListenControls id={`article:${documentId}`} sentences={sentences} lang={lang} reader={reader} t={t} />
                {active && (
                  <span className="text-[11px] inline-flex items-center gap-1.5" style={{ fontFamily: FONT_UI, color: GOLD }}>
                    <ChakraMark size={12} spinning={!reader.paused} />
                    {t.reading} — {Math.min(reader.sentenceIndex + 1, sentences.length)}/{sentences.length}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSummarize}
                  disabled={summarizing}
                  className="daic-btn text-xs px-3 py-1 rounded-full border border-[#c9b98c] bg-[#faf4e4] text-[#5a4420] inline-flex items-center gap-1 hover:bg-[#f2e2c6] font-semibold disabled:opacity-60"
                  style={{ fontFamily: FONT_UI }}
                >
                  <Sparkles size={11} color={GOLD} aria-hidden="true" />
                  {summarizing ? t.summarizing || "Summarizing…" : t.summarize || "Summarize"}
                </button>

                <button
                  onClick={() => { setShowTranslateModal(true); setTranslationResult(null); }}
                  className="daic-btn text-xs px-3 py-1 rounded-full border border-[#c9b98c] bg-[#faf4e4] text-[#5a4420] inline-flex items-center gap-1 hover:bg-[#f2e2c6] font-semibold"
                  style={{ fontFamily: FONT_UI }}
                >
                  <Globe2 size={11} color={GOLD} aria-hidden="true" />
                  {t.translate || "Translate"}
                </button>
              </div>
            </div>

            {/* Summary */}
            {summaryError && (
              <div className="mb-10 p-4 rounded-2xl border border-[#e0b4a8] bg-[#f7e6e2] text-xs daic-reveal"
                   style={{ fontFamily: FONT_UI, color: "#8a3a22" }} role="alert">
                <span className="font-semibold inline-flex items-center gap-1.5">
                  <AlertCircle size={13} /> Summary unavailable
                </span>
                <p className="mt-1" style={{ color: "#6f4a3a" }}>
                  {summaryError.userMessage || summaryError.message}
                </p>
              </div>
            )}

            {summaryData && (
              <div className="mb-10 p-6 rounded-2xl border border-[#b3862c] bg-[#fcf8ed] shadow-sm daic-reveal space-y-4">
                <div className="flex items-center justify-between border-b border-[#e6d9b3] pb-3 gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Sparkles size={16} color={GOLD} aria-hidden="true" />
                    <h3 className="text-base font-bold text-[#141c30]" style={{ fontFamily: FONT_DISPLAY }}>
                      {t.summaryOf || "Archival Summary"}
                    </h3>
                    {/* A summary no model wrote, or whose citations failed to
                        validate, must not look like one that did. */}
                    {summaryData.grounded === false && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: "#5a4420", color: "#f3dfa8", fontFamily: FONT_UI }}>
                        {summaryData.gate?.passed === false ? "Insufficient evidence" : "Not model-generated"}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setSummaryData(null)}
                    className="text-xs px-2.5 py-0.5 rounded-full border border-[#c9b98c] hover:bg-[#efe0bb]"
                    style={{ fontFamily: FONT_UI }}
                  >
                    {t.closeSummary || "Close"}
                  </button>
                </div>

                <p className="text-sm text-[#332d20] leading-relaxed" style={{ fontFamily: FONT_BODY }}>
                  {summaryData.summary}
                </p>

                {/* The backend calls them bullets; there is no `key_points`. */}
                {summaryData.bullets?.length > 0 && (
                  <div>
                    <h4 className="text-xs uppercase font-bold tracking-wider text-[#5a4420] mb-2" style={{ fontFamily: FONT_UI }}>
                      {t.keyArchivalFindings || "Key Archival Findings"}
                    </h4>
                    <ul className="space-y-1 text-xs text-[#5a4420]" style={{ fontFamily: FONT_UI }}>
                      {summaryData.bullets.map((pt, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-[#b3862c] font-bold" aria-hidden="true">•</span>
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {summaryData.evidence?.length > 0 && (
                  <details>
                    <summary className="text-[11px] cursor-pointer inline-flex items-center gap-1"
                             style={{ fontFamily: FONT_UI, color: INDIGO }}>
                      <ShieldCheck size={11} /> {t.evidence} ({summaryData.evidence.length})
                    </summary>
                    <div className="mt-2.5 space-y-2.5">
                      {summaryData.evidence.map((ev) => (
                        <EvidenceCard key={ev.id} ev={ev} t={t} onReadArticle={openArticle} />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* Translation */}
            {showTranslateModal && (
              <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Translate document">
                <div className="bg-[#faf4e4] border border-[#d8c79a] rounded-2xl max-w-md w-full p-6 shadow-2xl daic-reveal space-y-4">
                  <div className="flex items-center justify-between border-b border-[#d8c79a] pb-3">
                    <h3 className="text-lg font-bold text-[#141c30]" style={{ fontFamily: FONT_DISPLAY }}>
                      {t.translateDoc || "Translate Document"}
                    </h3>
                    <button
                      onClick={() => setShowTranslateModal(false)}
                      className="text-xs px-2.5 py-1 rounded-full border border-[#c9b98c]"
                      style={{ fontFamily: FONT_UI }}
                    >
                      Close
                    </button>
                  </div>

                  <p className="text-xs text-[#6b6350]" style={{ fontFamily: FONT_UI }}>
                    Select target language for institutional primary translation:
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { code: "hi", label: "Hindi (हिंदी)" },
                      { code: "mr", label: "Marathi (मराठी)" },
                      { code: "kn", label: "Kannada (ಕನ್ನಡ)" },
                      { code: "ta", label: "Tamil (தமிழ்)" },
                    ].map((l) => (
                      <button
                        key={l.code}
                        onClick={() => handleTranslate(l.code)}
                        className="daic-chip p-2.5 rounded-xl border border-[#c9b98c] bg-[#faf4e4] text-xs font-semibold text-left hover:bg-[#f2e2c6] transition-colors"
                        style={{ fontFamily: FONT_UI, color: "#5a4420" }}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>

                  {translating && (
                    <div className="text-xs text-[#8a7f63] text-center py-2" style={{ fontFamily: FONT_UI }}>
                      {t.translating || "Translating…"}
                    </div>
                  )}

                  {translationResult && (
                    <div className="mt-3 p-4 rounded-xl border border-[#d8c79a] bg-[#f4ead0] text-xs space-y-1 daic-reveal" style={{ fontFamily: FONT_UI }}>
                      {translationResult.translated ? (
                        <>
                          <span className="text-[#8a7f63] font-semibold block">Translated Title:</span>
                          <span className="text-sm font-bold text-[#141c30] block">{translationResult.text}</span>
                          {translationResult.provider && (
                            <span className="text-[10px] text-[#8a7f63] block pt-1">via {translationResult.provider}</span>
                          )}
                        </>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="text-[#9c3d2e] font-semibold flex items-center gap-1.5">
                            <AlertCircle size={14} />
                            {t.translationUnavailable || "Translation unavailable"}
                          </div>
                          <p className="text-[#6b6350]">
                            {translationResult.notice || "No translation service is configured on this device."}
                          </p>
                          {translationResult.text && (
                            <p className="text-[#332d20]">
                              <span className="text-[#8a7f63]">Original (English): </span>
                              {translationResult.text}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* The text itself, one printed page at a time */}
            <section aria-label="Document text" className="mb-12">
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <span className="text-[11px] uppercase tracking-widest" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                  {pageData?.section || "Text"}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage(Math.max(firstPage, currentPage - 1))}
                    disabled={currentPage <= firstPage}
                    className="daic-btn w-8 h-8 rounded-lg border border-[#c9b98c] flex items-center justify-center disabled:opacity-40"
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={14} color="#5a4420" />
                  </button>
                  <span className="text-xs px-2" style={{ fontFamily: FONT_UI, color: "#5a4420" }}>
                    {t.page || "Page"} {currentPage} {t.of || "of"} {lastPage}
                  </span>
                  <button
                    onClick={() => setPage(Math.min(lastPage, currentPage + 1))}
                    disabled={currentPage >= lastPage}
                    className="daic-btn w-8 h-8 rounded-lg border border-[#c9b98c] flex items-center justify-center disabled:opacity-40"
                    aria-label="Next page"
                  >
                    <ChevronRight size={14} color="#5a4420" />
                  </button>
                </div>
              </div>

              <AsyncState
                loading={pageLoading}
                error={pageError}
                onRetry={retryPage}
                labels={{ loading: "Turning the page…", error: "That page could not be read." }}
              >
                <article>
                  {pageText.split("\n\n").filter(Boolean).map((para, pi) => {
                    const parts = splitSentences(para);
                    return (
                      <p key={pi} className="text-base md:text-lg mb-5 leading-relaxed" style={{ fontFamily: FONT_BODY, color: "#332d20" }}>
                        {parts.map((s, si) => {
                          const idx = cursor++;
                          const lit = active && reader.sentenceIndex === idx;
                          return (
                            <span key={si} style={{ backgroundColor: lit ? "#f6e3b4" : "transparent", transition: "background-color 200ms" }}>
                              {s}{si < parts.length - 1 ? " " : ""}
                            </span>
                          );
                        })}
                      </p>
                    );
                  })}
                  {!pageText && (
                    <p className="text-sm" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                      No transcribed text is held for this page.
                    </p>
                  )}
                </article>
              </AsyncState>
            </section>

            {/* Passages on this page, each individually citable */}
            {pageData?.passages?.length > 0 && (
              <section aria-label="Evidence">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck size={16} color={GOLD} aria-hidden="true" />
                  <h2 className="text-xl" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>{t.evidence}</h2>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                    style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}
                  >
                    {pageData.passages.length}
                  </span>
                </div>
                <p className="text-xs mb-5" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                  The indexed passages on this page — each with its citation,
                  digitisation status, and the confidence its extractor reported.
                </p>

                <div className="space-y-3">
                  {pageData.passages.map((ev) => (
                    <div key={ev.id}>
                      <EvidenceCard ev={ev} t={t} showRelevance={false} onReadArticle={openArticle} />
                      <div className="mt-1.5 mb-1 pl-1">
                        <ListenControls id={`ev:${ev.id}`} sentences={splitSentences(ev.quote)} lang="en" reader={reader} t={t} compact />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </AsyncState>
    </main>
  );
}

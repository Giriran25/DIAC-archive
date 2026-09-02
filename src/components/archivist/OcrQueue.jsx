import { useState, useEffect, useCallback } from "react";
import {
  ScrollText, CheckCircle2, Edit3, ChevronDown,
  AlertTriangle, Save, Check, X,
} from "lucide-react";
import { api } from "../../lib/api/endpoints.js";
import { FONT_UI, GOLD } from "../../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * OcrQueue — manuscript pages awaiting human review.
 *
 * Wired to the real review loop:
 *   GET  /api/manuscripts              which albums exist
 *   GET  /api/manuscript/{id}          its pages + review status
 *   GET  /api/manuscript/{id}/page/{n} the candidate text for one page
 *   POST /api/manuscript/{id}/review   record a correction
 *   POST /api/manuscript/{id}/approve  make it authoritative and indexed
 *   POST /api/manuscript/{id}/reject   withdraw it
 *
 * There is no /api/ocr/queue, /api/ocr/correct or /api/ocr/approve on the
 * backend — this screen used to call all three and every action 404'd.
 * ---------------------------------------------------------------------- */

const REVIEWER = "archivist";

/* The backend returns ocrConfidence = null whenever no recogniser produced
   a score — which is the normal case here, because the candidate text
   comes from the publisher's own PDF text layer rather than an OCR engine
   we ran. Rendering null as 0% would invent a terrible score where none
   exists, so it is shown as "not scored" instead. */
function ConfidenceBadge({ confidence, engine }) {
  if (confidence == null) {
    return (
      <span
        className="text-[10px] px-2.5 py-0.5 rounded-full border border-[#c9b98c] text-[#5a4420] bg-[#f4ead0] whitespace-nowrap"
        style={{ fontFamily: FONT_UI }}
        title={
          engine === "pdf_text_layer"
            ? "Text read from the source PDF's own text layer. No recogniser ran, so there is no confidence score."
            : "No confidence score was reported for this page."
        }
      >
        Not scored
      </span>
    );
  }
  const pct = Math.round(confidence * 100);
  return (
    <span
      className="text-[10px] px-2.5 py-0.5 rounded-full text-white font-bold whitespace-nowrap"
      style={{
        backgroundColor: pct >= 95 ? "#2f4a33" : pct >= 85 ? "#5a4420" : "#9c3d2e",
        fontFamily: FONT_UI,
      }}
    >
      {pct}%
    </span>
  );
}

export default function OcrQueue() {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState({});      // "msId:page" -> page object
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await api.manuscripts();
      const awaiting = [];
      for (const ms of list.manuscripts || []) {
        const full = await api.manuscript(ms.id);
        for (const page of full.pages || []) {
          if (page.reviewStatus === "pending" || page.reviewStatus === "in_review") {
            awaiting.push({ ...page, manuscriptTitle: full.manuscript?.title || ms.title });
          }
        }
      }
      setPages(awaiting);
    } catch (err) {
      setLoadError(err?.message || "The review queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const keyOf = (p) => `${p.manuscriptId}:${p.page}`;

  const toggle = async (page) => {
    const key = keyOf(page);
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (detail[key]) return;
    try {
      const res = await api.manuscriptPage(page.manuscriptId, page.page);
      setDetail((d) => ({ ...d, [key]: res.page }));
    } catch {
      setDetail((d) => ({ ...d, [key]: { error: "This page's text could not be loaded." } }));
    }
  };

  const startEdit = (page) => {
    const d = detail[keyOf(page)] || {};
    setEditing(keyOf(page));
    setDraft(d.correctedText || d.ocrText || "");
    setNote("");
  };

  const act = async (page, fn, message) => {
    setBusy(true);
    setFeedback(null);
    try {
      await fn();
      setFeedback({ type: "success", message });
      setEditing(null);
      await loadQueue();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err?.detail?.detail || err?.message || "The archive rejected that action.",
      });
    } finally {
      setBusy(false);
    }
  };

  const saveCorrection = (page) =>
    act(page,
      () => api.reviewPage(page.manuscriptId, {
        page: page.page, corrected_text: draft, note: note || null, reviewer: REVIEWER,
      }),
      "Correction recorded. The page is still awaiting approval.");

  const approve = (page) =>
    act(page,
      () => api.approvePage(page.manuscriptId, { page: page.page, reviewer: REVIEWER, note: note || null }),
      "Page approved. It is now part of the archive and searchable.");

  const reject = (page) =>
    act(page,
      () => api.rejectPage(page.manuscriptId, { page: page.page, reviewer: REVIEWER, note: note || null }),
      "Page rejected and withdrawn from the archive.");

  if (loading) {
    return (
      <p className="text-sm text-[#8a7f63] py-8 text-center" style={{ fontFamily: FONT_UI }} role="status">
        Loading pages awaiting review…
      </p>
    );
  }

  if (loadError) {
    return (
      <div className="p-4 rounded-xl border border-[#9c3d2e] bg-[#f9ecea] text-[#9c3d2e] text-sm flex items-start gap-2"
           style={{ fontFamily: FONT_UI }} role="alert">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">The review queue is unavailable.</p>
          <p className="mt-1 text-xs">{loadError}</p>
          <button onClick={loadQueue} className="mt-2 text-xs underline">Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {feedback && (
        <div
          role="status"
          className={`p-4 rounded-xl border flex items-center justify-between text-xs ${
            feedback.type === "success"
              ? "bg-[#eaf1e6] border-[#2f4a33] text-[#2f4a33]"
              : "bg-[#f9ecea] border-[#9c3d2e] text-[#9c3d2e]"
          }`}
          style={{ fontFamily: FONT_UI }}
        >
          <span className="flex items-center gap-2 font-semibold">
            {feedback.type === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            {feedback.message}
          </span>
          <button onClick={() => setFeedback(null)} className="underline">Dismiss</button>
        </div>
      )}

      {pages.length === 0 ? (
        <p className="text-sm text-[#8a7f63] py-10 text-center" style={{ fontFamily: FONT_UI }}>
          No manuscript pages are awaiting review.
        </p>
      ) : (
        <div className="space-y-3">
          {pages.map((page) => {
            const key = keyOf(page);
            const isOpen = expanded === key;
            const isEditing = editing === key;
            const d = detail[key];

            return (
              <div key={key} className="daic-card rounded-xl border border-[#d8c79a] bg-[#faf4e4] overflow-hidden">
                <button
                  onClick={() => toggle(page)}
                  className="w-full flex items-center justify-between p-4 gap-3 text-left min-h-[56px]"
                  aria-expanded={isOpen}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <ScrollText size={16} color={GOLD} className="shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm truncate font-semibold text-[#141c30]" style={{ fontFamily: FONT_UI }}>
                        {page.manuscriptTitle} — page {page.page}
                      </span>
                      <span className="block text-[11px] text-[#8a7f63]" style={{ fontFamily: FONT_UI }}>
                        {page.ocrEngine ? `via ${page.ocrEngine}` : "no candidate text yet"}
                        {" · "}{page.reviewStatus}
                      </span>
                    </span>
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    <ConfidenceBadge confidence={page.ocrConfidence} engine={page.ocrEngine} />
                    <ChevronDown size={14} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 200ms ease" }} />
                  </span>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 space-y-3">
                    {!d ? (
                      <p className="text-xs text-[#8a7f63]" style={{ fontFamily: FONT_UI }}>Loading page…</p>
                    ) : d.error ? (
                      <p className="text-xs text-[#9c3d2e]" style={{ fontFamily: FONT_UI }}>{d.error}</p>
                    ) : isEditing ? (
                      <div className="p-4 rounded-xl bg-[#f4ead0] border border-[#d8c79a] space-y-3">
                        <label className="block">
                          <span className="text-[10px] uppercase font-bold text-[#5a4420] block mb-1" style={{ fontFamily: FONT_UI }}>
                            Corrected transcription
                          </span>
                          <textarea
                            rows={6}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            className="w-full p-3 rounded-lg border border-[#c9b98c] bg-[#fffdfa] text-xs font-mono outline-none focus:border-[#b3862c]"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] uppercase font-bold text-[#5a4420] block mb-1" style={{ fontFamily: FONT_UI }}>
                            Provenance note
                          </span>
                          <input
                            type="text"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="e.g. checked against the 1944 second impression"
                            className="w-full p-2.5 rounded-lg border border-[#c9b98c] bg-[#fffdfa] text-xs outline-none focus:border-[#b3862c]"
                            style={{ fontFamily: FONT_UI }}
                          />
                        </label>
                        <div className="flex justify-end gap-2 pt-1">
                          <button onClick={() => setEditing(null)} disabled={busy}
                            className="text-xs px-4 py-2 rounded-full border border-[#c9b98c] min-h-[40px]"
                            style={{ fontFamily: FONT_UI }}>
                            Cancel
                          </button>
                          <button onClick={() => saveCorrection(page)} disabled={busy || !draft.trim()}
                            className="daic-btn text-xs px-4 py-2 rounded-full bg-[#1c2c4d] text-[#f4ead0] font-semibold flex items-center gap-1.5 min-h-[40px] disabled:opacity-50"
                            style={{ fontFamily: FONT_UI }}>
                            <Save size={12} /> Save correction
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="rounded-md bg-[#f2e2c6] p-3 font-mono text-[11px] text-[#5a4420] leading-relaxed max-h-56 overflow-y-auto">
                          <p className="uppercase tracking-wider text-[10px] font-bold text-[#8a7f63] mb-1" style={{ fontFamily: FONT_UI }}>
                            Candidate text {page.ocrEngine ? `(${page.ocrEngine})` : ""}
                          </p>
                          {d.authoritativeText || d.ocrText || "No candidate text for this page."}
                        </div>

                        <div className="flex flex-wrap justify-end gap-2 pt-1">
                          <button onClick={() => startEdit(page)} disabled={busy}
                            className="daic-btn text-xs px-4 py-2 rounded-full border border-[#c9b98c] bg-[#faf4e4] text-[#5a4420] flex items-center gap-1.5 min-h-[40px]"
                            style={{ fontFamily: FONT_UI }}>
                            <Edit3 size={12} /> Correct
                          </button>
                          <button onClick={() => reject(page)} disabled={busy}
                            className="daic-btn text-xs px-4 py-2 rounded-full border border-[#9c3d2e] text-[#9c3d2e] flex items-center gap-1.5 min-h-[40px]"
                            style={{ fontFamily: FONT_UI }}>
                            <X size={12} /> Reject
                          </button>
                          <button onClick={() => approve(page)} disabled={busy || !(d.authoritativeText || d.ocrText)}
                            className="daic-btn text-xs px-4 py-2 rounded-full bg-[#2f4a33] text-white flex items-center gap-1.5 font-semibold min-h-[40px] disabled:opacity-50"
                            style={{ fontFamily: FONT_UI }}>
                            <Check size={12} /> Approve &amp; index
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

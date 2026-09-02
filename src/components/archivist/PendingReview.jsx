import { useState, useEffect } from "react";
import {
  CheckCircle2, XCircle, AlertTriangle, Eye,
} from "lucide-react";
import { LoadingState, ErrorState, EmptyState } from "../ui/AsyncState.jsx";
import { api } from "../../lib/api/endpoints.js";
import {
  FONT_DISPLAY, FONT_UI, FONT_BODY,
} from "../../lib/tokens.js";

/* ---------------------------------------------------------------------- */
/* PendingReview — Archivist Ingestion Review & Approval Workflow           */
/* ---------------------------------------------------------------------- */

export default function PendingReview({ t }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionFeedback, setActionFeedback] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const loadPending = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const res = await api.pending();
      setItems(res.items || []);
    } catch (err) {
      /* A queue that failed to load must not read as an empty queue: an
         archivist would conclude there was nothing left to review. */
      setLoadError(err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPending();
  }, []);

  const handleApprove = async (id) => {
    try {
      const res = await api.approveItem(id);
      setActionFeedback({ type: "success", message: res.message || t.approvedNotice });
      setSelectedItem(null);
      await loadPending();
    } catch (err) {
      /* The item was NOT approved: say why rather than a bare failure. */
      setActionFeedback({ type: "error", message: err?.userMessage || "Approval failed." });
    }
  };

  const handleRejectSubmit = async (e) => {
    e.preventDefault();
    if (!rejectingId) return;
    try {
      const res = await api.rejectItem(rejectingId, { reason: rejectReason });
      setActionFeedback({ type: "warning", message: res.message || t.rejectedNotice });
      setRejectingId(null);
      setRejectReason("");
      setSelectedItem(null);
      await loadPending();
    } catch (err) {
      setActionFeedback({ type: "error", message: err?.userMessage || "Rejection failed." });
    }
  };

  return (
    <div className="space-y-6 daic-reveal">
      {/* Feedback Banner */}
      {actionFeedback && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between gap-3 text-xs daic-reveal ${
            actionFeedback.type === "success"
              ? "bg-[#eaf1e6] border-[#2f4a33] text-[#2f4a33]"
              : actionFeedback.type === "warning"
              ? "bg-[#fdf4e7] border-[#b3862c] text-[#5a4420]"
              : "bg-[#fbeae8] border-[#9c3d2e] text-[#9c3d2e]"
          }`}
          style={{ fontFamily: FONT_UI }}
        >
          <div className="flex items-center gap-2">
            {actionFeedback.type === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span className="font-semibold">{actionFeedback.message}</span>
          </div>
          <button
            onClick={() => setActionFeedback(null)}
            className="underline hover:no-underline font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Submissions List */}
      {loading && <LoadingState label="Reading the intake queue…" />}
      {!loading && loadError && (
        <ErrorState error={loadError} onRetry={loadPending} label="The intake queue could not be read." />
      )}
      {!loading && !loadError && items.length === 0 && (
        <EmptyState label="Nothing is awaiting review." hint="Ingested documents appear here until an archivist approves or rejects them." />
      )}

      <div className="space-y-4">
        {items.map((item) => {
           /* Keep compatibility with the mock's older label while accepting
             the backend's explicit pending_review status. */
           const isPending = item.status === "pending" || item.status === "pending_review";
           const statusLabel = item.status === "pending_review" ? "Pending review" : item.status;
          return (
            <div
              key={item.id}
              className={`daic-card p-6 rounded-xl border transition-all ${
                isPending
                  ? "bg-[#faf4e4] border-[#d8c79a]"
                  : item.status === "indexed"
                  ? "bg-[#f4f7f2] border-[#2f4a33]/40 opacity-80"
                  : "bg-[#fbf4f4] border-[#9c3d2e]/30 opacity-70"
              }`}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1 max-w-2xl">
                  <div className="flex items-center gap-2 flex-wrap text-xs" style={{ fontFamily: FONT_UI }}>
                    <span className="px-2 py-0.5 rounded-full bg-[#efe0bb] text-[#5a4420] font-semibold">
                      {item.detectedType}
                    </span>
                    <span className="text-[#8a7f63]">{item.submittedAt}</span>
                    <span className="text-[#8a7f63]">· by {item.submittedBy}</span>
                    <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${
                      item.status === "indexed"
                        ? "bg-[#2f4a33] text-white"
                        : item.status === "rejected"
                        ? "bg-[#9c3d2e] text-white"
                        : "bg-[#b3862c] text-white"
                    }`}>
                      {statusLabel}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-[#141c30]" style={{ fontFamily: FONT_DISPLAY }}>
                    {item.title}
                  </h3>
                  <p className="text-xs text-[#6b6350] line-clamp-2" style={{ fontFamily: FONT_UI }}>
                    {item.metadata?.description || item.note || item.filename}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    /* The list omits the extracted text; the detail endpoint
                       carries it, so open the item rather than showing a
                       blank excerpt. */
                    onClick={async () => {
                      setSelectedItem(item);
                      try {
                        const res = await api.archivistItem(item.id);
                        if (res?.item) setSelectedItem(res.item);
                      } catch { /* keep the list row; the excerpt stays absent */ }
                    }}
                    className="daic-btn text-xs px-3 py-1.5 rounded-full border border-[#c9b98c] bg-[#faf4e4] text-[#5a4420] flex items-center gap-1 hover:bg-[#f2e2c6]"
                    style={{ fontFamily: FONT_UI }}
                  >
                    <Eye size={12} /> {t.reviewAction || "Review"}
                  </button>

                  {isPending && (
                    <>
                      <button
                        onClick={() => handleApprove(item.id)}
                        className="daic-btn text-xs px-3 py-1.5 rounded-full bg-[#2f4a33] text-white hover:opacity-90 flex items-center gap-1 font-semibold"
                        style={{ fontFamily: FONT_UI }}
                      >
                        <CheckCircle2 size={12} /> {t.approveAction || "Approve"}
                      </button>
                      <button
                        onClick={() => {
                          setRejectingId(item.id);
                          setRejectReason("");
                        }}
                        className="daic-btn text-xs px-3 py-1.5 rounded-full bg-[#9c3d2e] text-white hover:opacity-90 flex items-center gap-1 font-semibold"
                        style={{ fontFamily: FONT_UI }}
                      >
                        <XCircle size={12} /> {t.rejectAction || "Reject"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {item.note && item.status === "rejected" && (
                <div className="mt-3 p-3 rounded-lg bg-[#fbeae8] border border-[#9c3d2e]/30 text-xs text-[#9c3d2e]" style={{ fontFamily: FONT_UI }}>
                  <span className="font-semibold">Rejection Reason: </span>
                  {item.note}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Review Modal / Drawer */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-[#faf4e4] border border-[#d8c79a] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 md:p-8 shadow-2xl daic-reveal space-y-6">
            <div className="flex items-center justify-between border-b border-[#d8c79a] pb-4">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-[#b3862c] block mb-0.5" style={{ fontFamily: FONT_UI }}>
                  Submission Details
                </span>
                <h3 className="text-xl font-bold text-[#141c30]" style={{ fontFamily: FONT_DISPLAY }}>
                  {selectedItem.title}
                </h3>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="text-xs px-2.5 py-1 rounded-full border border-[#c9b98c] hover:bg-[#f2e2c6]"
                style={{ fontFamily: FONT_UI }}
              >
                Close
              </button>
            </div>

            {/* Metadata Fields */}
            <div className="grid sm:grid-cols-2 gap-3 text-xs" style={{ fontFamily: FONT_UI }}>
              <div className="p-3 rounded-lg bg-[#f4ead0]/70 border border-[#e6d9b3]">
                <span className="text-[#8a7f63] block mb-0.5">Author / Speaker</span>
                <span className="font-semibold text-[#141c30]">{selectedItem.metadata?.author || "N/A"}</span>
              </div>
              <div className="p-3 rounded-lg bg-[#f4ead0]/70 border border-[#e6d9b3]">
                <span className="text-[#8a7f63] block mb-0.5">Historical Date</span>
                <span className="font-semibold text-[#141c30]">{selectedItem.metadata?.date_text || selectedItem.metadata?.date || "N/A"}</span>
              </div>
              <div className="p-3 rounded-lg bg-[#f4ead0]/70 border border-[#e6d9b3]">
                <span className="text-[#8a7f63] block mb-0.5">Archival Source</span>
                <span className="font-semibold text-[#141c30]">{selectedItem.metadata?.source || "N/A"}</span>
              </div>
              <div className="p-3 rounded-lg bg-[#f4ead0]/70 border border-[#e6d9b3]">
                <span className="text-[#8a7f63] block mb-0.5">Collection</span>
                <span className="font-semibold text-[#141c30]">{selectedItem.metadata?.collection || "N/A"}</span>
              </div>
            </div>

            {/* Extracted Preview Text */}
            <div>
              <h4 className="text-xs uppercase font-bold tracking-wider text-[#5a4420] mb-2" style={{ fontFamily: FONT_UI }}>
                Extracted Raw Text Excerpt
              </h4>
              <div className="p-4 rounded-xl bg-[#f4ead0] border border-[#d8c79a] font-serif text-sm leading-relaxed text-[#332d20]" style={{ fontFamily: FONT_BODY }}>
                {selectedItem.preview || "No text was extracted from this file."}
              </div>
            </div>

            {/* Actions in Modal */}
            {(selectedItem.status === "pending" || selectedItem.status === "pending_review") && (
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#d8c79a]">
                <button
                  onClick={() => {
                    setRejectingId(selectedItem.id);
                    setRejectReason("");
                  }}
                  className="daic-btn text-xs px-4 py-2 rounded-full bg-[#9c3d2e] text-white hover:opacity-90 font-semibold"
                  style={{ fontFamily: FONT_UI }}
                >
                  Reject Submission
                </button>
                <button
                  onClick={() => handleApprove(selectedItem.id)}
                  className="daic-btn text-xs px-4 py-2 rounded-full bg-[#2f4a33] text-white hover:opacity-90 font-semibold"
                  style={{ fontFamily: FONT_UI }}
                >
                  Approve & Promote to Archive
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reject Reason Dialog */}
      {rejectingId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleRejectSubmit}
            className="bg-[#faf4e4] border border-[#d8c79a] rounded-2xl max-w-md w-full p-6 shadow-2xl daic-reveal space-y-4"
          >
            <h3 className="text-lg font-bold text-[#9c3d2e]" style={{ fontFamily: FONT_DISPLAY }}>
              Reject Archival Submission
            </h3>
            <p className="text-xs text-[#6b6350]" style={{ fontFamily: FONT_UI }}>
              Please specify the reason for rejecting this document from canonical ingestion:
            </p>
            <textarea
              required
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. OCR quality insufficient, citation unconfirmed against 1944 edition."
              className="w-full p-3 rounded-lg border border-[#c9b98c] bg-[#fffdfa] text-xs outline-none focus:border-[#b3862c]"
              style={{ fontFamily: FONT_UI }}
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectingId(null)}
                className="text-xs px-3 py-1.5 rounded-full border border-[#c9b98c]"
                style={{ fontFamily: FONT_UI }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="text-xs px-4 py-1.5 rounded-full bg-[#9c3d2e] text-white font-semibold"
                style={{ fontFamily: FONT_UI }}
              >
                Confirm Rejection
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

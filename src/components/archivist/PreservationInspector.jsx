import { useState, useCallback } from "react";
import {
  CheckCircle2, AlertTriangle, RefreshCw,
  FileCode, Server, HelpCircle,
} from "lucide-react";
import AsyncState from "../ui/AsyncState.jsx";
import { api } from "../../lib/api/endpoints.js";
import { useArchive } from "../../lib/api/useArchive.js";
import { ApiError } from "../../lib/api/client.js";
import {
  FONT_DISPLAY, FONT_UI,
  GOLD, INKTEXT,
} from "../../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * PreservationInspector — integrity checks, reported as they came back.
 *
 * The previous version marked a document "Checksum Verified" the moment the
 * request resolved, without reading the answer. A genuine CHECKSUM MISMATCH
 * — a file altered since ingestion, the exact thing this panel exists to
 * catch — would have been displayed as a pass. The verdict shown is now the
 * backend's `verified` flag and its reason, and an unverified document is
 * shown as unchecked rather than as failed.
 * ---------------------------------------------------------------------- */

const STATE = { UNKNOWN: "unknown", VERIFIED: "verified", FAILED: "failed" };

export default function PreservationInspector({ t }) {
  const [verifyingId, setVerifyingId] = useState(null);
  const [results, setResults] = useState({}); // documentId -> outcome
  const [feedback, setFeedback] = useState(null);

  /* Documents first; a preservation record is fetched per document. */
  const listFetcher = useCallback((signal) => api.archive(undefined, { signal }), []);
  const { data: list, loading, error, retry } = useArchive(listFetcher, []);
  const documents = list?.documents ?? [];

  const handleVerify = async (documentId) => {
    try {
      setVerifyingId(documentId);
      const outcome = await api.verifyPreservation(documentId);
      setResults((prev) => ({ ...prev, [documentId]: outcome }));
      setFeedback({
        ok: outcome.verified === true,
        message: outcome.reason
          || (outcome.verified ? "Checksum matches the ingestion record." : "Checksum could not be confirmed."),
      });
    } catch (err) {
      setResults((prev) => ({ ...prev, [documentId]: null }));
      setFeedback({
        ok: false,
        message: err instanceof ApiError ? err.userMessage : "The integrity check could not be run.",
      });
    } finally {
      setVerifyingId(null);
    }
  };

  /* Unknown is a real state and must look like one: until a check has run in
     this session, the panel claims nothing about the file on disk. */
  const stateOf = (doc) => {
    const r = results[doc.id];
    if (r === undefined) return STATE.UNKNOWN;
    if (r && r.verified === true) return STATE.VERIFIED;
    return STATE.FAILED;
  };

  const BADGE = {
    [STATE.VERIFIED]: { cls: "bg-[#2f4a33] text-white", icon: <CheckCircle2 size={12} />, label: t.checksumVerified || "Checksum verified" },
    [STATE.FAILED]: { cls: "bg-[#9c3d2e] text-white", icon: <AlertTriangle size={12} />, label: "Checksum not confirmed" },
    [STATE.UNKNOWN]: { cls: "bg-[#8a7f63] text-white", icon: <HelpCircle size={12} />, label: "Not checked this session" },
  };

  return (
    <div className="space-y-6 daic-reveal">
      {feedback && (
        <div
          className="p-4 rounded-xl border flex items-center justify-between gap-3 text-xs"
          style={{
            fontFamily: FONT_UI,
            backgroundColor: feedback.ok ? "#eaf1e6" : "#f7e6e2",
            borderColor: feedback.ok ? "#2f4a33" : "#9c3d2e",
            color: feedback.ok ? "#2f4a33" : "#8a3a22",
          }}
          role="status"
        >
          <div className="flex items-center gap-2">
            {feedback.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span className="font-semibold">{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="underline shrink-0">Dismiss</button>
        </div>
      )}

      <AsyncState
        loading={loading}
        error={error}
        empty={documents.length === 0}
        onRetry={retry}
        labels={{
          loading: "Reading the preservation records…",
          error: "The preservation records could not be read.",
          empty: "Nothing has been ingested into the archive yet.",
        }}
      >
        <div className="space-y-4">
          {documents.map((doc) => {
            const state = stateOf(doc);
            const badge = BADGE[state];
            const outcome = results[doc.id];
            return (
              <div key={doc.id} className="daic-card p-6 rounded-2xl border border-[#d8c79a] bg-[#faf4e4] space-y-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs flex-wrap" style={{ fontFamily: FONT_UI }}>
                      <span className="px-2 py-0.5 rounded-full bg-[#efe0bb] text-[#5a4420] font-semibold">
                        {doc.verificationStatus || "unverified"}
                      </span>
                      {doc.byteSize != null && (
                        <span className="text-[#8a7f63]">{(doc.byteSize / 1048576).toFixed(1)} MB</span>
                      )}
                      {doc.extractionMethod && (
                        <span className="text-[#8a7f63]">· {doc.extractionMethod}</span>
                      )}
                    </div>
                    <h3 className="text-lg font-bold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
                      {doc.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-xs px-3 py-1 rounded-full font-bold uppercase inline-flex items-center gap-1.5 ${badge.cls}`}
                      style={{ fontFamily: FONT_UI }}
                    >
                      {badge.icon} {badge.label}
                    </span>

                    <button
                      onClick={() => handleVerify(doc.id)}
                      disabled={verifyingId === doc.id}
                      className="daic-btn text-xs px-3 py-1.5 rounded-full border border-[#c9b98c] bg-[#faf4e4] text-[#5a4420] flex items-center gap-1 hover:bg-[#f2e2c6] disabled:opacity-50"
                      style={{ fontFamily: FONT_UI }}
                    >
                      <RefreshCw size={11} className={verifyingId === doc.id ? "daic-spin" : ""} aria-hidden="true" />
                      {verifyingId === doc.id ? "Verifying…" : t.verifyChecksum || "Verify Checksum"}
                    </button>
                  </div>
                </div>

                {/* Checksums, with the recomputed one beside the recorded one
                    whenever a check has actually run. */}
                <div className="grid sm:grid-cols-2 gap-3 text-xs" style={{ fontFamily: FONT_UI }}>
                  <div className="p-3 rounded-lg bg-[#f4ead0]/70 border border-[#e6d9b3]">
                    <span className="text-[#8a7f63] mb-1 font-semibold flex items-center gap-1">
                      <FileCode size={12} color={GOLD} aria-hidden="true" /> SHA-256 Master Checksum
                    </span>
                    <span className="font-mono text-[11px] text-[#5a4420] break-all block">
                      {outcome?.expected || doc.checksum || "not recorded"}
                    </span>
                    {outcome?.actual && outcome.actual !== outcome.expected && (
                      <>
                        <span className="text-[#9c3d2e] mt-2 mb-1 font-semibold block">Recomputed from disk</span>
                        <span className="font-mono text-[11px] text-[#9c3d2e] break-all block">
                          {outcome.actual}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="p-3 rounded-lg bg-[#f4ead0]/70 border border-[#e6d9b3] space-y-1">
                    <span className="text-[#8a7f63] font-semibold flex items-center gap-1">
                      <Server size={12} color={GOLD} aria-hidden="true" /> Stored file
                    </span>
                    <span className="text-[#141c30] font-medium block break-all">
                      {doc.filename || "filename not recorded"}
                    </span>
                    <span className="text-[10px] text-[#8a7f63] block">
                      {doc.createdAt ? `Ingested: ${doc.createdAt}` : "Ingestion date not recorded"}
                      {doc.licence ? ` · ${doc.licence}` : ""}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </AsyncState>
    </div>
  );
}

import { useCallback } from "react";
import { GitCommit, User, Calendar, Info } from "lucide-react";
import AsyncState from "../ui/AsyncState.jsx";
import { api } from "../../lib/api/endpoints.js";
import { useArchive } from "../../lib/api/useArchive.js";
import {
  FONT_DISPLAY, FONT_UI,
  INKTEXT,
} from "../../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * VersionHistory — what the archive actually keeps.
 *
 * There is no version control here and no /api/archivist/versions endpoint.
 * This panel used to show hardcoded release cards ("v2.1 · Published") that
 * described a system nobody built, which is worse than showing nothing: an
 * archivist could have believed a document had been revised and republished.
 *
 * What the archive really keeps is an append-only ingestion trail: who did
 * what to which document, and when, with no row ever edited or deleted. That
 * is what is shown, and the panel says outright that it is not a version
 * history.
 * ---------------------------------------------------------------------- */

export default function VersionHistory() {
  const fetcher = useCallback((signal) => api.auditLog({ limit: 100 }, { signal }), []);
  const { data, loading, error, retry } = useArchive(fetcher, []);

  const entries = data?.entries ?? [];

  return (
    <div className="space-y-6 daic-reveal">
      {/* Say what this is, so nobody reads it as something it is not. */}
      <div
        className="p-4 rounded-xl border text-xs leading-relaxed flex gap-2.5"
        style={{ backgroundColor: "#f3ecd8", borderColor: "#d8c79a", color: "#5a4420", fontFamily: FONT_UI }}
      >
        <Info size={15} className="shrink-0 mt-0.5" style={{ color: "#8a7f63" }} aria-hidden="true" />
        <p>
          <span className="font-semibold">The archive keeps no version history.</span>{" "}
          Documents are not revised and republished; they are ingested once and
          then corrected through the review loop. What follows is the
          append-only ingestion trail — every entry is written once and never
          edited or removed.
        </p>
      </div>

      <AsyncState
        loading={loading}
        error={error}
        empty={entries.length === 0}
        onRetry={retry}
        labels={{
          loading: "Reading the ingestion trail…",
          error: "The ingestion trail could not be read.",
          empty: "Nothing has been ingested into the archive yet.",
        }}
      >
        <div className="space-y-4">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="daic-card p-5 rounded-xl border border-[#d8c79a] bg-[#faf4e4] space-y-3"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#1c2c4d] text-[#f4ead0] font-bold font-mono">
                    #{entry.id}
                  </span>
                  <h4 className="text-base font-bold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
                    {entry.action}
                  </h4>
                </div>
                {entry.document_id && (
                  <span className="text-[10px] uppercase px-2 py-0.5 rounded-full font-bold bg-[#efe0bb] text-[#5a4420] font-mono">
                    {entry.document_id}
                  </span>
                )}
              </div>

              {entry.detail && (
                <p className="text-xs text-[#5a4420] font-medium" style={{ fontFamily: FONT_UI }}>
                  {entry.detail}
                </p>
              )}

              <div className="flex items-center gap-4 text-[11px] text-[#8a7f63] border-t border-[#e6d9b3] pt-2.5 flex-wrap" style={{ fontFamily: FONT_UI }}>
                <span className="inline-flex items-center gap-1">
                  <User size={12} aria-hidden="true" /> {entry.actor || "unattributed"}
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <Calendar size={12} aria-hidden="true" /> {entry.ts}
                </span>
                <span className="inline-flex items-center gap-1 ml-auto">
                  <GitCommit size={12} aria-hidden="true" /> append-only
                </span>
              </div>
            </div>
          ))}
        </div>
      </AsyncState>
    </div>
  );
}

import { useState, useCallback, useMemo } from "react";
import { Search, ShieldCheck } from "lucide-react";
import AsyncState from "../ui/AsyncState.jsx";
import { api } from "../../lib/api/endpoints.js";
import { useArchive } from "../../lib/api/useArchive.js";
import { FONT_UI, GOLD } from "../../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * AuditLogViewer — the append-only ingestion trail.
 *
 * The table used to carry an "Action Result" column reading Success or
 * Rejected. The archive records no result: a row in `ingest_log` is written
 * when something happens, and a failure that never wrote a row cannot be
 * shown as one that did. Every column here maps to a real stored field.
 * ---------------------------------------------------------------------- */

export default function AuditLogViewer() {
  const [search, setSearch] = useState("");

  const fetcher = useCallback((signal) => api.auditLog({ limit: 200 }, { signal }), []);
  const { data, loading, error, retry } = useArchive(fetcher, []);

  const entries = useMemo(() => data?.entries ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((l) =>
      [l.actor, l.action, l.document_id, l.detail]
        .some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [entries, search]);

  return (
    <div className="space-y-6 daic-reveal">
      {/* Search */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 bg-[#faf4e4] border border-[#c9b98c] rounded-full px-4 py-1.5 w-full sm:w-80 shadow-sm">
          <Search size={14} color={GOLD} aria-hidden="true" />
          <input
            type="text"
            placeholder="Search audit events, actors, actions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent outline-none text-xs"
            style={{ fontFamily: FONT_UI }}
            aria-label="Search the ingestion trail"
          />
        </div>
        <span className="text-xs text-[#8a7f63] inline-flex items-center gap-1.5" style={{ fontFamily: FONT_UI }}>
          <ShieldCheck size={12} color={GOLD} aria-hidden="true" />
          {data?.appendOnly ? "Append-only · " : ""}
          Showing {filtered.length} of {data?.total ?? 0} records
        </span>
      </div>

      <AsyncState
        loading={loading}
        error={error}
        empty={filtered.length === 0}
        onRetry={retry}
        labels={{
          loading: "Reading the ingestion trail…",
          error: "The ingestion trail could not be read.",
          empty: search
            ? "No trail entry matches that search."
            : "Nothing has been ingested into the archive yet.",
        }}
      >
        <div className="rounded-xl border border-[#d8c79a] bg-[#faf4e4] overflow-x-auto">
          <table className="w-full text-xs min-w-[700px]" style={{ fontFamily: FONT_UI }}>
            <caption className="sr-only">Append-only archive ingestion trail</caption>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide border-b border-[#d8c79a] bg-[#f4ead0]/60 text-[#5a4420]">
                <th scope="col" className="p-3.5">Timestamp</th>
                <th scope="col" className="p-3.5">Actor</th>
                <th scope="col" className="p-3.5">Action</th>
                <th scope="col" className="p-3.5">Target Item</th>
                <th scope="col" className="p-3.5">Detail</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id} className="border-b border-[#e6d9b3]/60 hover:bg-[#f5ebd4] transition-colors">
                  <td className="p-3.5 text-[#8a7f63] font-mono whitespace-nowrap">{l.ts}</td>
                  <td className="p-3.5">
                    <span className="px-2 py-0.5 rounded-full bg-[#efe0bb] text-[#5a4420] font-semibold">
                      {l.actor || "unattributed"}
                    </span>
                  </td>
                  <td className="p-3.5 font-bold text-[#141c30]">{l.action}</td>
                  <td className="p-3.5 font-mono text-[#5a4420] max-w-[200px] truncate">
                    {l.document_id || "—"}
                  </td>
                  <td className="p-3.5 text-[#5a4420] max-w-[280px]">{l.detail || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AsyncState>
    </div>
  );
}

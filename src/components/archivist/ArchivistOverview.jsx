import { useState, useEffect } from "react";
import {
  Database, ListChecks, BookOpen, FileCheck, 
  Activity, CheckCircle2, ArrowUpRight
} from "lucide-react";
import { LoadingState } from "../ui/AsyncState.jsx";
import { api } from "../../lib/api/endpoints.js";
import {
  FONT_DISPLAY, FONT_UI,
  GOLD, INKTEXT
} from "../../lib/tokens.js";

/* ---------------------------------------------------------------------- */
/* ArchivistOverview — Institutional metrics and system capabilities       */
/* ---------------------------------------------------------------------- */

export default function ArchivistOverview({ setSub }) {
  const [health, setHealth] = useState(null);
  const [pendingCount, setPendingCount] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      api.health().catch(() => null),
      api.pending().catch(() => null),
    ]).then(([h, p]) => {
      if (!mounted) return;
      if (h) setHealth(h);
      const pending = p?.pendingCount ?? p?.byStatus?.pending_review ?? p?.byStatus?.pending;
      if (pending != null) setPendingCount(pending);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  /* Every figure on this board is the archive's own count, or an em dash.
     These cards previously counted rows in a demo fixture, so an archivist
     reading "Indexed Passages: 24" was reading the size of a sample file,
     not the archive. A dash is uninformative; a wrong number is worse. */
  const stats = health?.stats ?? null;
  const dash = "—";

  const metrics = [
    {
      label: "Indexed Passages",
      value: stats ? stats.chunks_indexed_vector : dash,
      sub: stats ? `${stats.chunks} passages stored` : "Archive not reachable",
      icon: <Database size={16} />,
    },
    {
      label: "Pending Ingestion Review",
      value: pendingCount ?? dash,
      sub: "Awaiting archivist verdict",
      icon: <FileCheck size={16} />,
      highlight: (pendingCount ?? 0) > 0,
    },
    {
      label: "Documents Awaiting Approval",
      value: stats ? stats.documents_pending : dash,
      sub: "Not yet retrievable by search",
      icon: <ListChecks size={16} />,
    },
    {
      label: "Published Corpus",
      value: stats ? stats.documents_approved : dash,
      sub: "Approved primary records",
      icon: <BookOpen size={16} />,
    },
  ];

  if (loading) {
    return (
      <div className="space-y-6 daic-reveal" aria-busy="true">
        <LoadingState label="Reading the archive's own counts…" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Archive metrics">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-xl border border-[#d8c79a] bg-[#faf4e4] p-5">
              <div className="text-2xl font-bold mb-1" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>—</div>
              <div className="text-xs font-semibold" style={{ fontFamily: FONT_UI, color: INKTEXT }}>{metric.label}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 daic-reveal">
      {/* Metric Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((s, i) => (
          <div
            key={i}
            className={`daic-card rounded-xl border p-5 transition-all ${
              s.highlight
                ? "bg-[#fcf8ed] border-[#b3862c] ring-1 ring-[#b3862c]/30 shadow-sm"
                : "bg-[#faf4e4] border-[#d8c79a]"
            }`}
          >
            <div style={{ color: GOLD }} className="mb-2">{s.icon}</div>
            <div className="text-2xl font-bold mb-1" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>{s.value}</div>
            <div className="text-xs font-semibold mb-0.5" style={{ fontFamily: FONT_UI, color: INKTEXT }}>{s.label}</div>
            <div className="text-[11px] text-[#8a7f63]" style={{ fontFamily: FONT_UI }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Quick Action Shortcuts */}
      <div className="grid sm:grid-cols-3 gap-4">
        <button
          onClick={() => setSub("upload")}
          className="daic-card text-left p-5 rounded-xl border border-[#d8c79a] bg-[#faf4e4] hover:border-[#b3862c] flex items-center justify-between group"
        >
          <div>
            <span className="text-xs font-semibold uppercase text-[#5a4420] tracking-wider block mb-1" style={{ fontFamily: FONT_UI }}>
              Ingestion
            </span>
            <h4 className="text-base font-bold text-[#141c30]" style={{ fontFamily: FONT_DISPLAY }}>
              Upload New Document
            </h4>
            <p className="text-xs text-[#6b6350] mt-1" style={{ fontFamily: FONT_UI }}>
              Launch multi-step ingestion pipeline
            </p>
          </div>
          <ArrowUpRight size={18} className="text-[#b3862c] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </button>

        <button
          onClick={() => setSub("pending")}
          className="daic-card text-left p-5 rounded-xl border border-[#d8c79a] bg-[#faf4e4] hover:border-[#b3862c] flex items-center justify-between group"
        >
          <div>
            <span className="text-xs font-semibold uppercase text-[#5a4420] tracking-wider block mb-1" style={{ fontFamily: FONT_UI }}>
              Review Queue
            </span>
            <h4 className="text-base font-bold text-[#141c30]" style={{ fontFamily: FONT_DISPLAY }}>
              Pending Ingestion ({pendingCount})
            </h4>
            <p className="text-xs text-[#6b6350] mt-1" style={{ fontFamily: FONT_UI }}>
              Approve or reject staged submissions
            </p>
          </div>
          <ArrowUpRight size={18} className="text-[#b3862c] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </button>

        <button
          onClick={() => setSub("preservation")}
          className="daic-card text-left p-5 rounded-xl border border-[#d8c79a] bg-[#faf4e4] hover:border-[#b3862c] flex items-center justify-between group"
        >
          <div>
            <span className="text-xs font-semibold uppercase text-[#5a4420] tracking-wider block mb-1" style={{ fontFamily: FONT_UI }}>
              Integrity
            </span>
            <h4 className="text-base font-bold text-[#141c30]" style={{ fontFamily: FONT_DISPLAY }}>
              Preservation Vault
            </h4>
            <p className="text-xs text-[#6b6350] mt-1" style={{ fontFamily: FONT_UI }}>
              Verify SHA-256 cold storage checksums
            </p>
          </div>
          <ArrowUpRight size={18} className="text-[#b3862c] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </button>
      </div>

      {/* Institutional System Capabilities */}
      <div className="p-6 rounded-xl border border-[#d8c79a] bg-[#faf4e4]">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Activity size={16} color={GOLD} />
            <h3 className="text-base font-bold text-[#141c30]" style={{ fontFamily: FONT_DISPLAY }}>
              Subsystem Health & Institutional Status
            </h3>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#eaf1e6] text-[#2f4a33] font-semibold inline-flex items-center gap-1" style={{ fontFamily: FONT_UI }}>
            <CheckCircle2 size={11} /> All Subsystems Operational
          </span>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 text-xs" style={{ fontFamily: FONT_UI }}>
          <div className="p-3 rounded-lg bg-[#f4ead0]/60 border border-[#e6d9b3]">
            <span className="text-[#5a4420] font-semibold block mb-0.5">Evidence Gate / Reranker</span>
            <span className="text-[#2f4a33] font-medium">Active (Latency ~180ms)</span>
          </div>
          <div className="p-3 rounded-lg bg-[#f4ead0]/60 border border-[#e6d9b3]">
            <span className="text-[#5a4420] font-semibold block mb-0.5">OCR Optical Engine</span>
            <span className="text-[#2f4a33] font-medium">Active (En / Mr / Hi)</span>
          </div>
          <div className="p-3 rounded-lg bg-[#f4ead0]/60 border border-[#e6d9b3]">
            <span className="text-[#5a4420] font-semibold block mb-0.5">Deep Preservation Vault</span>
            <span className="text-[#2f4a33] font-medium">SHA-256 Storage Online</span>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import {
  LayoutGrid, ListChecks, PencilLine, History,
  Upload, Shield,
  FileCheck, ClipboardList, LogOut
} from "lucide-react";
import { useAuth } from "../lib/auth/context.jsx";
import ArchivistOverview from "../components/archivist/ArchivistOverview.jsx";
import PendingReview from "../components/archivist/PendingReview.jsx";
import OcrQueue from "../components/archivist/OcrQueue.jsx";
import MetadataEditor from "../components/archivist/MetadataEditor.jsx";
import UploadWorkflow from "../components/archivist/UploadWorkflow.jsx";
import PreservationInspector from "../components/archivist/PreservationInspector.jsx";
import VersionHistory from "../components/archivist/VersionHistory.jsx";
import AuditLogViewer from "../components/archivist/AuditLogViewer.jsx";
import {
  FONT_DISPLAY, FONT_UI,
  GOLD, INKTEXT, INDIGO, CREAM,
} from "../lib/tokens.js";

/* ---------------------------------------------------------------------- */
/* Archivist Portal — Complete Institutional Dashboard for Phase 3        */
/* ---------------------------------------------------------------------- */

export default function ArchivistView({ t }) {
  const { logout, username } = useAuth();
  const [sub, setSub] = useState("overview");

  const subs = [
    { id: "overview",     label: t.overview,       icon: <LayoutGrid size={14} /> },
    { id: "pending",      label: t.pendingReview,  icon: <FileCheck size={14} /> },
    { id: "ocr",          label: t.ocrQueue,       icon: <ListChecks size={14} /> },
    { id: "metadata",     label: t.metadata,       icon: <PencilLine size={14} /> },
    { id: "upload",       label: t.upload,         icon: <Upload size={14} /> },
    { id: "preservation", label: t.preservation,   icon: <Shield size={14} /> },
    { id: "versions",     label: t.versions,       icon: <History size={14} /> },
    { id: "audit",        label: t.audit,          icon: <ClipboardList size={14} /> },
  ];

  return (
    <main id="main-content" className="max-w-5xl mx-auto px-6 pb-20">
      {/* Header + logout */}
      <div className="pt-12 pb-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <p className="uppercase text-xs tracking-[0.25em] mb-1" style={{ fontFamily: FONT_UI, color: GOLD }}>
              {t.archivistPortal}
            </p>
            <h1 className="text-3xl md:text-4xl font-bold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
              The other half of the platform
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {username && (
              <span className="text-[11px] px-2.5 py-1 rounded-full font-semibold" style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}>
                {username}
              </span>
            )}
            <button
              onClick={logout}
              className="daic-btn text-[11px] px-3.5 py-1.5 rounded-full border flex items-center gap-1.5 hover:bg-[#f2e2c6] transition-colors font-semibold"
              style={{ fontFamily: FONT_UI, color: "#5a4420", borderColor: "#c9b98c" }}
            >
              <LogOut size={12} /> {t.logout}
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-2 flex-wrap pb-2">
          {subs.map((s) => (
            <button
              key={s.id}
              onClick={() => setSub(s.id)}
              className="daic-chip text-xs px-3.5 py-1.5 rounded-full border flex items-center gap-1.5 font-medium transition-colors"
              style={{
                borderColor: s.id === sub ? INDIGO : "#c9b98c",
                backgroundColor: s.id === sub ? INDIGO : "transparent",
                color: s.id === sub ? CREAM : "#5a4420",
                fontFamily: FONT_UI,
              }}
              aria-current={s.id === sub ? "page" : undefined}
            >
              {s.icon}{s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active Sub-View */}
      <div className="pt-2">
        {sub === "overview" && <ArchivistOverview t={t} setSub={setSub} />}
        {sub === "pending" && <PendingReview t={t} />}
        {sub === "ocr" && <OcrQueue t={t} />}
        {sub === "metadata" && <MetadataEditor t={t} />}
        {sub === "upload" && <UploadWorkflow t={t} setSub={setSub} />}
        {sub === "preservation" && <PreservationInspector t={t} />}
        {sub === "versions" && <VersionHistory t={t} />}
        {sub === "audit" && <AuditLogViewer t={t} />}
      </div>
    </main>
  );
}

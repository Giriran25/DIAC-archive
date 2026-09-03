import { useState } from "react";
import {
  Upload, CheckCircle2, ArrowRight, 
  Check
} from "lucide-react";
import { api } from "../../lib/api/endpoints.js";
import {
  FONT_DISPLAY, FONT_UI,
} from "../../lib/tokens.js";

/* ---------------------------------------------------------------------- */
/* UploadWorkflow — Ingestion & Multi-Stage Processing Pipeline           */
/* ---------------------------------------------------------------------- */

const PIPELINE_STEPS = [
  { id: "upload", label: "Upload", desc: "File ingestion" },
  { id: "extraction", label: "Extraction", desc: "OCR & text stream" },
  { id: "metadata", label: "Metadata", desc: "Provenance tagging" },
  { id: "pending", label: "Pending Review", desc: "Staged queue" },
  { id: "review", label: "Archivist Review", desc: "Expert verification" },
  { id: "decision", label: "Approve / Reject", desc: "Institutional decision" },
  { id: "index", label: "Canonical Index", desc: "Committed to FAISS/BM25" },
];

export default function UploadWorkflow({ t, setSub }) {
  const [formData, setFormData] = useState({
    title: "",
    filename: "Data/SIH_heritage_docs/Volume1.pdf",
    type: "Writing",
    collection: "Writings and Speeches",
    language: "English",
    theme: "Social Justice",
    description: "",
    date: "1942",
  });

  const [currentStep, setCurrentStep] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [uploadedSubmission, setUploadedSubmission] = useState(null);
  const [uploadError, setUploadError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setProcessing(true);
    setUploadError(null);
    setCurrentStep(1); // Extraction
    try {
      setCurrentStep(2); // Metadata
      const res = await api.upload({
        ...formData,
        file_path: formData.filename,
        doc_type: formData.type,
        volume: formData.collection,
        date_text: formData.date,
        language: "en",
        licence: formData.description || null,
        submitted_by: "archivist",
      });
      setCurrentStep(3); // Pending Review
      setUploadedSubmission(res.item || res.submission || null);
      if (!res.item && !res.submission) {
        setUploadError("The archive did not return a staged submission.");
        setCurrentStep(0);
      }
    } catch (err) {
      setUploadError(err?.userMessage || "The document could not be staged for review.");
      setCurrentStep(0);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-8 daic-reveal">
      {/* Workflow Visualizer */}
      <div className="p-6 rounded-2xl border border-[#d8c79a] bg-[#faf4e4]">
        <span className="text-[10px] uppercase font-bold tracking-widest text-[#b3862c] block mb-2" style={{ fontFamily: FONT_UI }}>
          {t.pipelineStage || "Ingestion Pipeline"}
        </span>
        <h3 className="text-lg font-bold text-[#141c30] mb-6" style={{ fontFamily: FONT_DISPLAY }}>
          Archival Ingestion & Validation Lifecycle
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {PIPELINE_STEPS.map((step, idx) => {
            const isDone = currentStep > idx;
            const isCurrent = currentStep === idx;
            return (
              <div
                key={step.id}
                className={`p-3 rounded-xl border text-center transition-all ${
                  isCurrent
                    ? "bg-[#1c2c4d] border-[#b3862c] text-[#f4ead0] shadow-md ring-2 ring-[#b3862c]/40"
                    : isDone
                    ? "bg-[#eaf1e6] border-[#2f4a33] text-[#2f4a33]"
                    : "bg-[#f4ead0]/50 border-[#d8c79a] text-[#8a7f63]"
                }`}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center justify-center gap-1">
                  {isDone ? <Check size={11} /> : <span>{idx + 1}.</span>}
                  {step.label}
                </div>
                <div className="text-[9px] opacity-80" style={{ fontFamily: FONT_UI }}>
                  {step.desc}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Success Notice if Staged */}
      {uploadedSubmission ? (
        <div className="p-6 rounded-2xl border border-[#2f4a33] bg-[#eaf1e6] text-[#2f4a33] space-y-4 daic-reveal">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={20} />
            <h4 className="text-base font-bold" style={{ fontFamily: FONT_DISPLAY }}>
              Document Successfully Staged for Ingestion Review
            </h4>
          </div>
          <p className="text-xs text-[#2f4a33]/90 leading-relaxed" style={{ fontFamily: FONT_UI }}>
            "{uploadedSubmission.title}" has been extracted and registered in the pending queue. It will not be indexed or made public until an archivist completes manual review and issues formal approval.
          </p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setSub("pending")}
              className="daic-btn text-xs px-4 py-2 rounded-full bg-[#2f4a33] text-white font-semibold flex items-center gap-1.5"
              style={{ fontFamily: FONT_UI }}
            >
              Go to Pending Review <ArrowRight size={12} />
            </button>
            <button
              onClick={() => {
                setUploadedSubmission(null);
                setCurrentStep(0);
              }}
              className="text-xs px-4 py-2 rounded-full border border-[#2f4a33] hover:bg-[#d8e8d3]"
              style={{ fontFamily: FONT_UI }}
            >
              Upload Another Document
            </button>
          </div>
        </div>
      ) : (
        /* Ingestion Form */
        <form
          onSubmit={handleSubmit}
          className="p-6 md:p-8 rounded-2xl border border-[#d8c79a] bg-[#faf4e4] space-y-5"
        >
          {uploadError && (
            <div
              role="alert"
              className="p-3 rounded-lg border border-[#9c3d2e] bg-[#fbeae8] text-[#9c3d2e] text-xs"
              style={{ fontFamily: FONT_UI }}
            >
              {uploadError}
            </div>
          )}
          <h4 className="text-base font-bold text-[#141c30]" style={{ fontFamily: FONT_DISPLAY }}>
            Ingest New Archival Document Package
          </h4>

          <div className="grid sm:grid-cols-2 gap-4 text-xs" style={{ fontFamily: FONT_UI }}>
            <div className="sm:col-span-2">
              <label className="font-bold text-[#5a4420] block mb-1">Document Title</label>
              <input
                required
                type="text"
                placeholder="e.g. Memorandum on Rights of Labouring Classes"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-[#c9b98c] bg-white outline-none focus:border-[#b3862c]"
              />
            </div>

            <div>
              <label className="font-bold text-[#5a4420] block mb-1">Existing File Path</label>
              <input
                required
                type="text"
                placeholder="Data/path/to/document.pdf"
                value={formData.filename}
                onChange={(e) => setFormData({ ...formData, filename: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-[#c9b98c] bg-white outline-none focus:border-[#b3862c]"
              />
            </div>

            <div>
              <label className="font-bold text-[#5a4420] block mb-1">Document Type</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-[#c9b98c] bg-white outline-none focus:border-[#b3862c]"
              >
                <option value="Writing">Writing</option>
                <option value="Speech">Speech</option>
                <option value="Debate">Debate</option>
                <option value="Manuscript">Manuscript</option>
              </select>
            </div>

            <div>
              <label className="font-bold text-[#5a4420] block mb-1">Historical Date</label>
              <input
                type="text"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-[#c9b98c] bg-white outline-none focus:border-[#b3862c]"
              />
            </div>

            <div>
              <label className="font-bold text-[#5a4420] block mb-1">Volume</label>
              <input
                type="text"
                value={formData.collection}
                onChange={(e) => setFormData({ ...formData, collection: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-[#c9b98c] bg-white outline-none focus:border-[#b3862c]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="font-bold text-[#5a4420] block mb-1">Licence / Provenance Note</label>
              <textarea
                rows={3}
                placeholder="Details of the physical source, edition, and scan resolution..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-[#c9b98c] bg-white outline-none focus:border-[#b3862c]"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={processing}
              className="daic-btn text-xs px-6 py-2.5 rounded-full bg-[#1c2c4d] text-[#f4ead0] font-semibold flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
              style={{ fontFamily: FONT_UI }}
            >
              <Upload size={14} /> {processing ? "Processing Ingestion Pipeline…" : "Ingest & Stage for Review"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

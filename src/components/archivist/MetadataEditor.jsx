import { useState, useCallback } from "react";
import { PencilLine, Save, X, CheckCircle2, Info, AlertTriangle } from "lucide-react";
import StatusChip from "../ui/StatusChip.jsx";
import AsyncState from "../ui/AsyncState.jsx";
import { api } from "../../lib/api/endpoints.js";
import { useArchive } from "../../lib/api/useArchive.js";
import { ApiError } from "../../lib/api/client.js";
import {
  FONT_DISPLAY, FONT_UI,
  GOLD, INKTEXT, INDIGO,
} from "../../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * MetadataEditor — catalogue metadata, edited where it can actually change.
 *
 * The old editor listed published documents and "saved" edits into React
 * state: the form closed, a green banner appeared, and nothing reached the
 * archive. Reloading the page silently discarded the work.
 *
 * The archive has exactly one metadata write — PATCH on an intake item,
 * before it is approved — and that is what this screen now edits. Once a
 * document is approved its catalogue record is fixed at ingestion; that is
 * a property of the archive, and the panel states it rather than offering a
 * control that cannot honour it.
 * ---------------------------------------------------------------------- */

const FIELDS = [
  { key: "title", label: "Title" },
  { key: "doc_type", label: "Document type" },
  { key: "volume", label: "Volume" },
  { key: "date_text", label: "Date" },
  { key: "language", label: "Language" },
  { key: "licence", label: "Licence" },
];

export default function MetadataEditor() {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const fetcher = useCallback((signal) => api.pending(undefined, { signal }), []);
  const { data, loading, error, retry } = useArchive(fetcher, []);

  /* Only an item still awaiting a verdict can have its metadata corrected. */
  const items = (data?.items ?? []).filter((i) => i.status !== "indexed");

  const startEdit = (item) => {
    const m = item.metadata || {};
    setEditing(item);
    setFeedback(null);
    setForm({
      title: item.title || m.title || "",
      doc_type: m.doc_type || item.detectedType || "",
      volume: m.volume || "",
      date_text: m.date_text || "",
      language: m.language || "",
      licence: m.licence || "",
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editing) return;
    try {
      setSaving(true);
      /* Send only what was filled in: a blank field means "unchanged", not
         "erase the recorded value". */
      const patch = Object.fromEntries(
        Object.entries(form).filter(([, v]) => String(v ?? "").trim() !== "")
      );
      await api.updateItemMetadata(editing.id, patch);
      setFeedback({ ok: true, message: `Metadata saved for “${form.title || editing.id}”.` });
      setEditing(null);
      retry();
    } catch (err) {
      /* The edit did NOT persist, so the form stays open with the work in it. */
      setFeedback({
        ok: false,
        message: err instanceof ApiError
          ? `Not saved — ${err.userMessage}`
          : "Not saved — the archive could not be reached.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 daic-reveal">
      <div
        className="p-4 rounded-xl border text-xs leading-relaxed flex gap-2.5"
        style={{ backgroundColor: "#f3ecd8", borderColor: "#d8c79a", color: "#5a4420", fontFamily: FONT_UI }}
      >
        <Info size={15} className="shrink-0 mt-0.5" style={{ color: "#8a7f63" }} aria-hidden="true" />
        <p>
          Catalogue metadata is corrected <span className="font-semibold">before approval</span>.
          Once an item is approved and indexed its record is fixed at ingestion,
          so approved documents are not listed here.
        </p>
      </div>

      {feedback && (
        <div
          className="p-4 rounded-xl border flex items-center gap-2 text-xs"
          style={{
            fontFamily: FONT_UI,
            backgroundColor: feedback.ok ? "#eaf1e6" : "#f7e6e2",
            borderColor: feedback.ok ? "#2f4a33" : "#9c3d2e",
            color: feedback.ok ? "#2f4a33" : "#8a3a22",
          }}
          role="status"
        >
          {feedback.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span className="font-semibold">{feedback.message}</span>
        </div>
      )}

      <AsyncState
        loading={loading}
        error={error}
        empty={items.length === 0}
        onRetry={retry}
        labels={{
          loading: "Reading the intake queue…",
          error: "The intake queue could not be read.",
          empty: "Nothing is awaiting review, so there is no metadata to correct.",
        }}
      >
        <div className="rounded-xl border border-[#d8c79a] bg-[#faf4e4] overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]" style={{ fontFamily: FONT_UI }}>
            <caption className="sr-only">Intake items awaiting review</caption>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide border-b border-[#d8c79a] bg-[#f4ead0]/60 text-[#5a4420]">
                <th scope="col" className="p-3.5">Title</th>
                <th scope="col" className="p-3.5">Date</th>
                <th scope="col" className="p-3.5">Type</th>
                <th scope="col" className="p-3.5">Volume</th>
                <th scope="col" className="p-3.5">Status</th>
                <th scope="col" className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const m = it.metadata || {};
                return (
                  <tr key={it.id} className="border-b border-[#e6d9b3]/70 hover:bg-[#f5ebd4] transition-colors">
                    <td className="p-3.5 font-semibold text-[#141c30]">{it.title || it.filename}</td>
                    <td className="p-3.5 text-[#8a7f63]">{m.date_text || "—"}</td>
                    <td className="p-3.5 text-[#5a4420]">{m.doc_type || it.detectedType || "—"}</td>
                    <td className="p-3.5 text-[#5a4420]">{m.volume || "—"}</td>
                    <td className="p-3.5"><StatusChip status={it.status} /></td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={() => startEdit(it)}
                        className="daic-btn text-xs px-3 py-1.5 rounded-full border border-[#c9b98c] bg-[#faf4e4] text-[#5a4420] inline-flex items-center gap-1 hover:bg-[#f2e2c6]"
                        style={{ fontFamily: FONT_UI }}
                      >
                        <PencilLine size={11} aria-hidden="true" /> Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AsyncState>

      {/* Edit form */}
      {editing && (
        <form
          onSubmit={handleSave}
          className="p-6 rounded-2xl border border-[#b3862c] bg-[#fcf8ed] space-y-4 daic-reveal"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[#e6d9b3] pb-3">
            <h3 className="text-base font-bold" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
              Correct metadata — {editing.filename}
            </h3>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="daic-btn text-xs px-2.5 py-1 rounded-full border border-[#c9b98c] inline-flex items-center gap-1"
              style={{ fontFamily: FONT_UI, color: "#5a4420" }}
            >
              <X size={11} aria-hidden="true" /> Cancel
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="block text-[11px] uppercase tracking-wide mb-1.5" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                  {f.label}
                </span>
                <input
                  value={form[f.key] ?? ""}
                  onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border text-sm bg-white outline-none focus:border-[#b3862c] transition-colors"
                  style={{ borderColor: "#d8c79a", fontFamily: FONT_UI, color: INKTEXT }}
                />
              </label>
            ))}
          </div>

          <button
            type="submit"
            disabled={saving}
            className="daic-btn text-xs font-semibold px-4 py-2 rounded-full text-white inline-flex items-center gap-1.5 disabled:opacity-60"
            style={{ backgroundColor: INDIGO, fontFamily: FONT_UI }}
          >
            <Save size={12} color={GOLD} aria-hidden="true" />
            {saving ? "Saving…" : "Save to the archive"}
          </button>
        </form>
      )}
    </div>
  );
}

import { useState } from "react";
import {
  MessageCircle, ShieldCheck, FileText, BookOpen, Database,
  Upload, ScanLine, CheckCircle2, Search, ChevronRight,
} from "lucide-react";
import { eyebrow, itemTitle, meta, provenance } from "../lib/type.js";
import { FONT_UI, GOLD, INDIGO, INKTEXT } from "../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * ArchiveJourney — how a question becomes a page you can cite.
 *
 * The feature grid above this already says WHERE everything is. What it
 * cannot show is the shape of a research path: that an answer is only ever
 * a route to a passage, and that passage a route to the printed page it
 * sits on. That is the part visitors ask about, so it is the part drawn.
 *
 * Two things this deliberately does NOT do:
 *
 *   * It does not diagram the retrieval pipeline. Dense vectors, rank
 *     fusion, reranking and the evidence gate decide what a visitor is
 *     shown, not where they click; putting them on a wayfinding map would
 *     be showing off rather than helping.
 *   * It does not mix the two audiences. A reader's path and an
 *     archivist's workflow are different jobs, so they are different
 *     panels, and the archivist one is plainly labelled as staff work.
 *
 * Every step is a real destination: the visitor steps navigate, and the
 * ones that are stages within a screen rather than tabs say so instead of
 * pretending to be links.
 * ---------------------------------------------------------------------- */

/** One step. `tab` makes it navigable; without one it is a stage, not a place. */
function Step({ icon, label, note, tab, onGo, last }) {
  const isLink = Boolean(tab && onGo);
  const Tag = isLink ? "button" : "div";

  return (
    <li className="flex items-center gap-2 min-w-0">
      <Tag
        {...(isLink
          ? { onClick: () => onGo(tab), type: "button",
              "aria-label": `${label} — open` }
          : {})}
        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 min-w-0 w-full text-left transition-colors ${
          isLink
            ? "daic-btn bg-[#faf4e4] border-[#d8c79a] hover:border-[#b3862c] cursor-pointer"
            : "bg-[#f4ead0]/60 border-[#e6d9b3]"
        }`}
      >
        <span style={{ color: isLink ? GOLD : "#a89a76" }} className="shrink-0" aria-hidden="true">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block truncate" style={{ ...itemTitle, fontSize: "13px", color: INKTEXT }}>
            {label}
          </span>
          {note && (
            <span className="block truncate" style={{ ...meta, fontSize: "10.5px" }}>
              {note}
            </span>
          )}
        </span>
      </Tag>

      {/* The connector is decoration; a screen reader gets the order from
          the list itself, so it is hidden rather than read as "greater than". */}
      {!last && (
        <ChevronRight
          size={14}
          className="shrink-0 rotate-90 sm:rotate-0"
          style={{ color: "#c9b98c" }}
          aria-hidden="true"
        />
      )}
    </li>
  );
}

function Path({ title, caption, steps, onGo }) {
  return (
    <div>
      <h4 className="mb-1" style={{ ...itemTitle, fontSize: "14px" }}>{title}</h4>
      <p className="mb-3" style={{ ...provenance, fontSize: "11.5px" }}>{caption}</p>
      {/* Wraps on a phone, runs across on a tablet, never scrolls the page. */}
      <ol className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        {steps.map((s, i) => (
          <Step key={s.label} {...s} onGo={onGo} last={i === steps.length - 1} />
        ))}
      </ol>
    </div>
  );
}

export default function ArchiveJourney({ setTab }) {
  const [audience, setAudience] = useState("reader");

  const reader = [
    {
      icon: <MessageCircle size={15} />, label: "Ask the archive", tab: "ask",
      note: "a question in your own words",
    },
    {
      icon: <ShieldCheck size={15} />, label: "Evidence",
      note: "the passages the answer rests on",
    },
    {
      icon: <FileText size={15} />, label: "Source page",
      note: "volume and printed page",
    },
    {
      icon: <BookOpen size={15} />, label: "Read the document", tab: "archive",
      note: "the full text around it",
    },
  ];

  const browse = [
    { icon: <Database size={15} />, label: "Browse the archive", tab: "archive",
      note: "volumes and documents" },
    { icon: <BookOpen size={15} />, label: "Reader", tab: "archive",
      note: "page by page" },
  ];

  const archivist = [
    { icon: <Upload size={15} />, label: "Upload", note: "a scan or document" },
    { icon: <ScanLine size={15} />, label: "Ingest & OCR", note: "text extracted" },
    { icon: <CheckCircle2 size={15} />, label: "Human review", note: "an archivist checks it" },
    { icon: <Search size={15} />, label: "Searchable", note: "only once approved" },
  ];

  const TABS = [
    { id: "reader", label: "Finding something" },
    { id: "archivist", label: "How material gets in" },
  ];

  return (
    <section className="mb-16" aria-labelledby="journey-heading">
      <div className="flex items-end justify-between gap-4 mb-4 flex-wrap">
        <div>
          <p className="mb-1" style={{ ...eyebrow, color: GOLD }}>Finding your way</p>
          <h3 id="journey-heading" style={{ ...itemTitle, fontSize: "18px" }}>
            How this archive is used
          </h3>
        </div>

        <div className="flex gap-1.5" role="tablist" aria-label="Journey">
          {TABS.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={audience === x.id}
              onClick={() => setAudience(x.id)}
              className="daic-chip rounded-full border px-3 py-1.5 transition-colors"
              style={{
                ...meta,
                fontSize: "11px",
                borderColor: audience === x.id ? GOLD : "#c9b98c",
                backgroundColor: audience === x.id ? INDIGO : "transparent",
                color: audience === x.id ? "#f4ead0" : "#5a4420",
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[#d8c79a] bg-[#faf4e4] p-5 md:p-6 space-y-6">
        {audience === "reader" ? (
          <>
            <Path
              title="Start with a question"
              caption="Every answer names the passages behind it, and every passage opens at the page it was printed on."
              steps={reader}
              onGo={setTab}
            />
            <div className="pt-5 border-t border-[#e6d9b3]">
              <Path
                title="Or start with the shelf"
                caption="Browse the volumes directly when you already know what you are looking for."
                steps={browse}
                onGo={setTab}
              />
            </div>
            <p className="pt-1" style={{ ...provenance, fontSize: "11.5px" }}>
              Timeline, Stories, Manuscripts, Media and Knowledge are other ways
              into the same holdings — each one ends at a source you can open.
            </p>
          </>
        ) : (
          <>
            <Path
              title="The archivist workflow"
              caption="Staff-side. Nothing reaches the public archive without a person approving it."
              steps={archivist}
            />
            <p className="pt-1" style={{ ...provenance, fontSize: "11.5px" }}>
              Until an archivist approves a page, its text is not retrievable by
              search and no answer can cite it.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

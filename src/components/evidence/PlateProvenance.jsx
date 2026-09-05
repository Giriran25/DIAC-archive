import { Image as ImageIcon, ChevronRight } from "lucide-react";
import { itemTitle, meta, provenance } from "../../lib/type.js";
import { GOLD } from "../../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * PlateProvenance — where a timeline event actually comes from.
 *
 * These events are captions read off plates in the archive's photograph
 * album, and the plate is their provenance. It used to be hidden: the
 * screens showed "Archival sources" built from a link table that had been
 * filled by matching the event's year against any passage containing that
 * year as a substring, so a 1908 college roll-call cited three passages
 * about plough cattle. Those links are gone.
 *
 * What is shown instead is true and checkable: the album, the page number,
 * and the scan itself. A reader can open the plate and compare it with the
 * caption, which is the only kind of provenance worth printing.
 * ---------------------------------------------------------------------- */

/** "…/api/manuscript/daic-album-01/page/73/image" -> { id, page } */
export function parsePlate(imagePath) {
  const match = String(imagePath || "").match(/\/api\/manuscript\/([^/]+)\/page\/(\d+)\/image/);
  return match ? { manuscriptId: match[1], page: Number(match[2]) } : null;
}

export default function PlateProvenance({ event, onOpenPlate }) {
  const plate = parsePlate(event?.image);

  /* No linked passage and no plate: say so. An empty panel reads as a
     loading failure, and filling it with anything else would be invention. */
  if (!plate) {
    return (
      <p className="pt-5 border-t border-[#d8c79a]" style={provenance}>
        No source has been recorded for this event yet.
      </p>
    );
  }

  const isLink = typeof onOpenPlate === "function";
  const Tag = isLink ? "button" : "div";

  return (
    <div className="pt-5 border-t border-[#d8c79a]">
      <h4 className="mb-3" style={{ ...itemTitle, fontSize: "13px" }}>
        Source
      </h4>

      <Tag
        {...(isLink
          ? { type: "button", onClick: () => onOpenPlate(plate),
              "aria-label": `Open plate ${plate.page} in the manuscript viewer` }
          : {})}
        className={`daic-card daic-arrow-parent w-full text-left rounded-lg border border-[#d8c79a] bg-white p-3.5 flex items-center gap-3.5 ${
          isLink ? "hover:border-[#b3862c] cursor-pointer" : ""
        }`}
      >
        {/* The scan itself, small. It is the thing being cited. */}
        <img
          src={event.image}
          alt=""
          loading="lazy"
          className="w-16 h-20 object-cover rounded border border-[#e6d9b3] bg-[#f4ead0] shrink-0"
          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
        />

        <span className="min-w-0">
          <span className="flex items-center gap-1.5 mb-1" style={meta}>
            <ImageIcon size={11} color={GOLD} aria-hidden="true" />
            Archival plate · page {plate.page}
          </span>
          <span className="block" style={{ ...itemTitle, fontSize: "13px" }}>
            Dr. Babasaheb Ambedkar — archival plates album
          </span>
          <span className="block mt-0.5" style={{ ...provenance, fontSize: "11px" }}>
            The caption above is transcribed from this plate.
            {isLink ? " Open it to compare." : ""}
          </span>
        </span>

        {isLink && (
          <ChevronRight size={14} className="daic-arrow ml-auto shrink-0"
                        style={{ color: GOLD }} aria-hidden="true" />
        )}
      </Tag>
    </div>
  );
}

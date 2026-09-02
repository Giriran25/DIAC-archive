import { AlertTriangle } from "lucide-react";
import { SHOW_MOCK_NOTICE } from "../lib/api/client.js";
import { FONT_UI } from "../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * Demonstration-data banner.
 *
 * The demo layer serves invented documents, invented answers and invented
 * citations. That is fine for a walkthrough and indefensible if a reader
 * cannot tell. Whenever it is on outside the test runner, this sits above
 * everything and says so.
 * ---------------------------------------------------------------------- */

export default function DemoNotice() {
  if (!SHOW_MOCK_NOTICE) return null;

  return (
    <div
      role="status"
      className="px-4 py-2 flex items-center justify-center gap-2 text-center text-[11px] leading-snug"
      style={{
        backgroundColor: "#7a2e12",
        color: "#f7e9d0",
        fontFamily: FONT_UI,
        letterSpacing: "0.02em",
      }}
    >
      <AlertTriangle size={13} aria-hidden="true" className="shrink-0" />
      <span>
        <strong className="font-semibold uppercase tracking-[0.12em]">Demonstration data</strong>
        {" — "}
        this device is not connected to the archive. Documents, answers and
        citations shown here are fabricated for demonstration and must not be
        cited.
      </span>
    </div>
  );
}

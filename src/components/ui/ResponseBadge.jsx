import { Check, AlertTriangle, XCircle } from "lucide-react";
import { FONT_UI } from "../../lib/tokens.js";

/* Response type badges for AI answers.
   VERIFIED (grounded) / ARCHIVE EVIDENCE (degraded) / INSUFFICIENT (refused) */

const BADGES = {
  grounded: {
    icon: <Check size={12} />,
    bg: "#2f4a33",
    color: "#dcefd6",
  },
  degraded: {
    icon: <AlertTriangle size={12} />,
    bg: "#5a4420",
    color: "#f3dfa8",
  },
  refused: {
    icon: <XCircle size={12} />,
    bg: "#5a3a3a",
    color: "#e8d0d0",
  },
};

export default function ResponseBadge({ type, t }) {
  const badge = BADGES[type];
  if (!badge) return null;

  const label =
    type === "grounded" ? t.verified :
    type === "degraded" ? t.degraded :
    t.refused;

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wide"
      style={{
        backgroundColor: badge.bg,
        color: badge.color,
        fontFamily: FONT_UI,
        fontWeight: 600,
      }}
    >
      {badge.icon}
      {label}
    </span>
  );
}

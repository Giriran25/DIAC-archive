import { Check, AlertTriangle, Clock } from "lucide-react";
import { FONT_UI } from "../../lib/tokens.js";

const MAP = {
  Digitised: { bg: "bg-[#2f4a33]", text: "text-[#dcefd6]", icon: <Check size={11} /> },
  "In review": { bg: "bg-[#5a4420]", text: "text-[#f3dfa8]", icon: <AlertTriangle size={11} /> },
  Queued: { bg: "bg-[#3a3a3a]", text: "text-[#dcdcdc]", icon: <Clock size={11} /> },
};

export default function StatusChip({ status }) {
  const s = MAP[status] || MAP.Queued;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] tracking-wide uppercase ${s.bg} ${s.text}`}
      style={{ fontFamily: FONT_UI }}
    >
      {s.icon}{status}
    </span>
  );
}

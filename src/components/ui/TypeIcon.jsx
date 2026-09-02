import { BookOpen, Mic, Users, ScrollText, FileText } from "lucide-react";

export default function TypeIcon({ type, size = 14, color }) {
  const props = { size, color: color || "currentColor" };
  if (type === "Writing") return <BookOpen {...props} />;
  if (type === "Speech") return <Mic {...props} />;
  if (type === "Debate") return <Users {...props} />;
  if (type === "Manuscript") return <ScrollText {...props} />;
  return <FileText {...props} />;
}

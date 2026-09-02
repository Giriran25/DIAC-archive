import { Loader2, AlertTriangle, Inbox } from "lucide-react";
import { FONT_UI, FONT_BODY, INKTEXT } from "../../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * The three states every screen that reads the archive has to render.
 *
 * They were previously improvised per view, which is how some screens ended
 * up showing an empty grid when the archive was unreachable — a silence
 * that reads as "nothing here" when it means "we could not ask".
 * ---------------------------------------------------------------------- */

const SHELL = "flex flex-col items-center justify-center text-center px-6 py-12 gap-2.5";

export function LoadingState({ label = "Reading the archive…" }) {
  return (
    <div className={SHELL} role="status" aria-live="polite">
      <Loader2 size={20} className="daic-spin" style={{ color: "#8a7f63" }} aria-hidden="true" />
      <p className="text-sm" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>{label}</p>
    </div>
  );
}

/**
 * An error is not an empty result. This says what failed and offers the
 * only honest action — try again — rather than pretending the shelf is bare.
 */
export function ErrorState({ error, onRetry, label = "The archive could not be read." }) {
  const detail = error?.userMessage || error?.message || null;
  return (
    <div className={SHELL} role="alert">
      <AlertTriangle size={20} style={{ color: "#8a3a22" }} aria-hidden="true" />
      <p className="text-sm" style={{ fontFamily: FONT_UI, color: INKTEXT, fontWeight: 600 }}>{label}</p>
      {detail && (
        <p className="text-xs max-w-sm" style={{ fontFamily: FONT_BODY, color: "#6f6549" }}>{detail}</p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="daic-btn mt-1 text-xs px-3 py-1.5 rounded-full border"
          style={{ borderColor: "#c9b98c", color: "#5a4420", fontFamily: FONT_UI }}
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** A genuinely empty result — the request succeeded and found nothing. */
export function EmptyState({ label = "Nothing in the archive matches that.", hint }) {
  return (
    <div className={SHELL}>
      <Inbox size={20} style={{ color: "#8a7f63" }} aria-hidden="true" />
      <p className="text-sm" style={{ fontFamily: FONT_UI, color: INKTEXT }}>{label}</p>
      {hint && (
        <p className="text-xs max-w-sm" style={{ fontFamily: FONT_BODY, color: "#8a7f63" }}>{hint}</p>
      )}
    </div>
  );
}

/**
 * Renders the right state for a `useArchive` result, or the children when
 * data actually arrived.
 */
export default function AsyncState({ loading, error, empty, onRetry, labels = {}, children }) {
  if (loading) return <LoadingState label={labels.loading} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} label={labels.error} />;
  if (empty) return <EmptyState label={labels.empty} hint={labels.emptyHint} />;
  return children;
}

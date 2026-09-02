import { useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import ChakraMark from "../components/ChakraMark.jsx";
import { useAuth } from "../lib/auth/context.jsx";
import { GATE_NOTICE } from "../lib/auth/provider.js";
import {
  FONT_DISPLAY, FONT_UI,
  INDIGO, INKTEXT, VERMIL,
} from "../lib/tokens.js";

/* ---------------------------------------------------------------------- */
/* Archivist Login — DAIC-styled, not a generic corporate login            */
/* ---------------------------------------------------------------------- */

export default function ArchivistLoginView({ t, onBack }) {
  const { login, loading, error } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    const ok = await login(username, password);
    if (!ok) {
      setPassword("");
    }
  };

  return (
    <main
      id="main-content"
      className="min-h-[80vh] flex items-center justify-center px-6 py-12"
      style={{ backgroundColor: INDIGO }}
    >
      <div className="w-full max-w-sm">
        <div
          className="daic-reveal rounded-xl border p-8"
          style={{ backgroundColor: "#faf4e4", borderColor: "#d8c79a" }}
        >
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <ChakraMark size={36} />
            </div>
            <h1
              className="text-2xl mb-1"
              style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}
            >
              {t.archivistPortal}
            </h1>
            <p
              className="text-xs uppercase tracking-[0.15em]"
              style={{ fontFamily: FONT_UI, color: "#8a7f63" }}
            >
              {t.institutionalAccess}
            </p>
          </div>

          {/* The archive has no authentication service. Saying so here is the
              only honest way to show a form that checks nothing. */}
          <div
            className="mb-5 text-[11px] leading-relaxed px-3 py-2.5 rounded-lg border"
            style={{
              backgroundColor: "#f3ecd8",
              borderColor: "#d8c79a",
              color: "#6f6549",
              fontFamily: FONT_UI,
            }}
          >
            <span className="uppercase tracking-[0.12em] font-semibold" style={{ color: "#8a7f63" }}>
              Not a security boundary
            </span>
            <br />
            {GATE_NOTICE}
          </div>

          {error && (
            <div
              className="mb-4 text-xs px-3 py-2 rounded-lg border flex items-center gap-2"
              style={{
                backgroundColor: "#fce8e6",
                borderColor: "#e8c0bc",
                color: VERMIL,
                fontFamily: FONT_UI,
              }}
              role="alert"
            >
              <ShieldCheck size={12} />
              {t.loginError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                className="block text-[11px] uppercase tracking-wide mb-1.5"
                style={{ fontFamily: FONT_UI, color: "#8a7f63" }}
                htmlFor="archivist-username"
              >
                {t.username}
              </label>
              <input
                id="archivist-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                className="w-full px-3 py-2.5 rounded-lg border text-sm bg-white outline-none focus:border-[#b3862c] transition-colors"
                style={{ borderColor: "#d8c79a", fontFamily: FONT_UI, color: INKTEXT }}
              />
            </div>
            <div>
              <label
                className="block text-[11px] uppercase tracking-wide mb-1.5"
                style={{ fontFamily: FONT_UI, color: "#8a7f63" }}
                htmlFor="archivist-password"
              >
                {t.password}
              </label>
              <input
                id="archivist-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                required
                className="w-full px-3 py-2.5 rounded-lg border text-sm bg-white outline-none focus:border-[#b3862c] transition-colors"
                style={{ borderColor: "#d8c79a", fontFamily: FONT_UI, color: INKTEXT }}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="daic-btn w-full py-2.5 rounded-lg text-sm text-white transition-opacity disabled:opacity-60"
              style={{ backgroundColor: INDIGO, fontFamily: FONT_UI, fontWeight: 600 }}
            >
              {loading ? "…" : t.signIn}
            </button>
          </form>

          <div className="text-center mt-6">
            <button
              onClick={onBack}
              className="daic-btn text-xs inline-flex items-center gap-1.5 hover:underline"
              style={{ fontFamily: FONT_UI, color: INDIGO }}
            >
              <ArrowLeft size={12} /> {t.backToArchiveLink}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

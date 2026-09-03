import React, { useState, useEffect } from "react";
import {
  Sparkles, MessageCircle, Clock, LayoutGrid, ShieldCheck,
  Heart, ScrollText, Film, Network
} from "lucide-react";

import ChakraMark from "./components/ChakraMark.jsx";
import DemoNotice from "./components/DemoNotice.jsx";
import LandingView from "./views/LandingView.jsx";
import HomeView from "./views/HomeView.jsx";
import AskView from "./views/AskView.jsx";
import TimelineView from "./views/TimelineView.jsx";
import ArchiveView from "./views/ArchiveView.jsx";
import ReaderView from "./views/ReaderView.jsx";
import StoriesView from "./views/StoriesView.jsx";
import ManuscriptsView from "./views/ManuscriptsView.jsx";
import MediaView from "./views/MediaView.jsx";
import KnowledgeView from "./views/KnowledgeView.jsx";
import ArchivistView from "./views/ArchivistView.jsx";
import ArchivistLoginView from "./views/ArchivistLoginView.jsx";
import AuthGuard from "./components/auth/AuthGuard.jsx";
import { AuthProvider, useAuth } from "./lib/auth/context.jsx";
import { useReadAloud } from "./lib/speech.js";
import { LANGS, UI } from "./lib/i18n.js";

import {
  INK, INDIGO, PARCH, GOLD_LIGHT, CREAM,
  FONT_UI,
} from "./lib/tokens.js";

/* ---------------------------------------------------------------------- */
/* App shell — routing, header, footer with Phase 2 heritage modules       */
/* ---------------------------------------------------------------------- */

function AppShell({ startAtLanding = true }) {
  const [mode, setMode] = useState("visitor");
  const [tab, setTab] = useState("home");
  const [lang, setLang] = useState("en");
  const [articleId, setArticleId] = useState(null);
  const [seed, setSeed] = useState(null);
  const [entered, setEntered] = useState(!startAtLanding);

  const auth = useAuth();
  const reader = useReadAloud();
  const t = UI[lang] || UI.en;

  const enterArchive = () => {
    reader.stop();
    setArticleId(null);
    setTab("home");
    setEntered(true);
    window.scrollTo({ top: 0 });
  };

  const primaryTabs = [
    { id: "home", label: t.home, icon: <Sparkles size={14} /> },
    { id: "ask", label: t.ask, icon: <MessageCircle size={14} /> },
    { id: "timeline", label: t.timeline, icon: <Clock size={14} /> },
    { id: "archive", label: t.archive, icon: <LayoutGrid size={14} /> },
  ];

  const heritageTabs = [
    { id: "manuscripts", label: t.manuscripts || "Manuscripts", icon: <ScrollText size={13} /> },
    { id: "media", label: t.media || "Media", icon: <Film size={13} /> },
    { id: "stories", label: t.stories || "Stories", icon: <Heart size={13} /> },
    { id: "knowledge", label: t.knowledge || "Knowledge", icon: <Network size={13} /> },
  ];

  useEffect(() => {
    if (mode === "archivist") setTab("archivist");
    else if (tab === "archivist") setTab("home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const go = (next) => { reader.stop(); setArticleId(null); setTab(next); window.scrollTo({ top: 0 }); };
  const openArticle = (id) => { reader.stop(); setArticleId(id); window.scrollTo({ top: 0 }); };
  const askThis = (q) => {
    reader.stop();
    setArticleId(null);
    if (q) setSeed(q);
    setTab("ask");
    window.scrollTo({ top: 0 });
  };

  /* The reader fetches its own document. App only holds the id, so a
     document that exists in the archive but not in any local fixture opens
     correctly — which is every document on a real deployment. */
  const article = articleId;

  if (!entered) {
    return (
      <div style={{ backgroundColor: PARCH, minHeight: "100vh" }}>
        <LandingView onEnter={enterArchive} />
      </div>
    );
  }

  const handleArchivistToggle = () => {
    reader.stop();
    if (mode === "visitor") {
      setMode("archivist");
    } else {
      auth.logout();
      setMode("visitor");
    }
  };

  const handleBackFromLogin = () => {
    setMode("visitor");
    setTab("home");
  };

  return (
    <div style={{ backgroundColor: PARCH, minHeight: "100vh" }}>
      <a href="#main-content" className="daic-skip-link">
        {t.skipToContent || "Skip to main content"}
      </a>

      <DemoNotice />

      {/* ---- Header ---- */}
      <header className="sticky top-0 z-20 overflow-x-hidden shadow-sm" style={{ backgroundColor: INK }}>
        <div className="max-w-7xl mx-auto min-h-14 px-4 sm:px-6 py-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <button onClick={() => go("home")} className="flex items-center gap-2.5 shrink-0 text-left">
            <ChakraMark size={20} />
            <div>
              <div className="text-sm tracking-wide font-semibold" style={{ fontFamily: FONT_UI, color: CREAM }}>DAIC ARCHIVE</div>
              <div className="text-[10px] hidden sm:block text-[#8a97b8]" style={{ fontFamily: FONT_UI }}>Ambedkar International Centre</div>
            </div>
          </button>

          {/* Desktop primary nav */}
          {mode === "visitor" && (
            <nav className="hidden xl:flex min-w-0 flex-1 items-center justify-center gap-0 overflow-x-auto daic-scrollbar-none" aria-label="Main navigation">
              {primaryTabs.map((x) => (
                <button
                  key={x.id}
                  onClick={() => go(x.id)}
                  className="daic-chip shrink-0 flex items-center gap-1 text-[11px] px-1.5 py-1.5 rounded-full transition-colors"
                  style={{
                    fontFamily: FONT_UI,
                    color: tab === x.id && !article ? INK : CREAM,
                    backgroundColor: tab === x.id && !article ? GOLD_LIGHT : "transparent",
                  }}
                  aria-current={tab === x.id && !article ? "page" : undefined}
                >
                  {x.icon}{x.label}
                </button>
              ))}

              <span className="text-white/20 px-0.5">|</span>

              {heritageTabs.map((x) => (
                <button
                  key={x.id}
                  onClick={() => go(x.id)}
                  className="daic-chip shrink-0 flex items-center gap-1 text-[11px] px-1.5 py-1.5 rounded-full transition-colors"
                  style={{
                    fontFamily: FONT_UI,
                    color: tab === x.id && !article ? INK : "#d9ac4f",
                    backgroundColor: tab === x.id && !article ? GOLD_LIGHT : "transparent",
                  }}
                  aria-current={tab === x.id && !article ? "page" : undefined}
                >
                  {x.icon}{x.label}
                </button>
              ))}
            </nav>
          )}

          {/* Right Controls */}
          <div className="w-max justify-self-end flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Language selector (desktop) */}
            <div className="hidden sm:flex items-center gap-0.5 rounded-full p-0.5" style={{ backgroundColor: INDIGO }}>
              {Object.entries(LANGS).map(([code, label]) => (
                <button
                  key={code}
                  onClick={() => { reader.stop(); setLang(code); }}
                  className="daic-chip text-[11px] px-2 py-0.5 rounded-full transition-colors"
                  style={{
                    fontFamily: FONT_UI,
                    color: lang === code ? INK : CREAM,
                    backgroundColor: lang === code ? GOLD_LIGHT : "transparent",
                  }}
                  aria-pressed={lang === code}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Archivist mode toggle */}
            <button
              onClick={handleArchivistToggle}
              title={mode === "visitor" ? "Switch to archivist mode" : "Switch to visitor mode"}
              className="daic-chip text-[11px] px-3 py-1.5 rounded-full border flex items-center gap-1.5"
              style={{ fontFamily: FONT_UI, color: CREAM, borderColor: "rgba(244,234,208,0.3)" }}
            >
              <ShieldCheck size={14} />
              <span className="hidden sm:inline">{mode === "visitor" ? "Visitor mode" : "Archivist mode"}</span>
            </button>
          </div>
        </div>

        {/* Mobile/Tablet navigation bar */}
        {mode === "visitor" && (
          <nav className="xl:hidden w-full min-w-0 flex justify-start gap-1 pb-2 px-3 overflow-x-auto daic-scrollbar-none" aria-label="Main navigation">
            {[...primaryTabs, ...heritageTabs].map((x) => (
              <button
                key={x.id}
                onClick={() => go(x.id)}
                className="daic-chip shrink-0 flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full whitespace-nowrap"
                style={{
                  fontFamily: FONT_UI,
                  color: tab === x.id && !article ? INK : CREAM,
                  backgroundColor: tab === x.id && !article ? GOLD_LIGHT : "transparent",
                }}
                aria-current={tab === x.id && !article ? "page" : undefined}
              >
                {x.icon}{x.label}
              </button>
            ))}
          </nav>
        )}

        {/* Mobile language bar */}
        <div className="sm:hidden min-h-8 flex items-center justify-center gap-1 pb-1.5">
          {Object.entries(LANGS).map(([code, label]) => (
            <button
              key={code}
              onClick={() => { reader.stop(); setLang(code); }}
              className="text-[10px] px-2 py-0.5 rounded-full"
              style={{
                fontFamily: FONT_UI,
                color: lang === code ? INK : CREAM,
                backgroundColor: lang === code ? GOLD_LIGHT : "transparent",
              }}
              aria-pressed={lang === code}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* ---- Content ---- */}
      {mode === "archivist" ? (
        <AuthGuard
          fallback={<ArchivistLoginView t={t} onBack={handleBackFromLogin} />}
        >
          <ArchivistView t={t} />
        </AuthGuard>
      ) : article ? (
        <ReaderView documentId={articleId} lang={lang} t={t} reader={reader} openArticle={openArticle} back={() => go("archive")} />
      ) : (
        <>
          {tab === "home" && <HomeView lang={lang} t={t} onAsk={askThis} setTab={go} openArticle={openArticle} />}
          {tab === "ask" && <AskView lang={lang} t={t} reader={reader} seed={seed} clearSeed={() => setSeed(null)} openArticle={openArticle} />}
          {tab === "timeline" && <TimelineView t={t} reader={reader} lang={lang} openArticle={openArticle} />}
          {tab === "archive" && <ArchiveView t={t} openArticle={openArticle} />}
          {tab === "manuscripts" && <ManuscriptsView t={t} openArticle={openArticle} />}
          {tab === "media" && <MediaView t={t} openArticle={openArticle} />}
          {tab === "stories" && <StoriesView t={t} openArticle={openArticle} />}
          {tab === "knowledge" && <KnowledgeView t={t} openArticle={openArticle} />}
        </>
      )}

      {/* ---- Footer ---- */}
      <footer className="py-8 text-center text-[11px] px-6 border-t border-[#d8c79a]/50" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
        Dr. Ambedkar International Centre (DAIC) · Digital Heritage Archive · SIH 2026 PS 26096
      </footer>
    </div>
  );
}

export default function App({ startAtLanding = true, initialAuth = false }) {
  return (
    <AuthProvider initialAuth={initialAuth}>
      <AppShell startAtLanding={startAtLanding} />
    </AuthProvider>
  );
}

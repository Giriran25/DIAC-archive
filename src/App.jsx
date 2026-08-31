import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Search, MessageCircle, Clock, LayoutGrid, ShieldCheck, Send,
  Check, AlertTriangle, BookOpen, ChevronRight, Sparkles,
  FileText, Users, Database, PencilLine, Mic, ScrollText,
  ListChecks, History, ChevronDown, CircleDot, Volume2, Square,
  Pause, Play, ArrowLeft, Quote, Link2, Languages,
} from "lucide-react";

import { ARTICLES, THEMES, TYPES, PASSAGES } from "./data/corpus.js";
import { answerQuestion, searchArticles, getArticle, splitSentences } from "./lib/retrieval.js";
import { useReadAloud } from "./lib/speech.js";

/* ---------------------------------------------------------------------- */
/* Tokens                                                                  */
/* ---------------------------------------------------------------------- */
const INK = "#141c30";
const INDIGO = "#1c2c4d";
const PARCH = "#f4ead0";
const GOLD = "#b3862c";
const GOLD_LIGHT = "#d9ac4f";
const VERMIL = "#9c3d2e";
const INKTEXT = "#241f16";
const CREAM = "#f4ead0";

const FONT_DISPLAY = "'Tiro Devanagari Hindi', serif";
const FONT_BODY = "'Source Serif 4', serif";
const FONT_UI = "'Work Sans', sans-serif";

/* ---------------------------------------------------------------------- */
/* Timeline                                                                */
/* ---------------------------------------------------------------------- */
const TIMELINE = [
  { year: "1891", title: "Born in Mhow", tag: "Life", detail: "Bhimrao Ramji Ambedkar is born into a Mahar family in the Mhow military cantonment, Central Provinces.", article: null },
  { year: "1913–17", title: "Columbia & LSE", tag: "Life", detail: "Graduate study in economics and law at Columbia University and the London School of Economics, shaping his later constitutional and economic writing.", article: null },
  { year: "1927", title: "Mahad Satyagraha", tag: "Movement", detail: "Leads the march to assert the right of the depressed classes to draw water from the Chavdar tank.", article: "mahad-satyagraha" },
  { year: "1936", title: "Annihilation of Caste", tag: "Speech", detail: "An undelivered presidential address, later published, arguing for the abolition of caste as a social structure.", article: "annihilation-of-caste" },
  { year: "1942–46", title: "Labour Member", tag: "Writing", detail: "As Labour Member of the Viceroy's Executive Council, converts a moral argument about rest into statutory machinery.", article: "labour-rights" },
  { year: "1947", title: "States and Minorities", tag: "Writing", detail: "Submits a complete draft constitution with an economic programme to the Constituent Assembly.", article: "states-and-minorities" },
  { year: "1948", title: "Article 17 debated", tag: "Debate", detail: "The Assembly takes up Draft Article 11, abolishing untouchability in unqualified language.", article: "article-17" },
  { year: "1949", title: "Constitution adopted", tag: "Debate", detail: "The Constituent Assembly adopts the Constitution of India on 26 November.", article: "constitution-adopted" },
  { year: "1956", title: "Conversion at Nagpur", tag: "Speech", detail: "Embraces Buddhism with several hundred thousand followers at Deekshabhoomi, Nagpur.", article: "nagpur-conversion" },
];

const PRESET_QUESTIONS = [
  "What did Ambedkar say about labour rights?",
  "Summarise the Mahad Satyagraha",
  "What does the drafting record say about Article 17?",
  "How did Ambedkar define social democracy?",
];

const LANGS = { en: "EN", hi: "हिं", mr: "मर", kn: "ಕನ್ನ", ta: "தமி" };

const UI = {
  en: {
    tagline: "A living archive of writings, speeches and the constitutional record — searchable, cited, and open to every language of the visitors it serves.",
    cta: "Ask the archive", ask: "Ask", home: "Home", timeline: "Timeline", archive: "Archive",
    placeholder: "Ask about a speech, a debate, an idea…", typeQ: "Type your question…",
    evidence: "Evidence", listen: "Listen", stop: "Stop", reading: "Reading aloud",
    intro: "Ask about a speech, a debate, a manuscript, or an idea. Every answer comes with its source — if none clears the bar, I'll say so instead of guessing.",
    retrieving: "Searching the corpus…", noSource: "No grounded source", results: "Results",
    related: "Related in the archive", provenance: "Provenance", relevance: "Relevance",
    backToArchive: "Back to the archive", answersIn: "Answers in English", jumpTo: "jump straight to an article",
  },
  hi: {
    tagline: "लेखन, भाषणों और संवैधानिक अभिलेख का एक जीवंत संग्रह — खोजने योग्य, उद्धृत, और हर भाषा में सुलभ।",
    cta: "संग्रह से पूछें", ask: "पूछें", home: "मुख्य", timeline: "कालक्रम", archive: "संग्रह",
    placeholder: "किसी भाषण, बहस या विचार के बारे में पूछें…", typeQ: "अपना प्रश्न लिखें…",
    evidence: "प्रमाण", listen: "सुनें", stop: "रोकें", reading: "पढ़ा जा रहा है",
    intro: "किसी भाषण, बहस, पांडुलिपि या विचार के बारे में पूछें। हर उत्तर अपने स्रोत के साथ आता है — यदि कोई स्रोत पर्याप्त नहीं, तो मैं अनुमान के बजाय यही कहूँगा।",
    retrieving: "संग्रह खोजा जा रहा है…", noSource: "कोई प्रमाणित स्रोत नहीं", results: "परिणाम",
    related: "संग्रह में संबंधित", provenance: "उद्गम", relevance: "प्रासंगिकता",
    backToArchive: "संग्रह पर वापस", answersIn: "उत्तर हिंदी में", jumpTo: "सीधे लेख पर जाएँ",
  },
  mr: {
    tagline: "लेखन, भाषणे आणि घटनात्मक नोंदींचा एक जिवंत संग्रह — शोधण्यायोग्य, उद्धृत, आणि प्रत्येक भाषेत उपलब्ध.",
    cta: "संग्रहाला विचारा", ask: "विचारा", home: "मुख्यपृष्ठ", timeline: "कालरेषा", archive: "संग्रह",
    placeholder: "भाषण, चर्चा किंवा विचाराबद्दल विचारा…", typeQ: "तुमचा प्रश्न लिहा…",
    evidence: "पुरावा", listen: "ऐका", stop: "थांबवा", reading: "वाचले जात आहे",
    intro: "भाषण, चर्चा, हस्तलिखित किंवा विचाराबद्दल विचारा. प्रत्येक उत्तर त्याच्या स्रोतासह येते — स्रोत नसल्यास मी अंदाज न लावता तसे सांगेन.",
    retrieving: "संग्रह शोधत आहे…", noSource: "प्रमाणित स्रोत नाही", results: "निकाल",
    related: "संग्रहातील संबंधित", provenance: "उगम", relevance: "सुसंगतता",
    backToArchive: "संग्रहाकडे परत", answersIn: "उत्तरे मराठीत", jumpTo: "थेट लेखाकडे जा",
  },
  kn: {
    tagline: "ಬರಹಗಳು, ಭಾಷಣಗಳು ಮತ್ತು ಸಾಂವಿಧಾನಿಕ ದಾಖಲೆಗಳ ಜೀವಂತ ಸಂಗ್ರಹ — ಹುಡುಕಬಹುದಾದ, ಉಲ್ಲೇಖಿತ, ಎಲ್ಲ ಭಾಷೆಗಳಲ್ಲಿ ಲಭ್ಯ.",
    cta: "ದಾಖಲೆಯನ್ನು ಕೇಳಿ", ask: "ಕೇಳಿ", home: "ಮುಖಪುಟ", timeline: "ಕಾಲರೇಖೆ", archive: "ಸಂಗ್ರಹ",
    placeholder: "ಭಾಷಣ, ಚರ್ಚೆ ಅಥವಾ ವಿಚಾರದ ಬಗ್ಗೆ ಕೇಳಿ…", typeQ: "ನಿಮ್ಮ ಪ್ರಶ್ನೆ ಬರೆಯಿರಿ…",
    evidence: "ಸಾಕ್ಷ್ಯ", listen: "ಕೇಳಿ", stop: "ನಿಲ್ಲಿಸಿ", reading: "ಓದಲಾಗುತ್ತಿದೆ",
    intro: "ಭಾಷಣ, ಚರ್ಚೆ ಅಥವಾ ಹಸ್ತಪ್ರತಿಯ ಬಗ್ಗೆ ಕೇಳಿ. ಪ್ರತಿ ಉತ್ತರವೂ ತನ್ನ ಮೂಲದೊಂದಿಗೆ ಬರುತ್ತದೆ.",
    retrieving: "ಸಂಗ್ರಹವನ್ನು ಹುಡುಕಲಾಗುತ್ತಿದೆ…", noSource: "ಆಧಾರಿತ ಮೂಲವಿಲ್ಲ", results: "ಫಲಿತಾಂಶಗಳು",
    related: "ಸಂಬಂಧಿತ", provenance: "ಮೂಲ", relevance: "ಪ್ರಸ್ತುತತೆ",
    backToArchive: "ಸಂಗ್ರಹಕ್ಕೆ ಹಿಂತಿರುಗಿ", answersIn: "ಉತ್ತರಗಳು ಕನ್ನಡದಲ್ಲಿ", jumpTo: "ನೇರವಾಗಿ ಲೇಖನಕ್ಕೆ ಹೋಗಿ",
  },
  ta: {
    tagline: "எழுத்துக்கள், உரைகள் மற்றும் அரசியலமைப்பு ஆவணங்களின் உயிர்ப்பான தொகுப்பு — தேடக்கூடிய, மேற்கோள் காட்டப்பட்ட, ஒவ்வொரு மொழியிலும் அணுகக்கூடியது.",
    cta: "காப்பகத்தைக் கேளுங்கள்", ask: "கேளுங்கள்", home: "முகப்பு", timeline: "காலவரிசை", archive: "காப்பகம்",
    placeholder: "உரை, விவாதம் அல்லது கருத்து பற்றி கேளுங்கள்…", typeQ: "உங்கள் கேள்வியை எழுதுங்கள்…",
    evidence: "சான்று", listen: "கேட்க", stop: "நிறுத்து", reading: "வாசிக்கப்படுகிறது",
    intro: "உரை, விவாதம் அல்லது கையெழுத்துப் பிரதி பற்றி கேளுங்கள். ஒவ்வொரு பதிலும் அதன் மூலத்துடன் வரும்.",
    retrieving: "காப்பகம் தேடப்படுகிறது…", noSource: "ஆதாரமான மூலம் இல்லை", results: "முடிவுகள்",
    related: "தொடர்புடையவை", provenance: "மூலம்", relevance: "பொருத்தம்",
    backToArchive: "காப்பகத்திற்குத் திரும்பு", answersIn: "பதில்கள் தமிழில்", jumpTo: "நேரடியாக கட்டுரைக்குச் செல்",
  },
};

/* OCR queue is derived from the same corpus the assistant cites, so the
   archivist back end and the visitor front end can never drift apart. */
const OCR_QUEUE = PASSAGES.filter((p) => p.confidence < 0.95).sort((a, b) => a.confidence - b.confidence);

/* ---------------------------------------------------------------------- */
/* Shared pieces                                                           */
/* ---------------------------------------------------------------------- */

function ChakraMark({ size = 22, spinning = false, color = GOLD }) {
  const spokes = Array.from({ length: 24 });
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={spinning ? "animate-[spin_2.4s_linear_infinite]" : ""}>
      <circle cx="24" cy="24" r="21" fill="none" stroke={color} strokeWidth="1.4" />
      {spokes.map((_, i) => {
        const angle = (i * 360) / 24;
        return (
          <line key={i} x1="24" y1="24"
            x2={24 + 20 * Math.cos((angle * Math.PI) / 180)}
            y2={24 + 20 * Math.sin((angle * Math.PI) / 180)}
            stroke={color} strokeWidth="1" opacity="0.85" />
        );
      })}
      <circle cx="24" cy="24" r="3.4" fill={color} />
    </svg>
  );
}

function TypeIcon({ type, size = 14, color }) {
  const props = { size, color: color || "currentColor" };
  if (type === "Writing") return <BookOpen {...props} />;
  if (type === "Speech") return <Mic {...props} />;
  if (type === "Debate") return <Users {...props} />;
  if (type === "Manuscript") return <ScrollText {...props} />;
  return <FileText {...props} />;
}

function StatusChip({ status }) {
  const map = {
    Digitised: { bg: "bg-[#2f4a33]", text: "text-[#dcefd6]", icon: <Check size={11} /> },
    "In review": { bg: "bg-[#5a4420]", text: "text-[#f3dfa8]", icon: <AlertTriangle size={11} /> },
    Queued: { bg: "bg-[#3a3a3a]", text: "text-[#dcdcdc]", icon: <Clock size={11} /> },
  };
  const s = map[status] || map.Queued;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] tracking-wide uppercase ${s.bg} ${s.text}`} style={{ fontFamily: FONT_UI }}>
      {s.icon}{status}
    </span>
  );
}

/* Play / pause / stop cluster. Rendered as spans inside a flex row rather
   than nested buttons, which would be invalid markup. */
function ListenControls({ id, sentences, lang, reader, t, compact = false }) {
  if (!reader.supported) return null;
  const active = reader.speakingId === id;
  const size = compact ? 11 : 12;

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={() => reader.speak(id, sentences, lang)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors hover:bg-[#f2e2c6]"
        style={{
          borderColor: active ? GOLD : "#c9b98c",
          backgroundColor: active ? "#f2e2c6" : "transparent",
          color: "#5a4420", fontFamily: FONT_UI,
          fontSize: compact ? 10 : 11,
        }}
        aria-label={active ? t.stop : t.listen}
      >
        {active ? <Square size={size} /> : <Volume2 size={size} />}
        {active ? t.stop : t.listen}
      </button>

      {active && (
        <button
          onClick={reader.togglePause}
          className="inline-flex items-center justify-center rounded-full border w-6 h-6"
          style={{ borderColor: "#c9b98c", color: "#5a4420" }}
          aria-label={reader.paused ? "Resume" : "Pause"}
        >
          {reader.paused ? <Play size={10} /> : <Pause size={10} />}
        </button>
      )}
    </span>
  );
}

function EvidenceCard({ ev, t, showRelevance }) {
  const conf = Math.round(ev.confidence * 100);
  const confColor = ev.confidence > 0.8 ? "#2f4a33" : ev.confidence > 0.5 ? "#5a4420" : "#5a2020";

  return (
    <div className="rounded-lg border bg-[#faf4e4] p-4" style={{ borderColor: "#d8c79a" }}>
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full"
          style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}>
          <TypeIcon type={ev.kind === "Manuscript" ? "Manuscript" : "Writing"} size={10} /> {ev.kind}
        </span>
        <span className="flex items-center gap-1.5">
          {showRelevance && ev.relevance != null && (
            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}>
              {t.relevance} {Math.round(ev.relevance * 100)}%
            </span>
          )}
          <span className="text-[10px] px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: confColor, fontFamily: FONT_UI }}>
            {conf}% OCR
          </span>
        </span>
      </div>

      <div className="flex gap-2 mb-2">
        <Quote size={14} color={GOLD} className="shrink-0 mt-1" />
        <p className="text-sm italic" style={{ fontFamily: FONT_BODY, color: INKTEXT }}>{ev.quote}</p>
      </div>

      <p className="text-[11px] mb-1.5" style={{ fontFamily: FONT_UI, color: "#5a4420", fontWeight: 600 }}>{ev.citation}</p>
      <p className="text-[11px]" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
        <span className="uppercase tracking-wide">{t.provenance}: </span>{ev.provenance}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Home                                                                    */
/* ---------------------------------------------------------------------- */

function HomeView({ lang, t, onAsk, setTab, openArticle }) {
  const [q, setQ] = useState("");

  // The button says "Ask the archive", so it asks — every time. Matching
  // articles are offered alongside as a shortcut, never instead of asking.
  const submit = (e) => {
    e.preventDefault();
    onAsk(q.trim());
  };

  const suggestions = useMemo(() => (q.trim() ? searchArticles(q).slice(0, 4) : []), [q]);

  return (
    <div className="max-w-5xl mx-auto px-6 pb-24">
      <div className="pt-16 pb-14 text-center">
        <div className="flex justify-center mb-6 opacity-90"><ChakraMark size={40} /></div>
        <p className="uppercase text-xs tracking-[0.25em] mb-4" style={{ fontFamily: FONT_UI, color: GOLD }}>
          Dr. Ambedkar International Centre · Digital Heritage Archive
        </p>
        <h1 className="text-4xl md:text-6xl leading-[1.1] mb-6" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>
          Every word, dated,<br />sourced, and open to ask.
        </h1>
        <p className="max-w-xl mx-auto text-base md:text-lg mb-10" style={{ fontFamily: FONT_BODY, color: "#4a4330" }}>
          {t.tagline}
        </p>

        <form onSubmit={submit} className="max-w-xl mx-auto flex items-center gap-2 bg-[#faf4e4] border border-[#c9b98c] rounded-full pl-5 pr-2 py-2 shadow-sm focus-within:border-[#b3862c] transition-colors">
          <Search size={18} color={GOLD} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.placeholder}
            className="flex-1 bg-transparent outline-none text-sm py-1.5" style={{ fontFamily: FONT_UI, color: INKTEXT }} />
          <button type="submit" data-testid="ask-archive"
            className="rounded-full px-4 py-2 text-sm text-white hover:opacity-90 transition-opacity flex items-center gap-1.5 shrink-0"
            style={{ backgroundColor: INDIGO, fontFamily: FONT_UI }}>
            {t.cta} <ChevronRight size={14} />
          </button>
        </form>

        {suggestions.length > 0 && (
          <div className="max-w-xl mx-auto mt-4">
            <p className="text-[11px] uppercase tracking-wide mb-2" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
              {t.results} — {t.jumpTo}
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestions.map((a) => (
                <button key={a.id} onClick={() => openArticle(a.id)}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border hover:bg-[#f2e2c6] transition-colors"
                  style={{ borderColor: "#c9b98c", color: "#5a4420", fontFamily: FONT_UI }}>
                  <TypeIcon type={a.type} size={11} color={GOLD} /> {a.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-16">
        {[
          { icon: <Database size={18} />, label: `${ARTICLES.length} articles · ${PASSAGES.length} sourced passages`, sub: "Writings, speeches, debates, manuscripts" },
          { icon: <ShieldCheck size={18} />, label: "Citation-grounded, always", sub: "No source above threshold, no answer" },
          { icon: <Volume2 size={18} />, label: "Every article reads aloud", sub: "Five languages, on-device speech" },
        ].map((c, i) => (
          <div key={i} className="rounded-lg border border-[#d8c79a] bg-[#faf4e4] p-5">
            <div style={{ color: GOLD }} className="mb-2">{c.icon}</div>
            <div className="text-sm mb-1" style={{ fontFamily: FONT_UI, color: INKTEXT, fontWeight: 600 }}>{c.label}</div>
            <div className="text-xs" style={{ fontFamily: FONT_UI, color: "#6b6350" }}>{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl overflow-hidden border border-[#d8c79a]" style={{ backgroundColor: INDIGO }}>
        <div className="p-7 md:p-9">
          <p className="uppercase text-[11px] tracking-[0.2em] mb-3" style={{ fontFamily: FONT_UI, color: GOLD_LIGHT }}>One query, every format</p>
          <p className="text-lg md:text-xl mb-6 max-w-2xl" style={{ fontFamily: FONT_DISPLAY, color: CREAM }}>
            A search for “Article 17” surfaces the debate transcript, the drafting manuscript page, and the speech that discuss it — linked, not siloed.
          </p>
          <div className="flex flex-wrap gap-2">
            {["Debate transcript", "Manuscript page", "Speech record"].map((x) => (
              <span key={x} className="text-xs px-3 py-1.5 rounded-full border" style={{ borderColor: "rgba(244,234,208,0.25)", color: CREAM, fontFamily: FONT_UI }}>{x}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="text-center mt-10">
        <button onClick={() => setTab("timeline")} className="text-sm inline-flex items-center gap-1 hover:underline" style={{ fontFamily: FONT_UI, color: INDIGO }}>
          Walk the timeline instead <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Article reader — body, then the evidence beneath it                     */
/* ---------------------------------------------------------------------- */

function ArticleView({ article, lang, t, reader, openArticle, back }) {
  const sentences = useMemo(
    () => [article.title, ...article.body.flatMap(splitSentences)],
    [article]
  );

  const active = reader.speakingId === `article:${article.id}`;
  const related = article.related.map(getArticle).filter(Boolean);

  // Paragraph sentences are numbered from 1 because index 0 is the title.
  let cursor = 1;

  return (
    <div className="max-w-3xl mx-auto px-6 pb-20">
      <button onClick={back} className="mt-8 mb-6 text-sm inline-flex items-center gap-1.5 hover:underline" style={{ fontFamily: FONT_UI, color: INDIGO }}>
        <ArrowLeft size={14} /> {t.backToArchive}
      </button>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className="text-xs px-2.5 py-1 rounded-full inline-flex items-center gap-1.5" style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}>
          <TypeIcon type={article.type} size={11} /> {article.type}
        </span>
        <span className="text-xs" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>{article.date}</span>
        <span className="text-xs" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>· {article.theme}</span>
        <StatusChip status={article.status} />
      </div>

      <h1 className={`text-3xl md:text-4xl mb-3 transition-colors ${active && reader.sentenceIndex === 0 ? "rounded px-1 -mx-1" : ""}`}
        style={{ fontFamily: FONT_DISPLAY, color: INKTEXT, backgroundColor: active && reader.sentenceIndex === 0 ? "#f6e3b4" : "transparent" }}>
        {article.title}
      </h1>
      <p className="text-base mb-5" style={{ fontFamily: FONT_BODY, color: "#4a4330" }}>{article.summary}</p>

      <div className="flex items-center gap-3 mb-8 pb-6 border-b flex-wrap" style={{ borderColor: "#d8c79a" }}>
        <ListenControls id={`article:${article.id}`} sentences={sentences} lang={lang} reader={reader} t={t} />
        {active && (
          <span className="text-[11px] inline-flex items-center gap-1.5" style={{ fontFamily: FONT_UI, color: GOLD }}>
            <ChakraMark size={12} spinning={!reader.paused} />
            {t.reading} — {Math.min(reader.sentenceIndex + 1, sentences.length)}/{sentences.length}
          </span>
        )}
      </div>

      <article className="mb-12">
        {article.body.map((para, pi) => {
          const parts = splitSentences(para);
          return (
            <p key={pi} className="text-base md:text-lg mb-5 leading-relaxed" style={{ fontFamily: FONT_BODY, color: "#332d20" }}>
              {parts.map((s, si) => {
                const idx = cursor++;
                const lit = active && reader.sentenceIndex === idx;
                return (
                  <span key={si} style={{ backgroundColor: lit ? "#f6e3b4" : "transparent", transition: "background-color 200ms" }}>
                    {s}{si < parts.length - 1 ? " " : ""}
                  </span>
                );
              })}
            </p>
          );
        })}
      </article>

      {/* ---- Evidence, directly beneath the article ---- */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck size={16} color={GOLD} />
          <h2 className="text-xl" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>{t.evidence}</h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}>
            {article.evidence.length}
          </span>
        </div>
        <p className="text-xs mb-5" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
          The primary-source passages this article rests on — each with its citation, digitisation status and OCR confidence.
        </p>

        <div className="space-y-3">
          {article.evidence.map((ev) => (
            <div key={ev.id}>
              <EvidenceCard ev={ev} t={t} showRelevance={false} />
              <div className="mt-1.5 mb-1 pl-1">
                <ListenControls id={`ev:${ev.id}`} sentences={splitSentences(ev.quote)} lang="en" reader={reader} t={t} compact />
              </div>
            </div>
          ))}
        </div>
      </section>

      {related.length > 0 && (
        <section className="mt-12">
          <div className="flex items-center gap-2 mb-4">
            <Link2 size={15} color={GOLD} />
            <h2 className="text-lg" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>{t.related}</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {related.map((r) => (
              <button key={r.id} onClick={() => openArticle(r.id)}
                className="text-left rounded-lg border border-[#d8c79a] bg-[#faf4e4] p-4 hover:border-[#b3862c] transition-colors">
                <div className="flex items-center gap-2 mb-1" style={{ color: GOLD }}>
                  <TypeIcon type={r.type} size={13} />
                  <span className="text-[10px] uppercase tracking-wide" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>{r.type} · {r.date}</span>
                </div>
                <span className="text-base" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>{r.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Ask                                                                     */
/* ---------------------------------------------------------------------- */

function AskView({ lang, t, reader, seed, clearSeed, openArticle }) {
  const [messages, setMessages] = useState([{ role: "assistant", intro: true, text: t.intro }]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef(null);
  const counter = useRef(0);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, thinking]);

  const ask = (text) => {
    if (!text.trim() || thinking) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setThinking(true);

    // Retrieval is synchronous; the short delay is honest UI pacing so the
    // "searching" state is legible rather than a flash.
    setTimeout(() => {
      const answer = answerQuestion(text, lang);
      counter.current += 1;
      setMessages((m) => [...m, { role: "assistant", id: `a${counter.current}`, ...answer }]);
      setThinking(false);
    }, 420);
  };

  // StrictMode double-invokes mount effects, and AskView mounts with `seed`
  // already set — without this ref the seeded question is asked twice.
  const seeded = useRef(null);
  useEffect(() => {
    if (seed && seeded.current !== seed) {
      seeded.current = seed;
      ask(seed);
      clearSeed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // The greeting is captured at mount, so switching language left it stale.
  useEffect(() => {
    setMessages((m) => (m.length && m[0].intro ? [{ ...m[0], text: t.intro }, ...m.slice(1)] : m));
  }, [t.intro]);

  return (
    <div className="max-w-3xl mx-auto px-6 pb-10 flex flex-col" style={{ minHeight: "70vh" }}>
      <div className="flex items-center justify-between py-6 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ChakraMark size={22} spinning={thinking} />
          <span className="text-sm" style={{ fontFamily: FONT_UI, color: INKTEXT, fontWeight: 600 }}>AI Research Assistant</span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full"
          style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}>
          <Languages size={11} /> {t.answersIn}
        </span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto pr-1" style={{ maxHeight: "52vh" }}>
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm ${m.role === "user" ? "rounded-br-sm" : "rounded-bl-sm"}`}
              style={{
                backgroundColor: m.role === "user" ? INDIGO : m.fallback ? "#f2e2c6" : "#faf4e4",
                color: m.role === "user" ? CREAM : INKTEXT,
                border: m.role === "assistant" ? `1px solid ${m.fallback ? "#c99a3f" : "#d8c79a"}` : "none",
                fontFamily: FONT_BODY,
              }}>
              {m.fallback && !m.intro && (
                <div className="flex items-center gap-1.5 mb-1.5 text-xs uppercase tracking-wide" style={{ fontFamily: FONT_UI, color: VERMIL }}>
                  <AlertTriangle size={12} /> {t.noSource}
                </div>
              )}

              <p>{m.text}</p>
              {m.note && <p className="mt-1.5 text-[11px]" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>{m.note}</p>}

              {m.citations?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {m.citations.map((c, ci) => (
                    <span key={ci} className="text-[11px] px-2 py-1 rounded-md flex items-center gap-1" style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}>
                      <FileText size={10} /> {c}
                    </span>
                  ))}
                </div>
              )}

              {m.role === "assistant" && !m.intro && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <ListenControls id={`msg:${m.id || i}`} sentences={splitSentences(m.text)} lang={lang} reader={reader} t={t} compact />
                  {m.score > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}>
                      match {m.score}
                    </span>
                  )}
                </div>
              )}

              {/* Evidence beneath the answer, same as beneath an article */}
              {m.evidence?.length > 0 && (
                <details className="mt-3">
                  <summary className="text-[11px] cursor-pointer inline-flex items-center gap-1" style={{ fontFamily: FONT_UI, color: INDIGO }}>
                    <ShieldCheck size={11} /> {t.evidence} ({m.evidence.length})
                  </summary>
                  <div className="mt-2.5 space-y-2.5">
                    {m.evidence.map((ev) => (
                      <div key={ev.id}>
                        <EvidenceCard ev={ev} t={t} showRelevance />
                        <button onClick={() => openArticle(ev.articleId)}
                          className="mt-1.5 text-[11px] inline-flex items-center gap-1 hover:underline" style={{ fontFamily: FONT_UI, color: INDIGO }}>
                          {ev.articleTitle} <ChevronRight size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}

        {thinking && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm px-4 py-3 text-sm border" style={{ backgroundColor: "#faf4e4", borderColor: "#d8c79a", fontFamily: FONT_UI, color: "#6b6350" }}>
              {t.retrieving}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex flex-wrap gap-2 my-4">
        {PRESET_QUESTIONS.map((q) => (
          <button key={q} onClick={() => ask(q)} className="text-xs px-3 py-1.5 rounded-full border hover:bg-[#f2e2c6] transition-colors text-left"
            style={{ borderColor: "#c9b98c", color: "#5a4420", fontFamily: FONT_UI }}>
            {q}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex items-center gap-2 bg-[#faf4e4] border border-[#c9b98c] rounded-full pl-4 pr-2 py-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t.typeQ}
          className="flex-1 bg-transparent outline-none text-sm min-w-0" style={{ fontFamily: FONT_UI, color: INKTEXT }} />
        <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}>{LANGS[lang]}</span>
        <button type="submit" className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0" style={{ backgroundColor: INDIGO }} aria-label="Send">
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Timeline                                                                */
/* ---------------------------------------------------------------------- */

function TimelineView({ t, reader, lang, openArticle }) {
  const [active, setActive] = useState(3);
  const entry = TIMELINE[active];
  const sentences = useMemo(() => [entry.title, ...splitSentences(entry.detail)], [entry]);

  return (
    <div className="max-w-5xl mx-auto px-6 pb-20">
      <div className="pt-12 pb-8 text-center">
        <p className="uppercase text-xs tracking-[0.25em] mb-3" style={{ fontFamily: FONT_UI, color: GOLD }}>Interactive timeline</p>
        <h2 className="text-3xl md:text-4xl" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>A life read across formats</h2>
      </div>

      <div className="relative mb-12 overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="absolute left-0 right-0 top-5 h-px" style={{ backgroundColor: "#c9b98c" }} />
          <div className="flex justify-between relative">
            {TIMELINE.map((e, i) => (
              <button key={i} onClick={() => setActive(i)} className="flex flex-col items-center gap-2" style={{ width: `${100 / TIMELINE.length}%` }}>
                <span className="w-3.5 h-3.5 rounded-full border-2 transition-all z-10"
                  style={{
                    backgroundColor: i === active ? GOLD : PARCH,
                    borderColor: i === active ? GOLD : "#c9b98c",
                    transform: i === active ? "scale(1.3)" : "scale(1)",
                  }} />
                <span className="text-[11px] text-center leading-tight" style={{ fontFamily: FONT_UI, color: i === active ? INKTEXT : "#8a7f63", fontWeight: i === active ? 600 : 400 }}>
                  {e.year}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#d8c79a] bg-[#faf4e4] p-7 md:p-9">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="text-xs px-2.5 py-1 rounded-full" style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}>{entry.tag}</span>
          <span className="text-xs" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>{entry.year}</span>
          <ListenControls id={`tl:${active}`} sentences={sentences} lang={lang} reader={reader} t={t} compact />
        </div>
        <h3 className="text-2xl mb-3" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>{entry.title}</h3>
        <p className="text-sm md:text-base mb-6 max-w-2xl" style={{ fontFamily: FONT_BODY, color: "#4a4330" }}>{entry.detail}</p>
        {entry.article && (
          <button onClick={() => openArticle(entry.article)}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-full text-white hover:opacity-90 transition-opacity"
            style={{ backgroundColor: INDIGO, fontFamily: FONT_UI }}>
            Read the article and its evidence <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Archive                                                                 */
/* ---------------------------------------------------------------------- */

function ArchiveView({ openArticle }) {
  const [type, setType] = useState("All");
  const [theme, setTheme] = useState("All");
  const filtered = ARTICLES.filter(
    (it) => (type === "All" || it.type === type) && (theme === "All" || it.theme === theme)
  );

  return (
    <div className="max-w-5xl mx-auto px-6 pb-20">
      <div className="pt-12 pb-8">
        <p className="uppercase text-xs tracking-[0.25em] mb-3" style={{ fontFamily: FONT_UI, color: GOLD }}>Browse the archive</p>
        <h2 className="text-3xl md:text-4xl mb-6" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>By theme, not by shelf</h2>

        <div className="flex flex-wrap gap-2 mb-3">
          {TYPES.map((x) => (
            <button key={x} onClick={() => setType(x)} className="text-xs px-3 py-1.5 rounded-full border transition-colors"
              style={{ borderColor: x === type ? GOLD : "#c9b98c", backgroundColor: x === type ? "#efe0bb" : "transparent", color: "#5a4420", fontFamily: FONT_UI }}>
              {x}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {THEMES.map((x) => (
            <button key={x} onClick={() => setTheme(x)} className="text-xs px-3 py-1.5 rounded-full border transition-colors"
              style={{ borderColor: x === theme ? INDIGO : "#c9b98c", backgroundColor: x === theme ? INDIGO : "transparent", color: x === theme ? CREAM : "#5a4420", fontFamily: FONT_UI }}>
              {x}
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {filtered.map((it) => (
          <button key={it.id} onClick={() => openArticle(it.id)}
            className="text-left rounded-lg border border-[#d8c79a] bg-[#faf4e4] p-5 flex flex-col gap-3 hover:border-[#b3862c] transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2" style={{ color: GOLD }}>
                <TypeIcon type={it.type} size={16} />
                <span className="text-[11px] uppercase tracking-wide" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>{it.type} · {it.date}</span>
              </div>
              <StatusChip status={it.status} />
            </div>
            <h3 className="text-lg" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>{it.title}</h3>
            <p className="text-xs" style={{ fontFamily: FONT_UI, color: "#6b6350" }}>{it.summary}</p>
            <span className="text-[11px] inline-flex items-center gap-1 mt-auto" style={{ fontFamily: FONT_UI, color: INDIGO }}>
              <ShieldCheck size={11} /> {it.evidence.length} sourced passages <ChevronRight size={11} />
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm col-span-2 text-center py-10" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>No items match this filter yet.</p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Archivist back end                                                      */
/* ---------------------------------------------------------------------- */

function ArchivistView() {
  const [sub, setSub] = useState("overview");
  const [reviewing, setReviewing] = useState(null);

  const subs = [
    { id: "overview", label: "Overview", icon: <LayoutGrid size={14} /> },
    { id: "ocr", label: "OCR queue", icon: <ListChecks size={14} /> },
    { id: "metadata", label: "Metadata", icon: <PencilLine size={14} /> },
    { id: "versions", label: "Versions", icon: <History size={14} /> },
  ];

  return (
    <div className="max-w-5xl mx-auto px-6 pb-20">
      <div className="pt-12 pb-6">
        <p className="uppercase text-xs tracking-[0.25em] mb-3" style={{ fontFamily: FONT_UI, color: GOLD }}>Archivist back end</p>
        <h2 className="text-3xl md:text-4xl mb-6" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>The other half of the platform</h2>
        <div className="flex gap-2 flex-wrap">
          {subs.map((s) => (
            <button key={s.id} onClick={() => setSub(s.id)} className="text-xs px-3 py-1.5 rounded-full border flex items-center gap-1.5"
              style={{ borderColor: s.id === sub ? INDIGO : "#c9b98c", backgroundColor: s.id === sub ? INDIGO : "transparent", color: s.id === sub ? CREAM : "#5a4420", fontFamily: FONT_UI }}>
              {s.icon}{s.label}
            </button>
          ))}
        </div>
      </div>

      {sub === "overview" && (
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { label: "Passages indexed", value: PASSAGES.length, icon: <Database size={16} /> },
            { label: "Below OCR threshold", value: OCR_QUEUE.length, icon: <ListChecks size={16} /> },
            { label: "Articles published", value: ARTICLES.length, icon: <BookOpen size={16} /> },
          ].map((s, i) => (
            <div key={i} className="rounded-lg border border-[#d8c79a] bg-[#faf4e4] p-5">
              <div style={{ color: GOLD }} className="mb-2">{s.icon}</div>
              <div className="text-2xl mb-1" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>{s.value}</div>
              <div className="text-xs" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {sub === "ocr" && (
        <div className="space-y-3">
          {OCR_QUEUE.map((item) => (
            <div key={item.id} className="rounded-lg border border-[#d8c79a] bg-[#faf4e4] overflow-hidden">
              <button onClick={() => setReviewing(reviewing === item.id ? null : item.id)} className="w-full flex items-center justify-between p-4 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <ScrollText size={16} color={GOLD} className="shrink-0" />
                  <span className="text-sm text-left truncate" style={{ fontFamily: FONT_UI, color: INKTEXT, fontWeight: 600 }}>{item.citation}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs px-2 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: item.confidence > 0.8 ? "#2f4a33" : item.confidence > 0.5 ? "#5a4420" : "#5a2020", fontFamily: FONT_UI }}>
                    {Math.round(item.confidence * 100)}%
                  </span>
                  <ChevronDown size={14} style={{ transform: reviewing === item.id ? "rotate(180deg)" : "none" }} />
                </div>
              </button>
              {reviewing === item.id && (
                <div className="px-4 pb-4 grid sm:grid-cols-2 gap-3">
                  <div className="rounded-md bg-[#f2e2c6] p-3 text-xs" style={{ fontFamily: "monospace", color: "#5a4420" }}>
                    <p className="uppercase tracking-wide mb-1 text-[10px]" style={{ fontFamily: FONT_UI }}>Transcribed text</p>
                    {item.quote}
                  </div>
                  <div className="rounded-md bg-[#eaf1e6] p-3 text-xs" style={{ fontFamily: "monospace", color: "#2f4a33" }}>
                    <p className="uppercase tracking-wide mb-1 text-[10px]" style={{ fontFamily: FONT_UI }}>Provenance note</p>
                    {item.confidence < 0.5 ? "— awaiting human review —" : item.provenance}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {sub === "metadata" && (
        <div className="rounded-lg border border-[#d8c79a] bg-[#faf4e4] overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]" style={{ fontFamily: FONT_UI }}>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "#8a7f63" }}>
                <th className="p-3">Title</th><th className="p-3">Date</th><th className="p-3">Theme</th><th className="p-3">Evidence</th><th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {ARTICLES.map((it) => (
                <tr key={it.id} className="border-t" style={{ borderColor: "#e6d9b3" }}>
                  <td className="p-3" style={{ color: INKTEXT }}>{it.title}</td>
                  <td className="p-3" style={{ color: "#8a7f63" }}>{it.date}</td>
                  <td className="p-3" style={{ color: "#8a7f63" }}>{it.theme}</td>
                  <td className="p-3" style={{ color: "#8a7f63" }}>{it.evidence.length}</td>
                  <td className="p-3"><StatusChip status={it.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === "versions" && (
        <div className="rounded-lg border border-[#d8c79a] bg-[#faf4e4] p-5">
          <h3 className="text-lg mb-4" style={{ fontFamily: FONT_DISPLAY, color: INKTEXT }}>Mahad declaration, page 2 — version history</h3>
          <div className="space-y-3">
            {[
              { v: "v3", note: "OCR correction applied: 'deprssed' → 'depressed' on line 1", by: "archivist_02", when: "2 days ago" },
              { v: "v2", note: "Metadata tags added: Social Justice, 1927", by: "archivist_01", when: "5 days ago" },
              { v: "v1", note: "Initial ingest from scanned source", by: "system", when: "9 days ago" },
            ].map((h, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <CircleDot size={14} color={GOLD} className="mt-0.5 shrink-0" />
                <div>
                  <span style={{ fontFamily: FONT_UI, color: INKTEXT, fontWeight: 600 }}>{h.v} · </span>
                  <span style={{ fontFamily: FONT_UI, color: "#4a4330" }}>{h.note}</span>
                  <div className="text-xs" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>{h.by} — {h.when}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* App shell                                                               */
/* ---------------------------------------------------------------------- */

export default function App() {
  const [mode, setMode] = useState("visitor");
  const [tab, setTab] = useState("home");
  const [lang, setLang] = useState("en");
  const [articleId, setArticleId] = useState(null);
  const [seed, setSeed] = useState(null);

  const reader = useReadAloud();
  const t = UI[lang] || UI.en;

  const visitorTabs = [
    { id: "home", label: t.home, icon: <Sparkles size={14} /> },
    { id: "ask", label: t.ask, icon: <MessageCircle size={14} /> },
    { id: "timeline", label: t.timeline, icon: <Clock size={14} /> },
    { id: "archive", label: t.archive, icon: <LayoutGrid size={14} /> },
  ];

  useEffect(() => {
    if (mode === "archivist") setTab("archivist");
    else if (tab === "archivist") setTab("home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Any navigation silences the reader — otherwise it keeps narrating a page
  // that is no longer on screen.
  const go = (next) => { reader.stop(); setArticleId(null); setTab(next); };
  const openArticle = (id) => { reader.stop(); setArticleId(id); window.scrollTo({ top: 0 }); };
  const askThis = (q) => {
    reader.stop();
    setArticleId(null);
    if (q) setSeed(q);
    setTab("ask");
  };

  const article = articleId ? getArticle(articleId) : null;

  return (
    <div style={{ backgroundColor: PARCH, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Tiro+Devanagari+Hindi:ital@0;1&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=Work+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: ${GOLD_LIGHT}; }
        details > summary { list-style: none; }
        details > summary::-webkit-details-marker { display: none; }
      `}</style>

      <header className="sticky top-0 z-20" style={{ backgroundColor: INK }}>
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <button onClick={() => go("home")} className="flex items-center gap-2.5 shrink-0">
            <ChakraMark size={20} />
            <div className="text-left">
              <div className="text-sm tracking-wide" style={{ fontFamily: FONT_UI, color: CREAM, fontWeight: 600 }}>DAIC ARCHIVE</div>
              <div className="text-[10px] hidden sm:block" style={{ fontFamily: FONT_UI, color: "#8a97b8" }}>Ambedkar International Centre</div>
            </div>
          </button>

          {mode === "visitor" && (
            <nav className="hidden md:flex items-center gap-1">
              {visitorTabs.map((x) => (
                <button key={x.id} onClick={() => go(x.id)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-colors"
                  style={{ fontFamily: FONT_UI, color: tab === x.id && !article ? INK : CREAM, backgroundColor: tab === x.id && !article ? GOLD_LIGHT : "transparent" }}>
                  {x.icon}{x.label}
                </button>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex items-center gap-1 rounded-full p-0.5" style={{ backgroundColor: INDIGO }}>
              {Object.entries(LANGS).map(([code, label]) => (
                <button key={code} onClick={() => { reader.stop(); setLang(code); }} className="text-[11px] px-2 py-1 rounded-full transition-colors"
                  style={{ fontFamily: FONT_UI, color: lang === code ? INK : CREAM, backgroundColor: lang === code ? GOLD_LIGHT : "transparent" }}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => { reader.stop(); setMode(mode === "visitor" ? "archivist" : "visitor"); }}
              className="text-[11px] px-3 py-1.5 rounded-full border flex items-center gap-1.5"
              style={{ fontFamily: FONT_UI, color: CREAM, borderColor: "rgba(244,234,208,0.3)" }}>
              <ShieldCheck size={12} />
              <span className="hidden sm:inline">{mode === "visitor" ? "Visitor mode" : "Archivist mode"}</span>
            </button>
          </div>
        </div>

        {mode === "visitor" && (
          <div className="md:hidden flex justify-center gap-1 pb-2 px-4 flex-wrap">
            {visitorTabs.map((x) => (
              <button key={x.id} onClick={() => go(x.id)} className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full"
                style={{ fontFamily: FONT_UI, color: tab === x.id && !article ? INK : CREAM, backgroundColor: tab === x.id && !article ? GOLD_LIGHT : "transparent" }}>
                {x.icon}{x.label}
              </button>
            ))}
          </div>
        )}

        <div className="sm:hidden flex justify-center gap-1 pb-2">
          {Object.entries(LANGS).map(([code, label]) => (
            <button key={code} onClick={() => { reader.stop(); setLang(code); }} className="text-[11px] px-2 py-0.5 rounded-full"
              style={{ fontFamily: FONT_UI, color: lang === code ? INK : CREAM, backgroundColor: lang === code ? GOLD_LIGHT : "transparent" }}>
              {label}
            </button>
          ))}
        </div>
      </header>

      {mode === "archivist" ? (
        <ArchivistView />
      ) : article ? (
        <ArticleView article={article} lang={lang} t={t} reader={reader} openArticle={openArticle} back={() => go("archive")} />
      ) : (
        <>
          {tab === "home" && <HomeView lang={lang} t={t} onAsk={askThis} setTab={go} openArticle={openArticle} />}
          {tab === "ask" && <AskView lang={lang} t={t} reader={reader} seed={seed} clearSeed={() => setSeed(null)} openArticle={openArticle} />}
          {tab === "timeline" && <TimelineView t={t} reader={reader} lang={lang} openArticle={openArticle} />}
          {tab === "archive" && <ArchiveView openArticle={openArticle} />}
        </>
      )}

      <footer className="py-8 text-center text-[11px] px-6" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
        SIH 2026 · PS 26096 · Prototype UI — grounded on public corpora (Collected Works, Constituent Assembly Debates, NDLI)
      </footer>
    </div>
  );
}

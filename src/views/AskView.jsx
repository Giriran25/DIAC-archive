import { useState, useRef, useEffect } from "react";
import {
  Send, ShieldCheck, FileText, Languages, AlertTriangle,
} from "lucide-react";
import ChakraMark from "../components/ChakraMark.jsx";
import ListenControls from "../components/ui/ListenControls.jsx";
import EvidenceCard from "../components/evidence/EvidenceCard.jsx";
import ResponseBadge from "../components/ui/ResponseBadge.jsx";
import LoadingSteps from "../components/ui/LoadingSteps.jsx";
import { splitSentences } from "../lib/retrieval.js";
import { api } from "../lib/api/endpoints.js";
import { ApiError } from "../lib/api/client.js";
import { readAnswer, ANSWER_STATE } from "../lib/api/askState.js";
import { PRESET_QUESTIONS } from "../lib/i18n.js";
import {
  FONT_BODY, FONT_UI,
  INDIGO, CREAM, INKTEXT, VERMIL,
} from "../lib/tokens.js";

/* ---------------------------------------------------------------------- */
/* AI Research Assistant view                                              */
/* ---------------------------------------------------------------------- */

export default function AskView({ lang, t, reader, seed, clearSeed, openArticle }) {
  const [messages, setMessages] = useState([{ role: "assistant", intro: true, text: t.intro }]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef(null);
  const counter = useRef(0);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, thinking]);

  /* Questions are answered by the archive's own pipeline: retrieve, gate,
     and only then generate. The frontend does not rank, summarise or phrase
     anything — it renders whichever of the three states came back, because
     the difference between a grounded answer and a fallback one is the
     whole reason this archive can be cited. */
  const ask = async (text) => {
    if (!text.trim() || thinking) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setThinking(true);

    counter.current += 1;
    const id = `a${counter.current}`;

    try {
      const payload = await api.ask({ question: text.trim(), lang });
      const answer = readAnswer(payload);

      setMessages((m) => [...m, {
        role: "assistant",
        id,
        responseType: answer.state,
        text: answer.answer || t.noSourceBody || "",
        fallback: answer.state === ANSWER_STATE.REFUSED,
        /* Citations are the backend's validated ids, resolved against the
           evidence it actually returned. Nothing is composed here. */
        citations: answer.evidence.map((ev) => ev.citation).filter(Boolean),
        evidence: answer.evidence,
        degradedReason: answer.degraded,
        gateReason: answer.reason,
        provider: answer.provider,
        note: payload?.note ?? null,
      }]);
    } catch (err) {
      /* An unreachable archive is not a refusal and must never look like
         one: a refusal is a judgement about evidence, this is a broken
         connection, and conflating them would put words in the archive's
         mouth. */
      setMessages((m) => [...m, {
        role: "assistant",
        id,
        responseType: null,
        unreachable: true,
        text: err instanceof ApiError
          ? err.userMessage
          : "The archive service could not be reached from this device.",
      }]);
    } finally {
      setThinking(false);
    }
  };

  const seeded = useRef(null);
  useEffect(() => {
    if (seed && seeded.current !== seed) {
      seeded.current = seed;
      ask(seed);
      clearSeed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  useEffect(() => {
    setMessages((m) => (m.length && m[0].intro ? [{ ...m[0], text: t.intro }, ...m.slice(1)] : m));
  }, [t.intro]);

  const hasConversation = messages.length > 1 || thinking;

  return (
    <main id="main-content" className="max-w-3xl mx-auto px-6 pb-10 flex flex-col" style={{ minHeight: "70vh" }}>
      <div className="flex items-center justify-between py-6 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ChakraMark size={22} spinning={thinking} />
          <div>
            <span
              className="text-sm block"
              style={{ fontFamily: FONT_UI, color: INKTEXT, fontWeight: 600 }}
            >
              AI Research Assistant
            </span>
            {!hasConversation && (
              <span
                className="text-[11px] block mt-0.5"
                style={{ fontFamily: FONT_UI, color: "#8a7f63" }}
              >
                Ask about Ambedkar's writings, speeches, constitutional debates, ideas, historical records, manuscripts
              </span>
            )}
          </div>
        </div>
        <span
          className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full"
          style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}
        >
          <Languages size={11} /> {t.answersIn}
        </span>
      </div>

      <div
        className="flex-1 space-y-4 overflow-y-auto pr-1"
        style={{ maxHeight: "52vh" }}
        role="log"
        aria-label="Conversation"
        aria-live="polite"
      >
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm ${m.role === "user" ? "rounded-br-sm" : "rounded-bl-sm"}`}
              style={{
                backgroundColor: m.role === "user" ? INDIGO
                  : m.unreachable ? "#f7e6e2"
                  : m.fallback ? "#f2e2c6" : "#faf4e4",
                color: m.role === "user" ? CREAM : INKTEXT,
                border: m.role === "assistant"
                  ? `1px solid ${m.unreachable ? "#e0b4a8" : m.fallback ? "#c99a3f" : "#d8c79a"}`
                  : "none",
                fontFamily: FONT_BODY,
              }}
            >
              {m.unreachable && (
                <div
                  className="flex items-center gap-1.5 mb-1.5 text-xs uppercase tracking-wide"
                  style={{ fontFamily: FONT_UI, color: VERMIL }}
                >
                  <AlertTriangle size={12} /> Archive unavailable
                </div>
              )}

              {m.fallback && !m.intro && !m.unreachable && (
                <div
                  className="flex items-center gap-1.5 mb-1.5 text-xs uppercase tracking-wide"
                  style={{ fontFamily: FONT_UI, color: VERMIL }}
                >
                  <AlertTriangle size={12} /> {t.noSource}
                </div>
              )}

              {m.role === "assistant" && !m.intro && !m.fallback && !m.unreachable && m.responseType && (
                <div className="mb-2">
                  <ResponseBadge type={m.responseType} t={t} />
                </div>
              )}

              <p>{m.text}</p>
              {m.note && (
                <p className="mt-1.5 text-[11px]" style={{ fontFamily: FONT_UI, color: "#8a7f63" }}>
                  {m.note}
                </p>
              )}

              {m.responseType === "degraded" && (
                <p className="mt-1.5 text-[11px]" style={{ fontFamily: FONT_UI, color: "#5a4420" }}>
                  {t.degradedNote}
                  {/* Why the archive fell back, in its own words rather than ours. */}
                  {m.degradedReason ? ` (${m.degradedReason})` : null}
                </p>
              )}

              {m.responseType === "refused" && m.gateReason && (
                <p className="mt-1.5 text-[11px]" style={{ fontFamily: FONT_UI, color: "#5a4420" }}>
                  Reason given by the archive: {m.gateReason}
                </p>
              )}

              {m.citations?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {m.citations.map((c, ci) => (
                    <span
                      key={ci}
                      className="text-[11px] px-2 py-1 rounded-md flex items-center gap-1"
                      style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}
                    >
                      <FileText size={10} /> {c}
                    </span>
                  ))}
                </div>
              )}

              {m.role === "assistant" && !m.intro && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <ListenControls
                    id={`msg:${m.id || i}`}
                    sentences={splitSentences(m.text)}
                    lang={lang}
                    reader={reader}
                    t={t}
                    compact
                  />
                  {m.provider && (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}
                      title="The component that produced this answer"
                    >
                      {m.provider}
                    </span>
                  )}
                </div>
              )}

              {m.evidence?.length > 0 && !m.fallback && (
                <details className="mt-3">
                  <summary
                    className="text-[11px] cursor-pointer inline-flex items-center gap-1"
                    style={{ fontFamily: FONT_UI, color: INDIGO }}
                  >
                    <ShieldCheck size={11} /> {t.evidence} ({m.evidence.length})
                  </summary>
                  <div className="mt-2.5 space-y-2.5">
                    {m.evidence.map((ev) => (
                      <div key={ev.id}>
                        <EvidenceCard
                          ev={ev}
                          t={t}
                          showRelevance
                          onReadArticle={openArticle}
                        />
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
            <LoadingSteps t={t} />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex flex-wrap gap-2 my-4" role="group" aria-label="Suggested questions">
        {PRESET_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => ask(q)}
            className="daic-suggestion text-xs px-3 py-1.5 rounded-full border hover:bg-[#f2e2c6] transition-colors text-left"
            style={{ borderColor: "#c9b98c", color: "#5a4420", fontFamily: FONT_UI }}
          >
            {q}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        className="flex items-center gap-2 bg-[#faf4e4] border border-[#c9b98c] rounded-full pl-4 pr-2 py-2 focus-within:border-[#b3862c] transition-colors"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t.typeQ}
          className="flex-1 bg-transparent outline-none text-sm min-w-0"
          style={{ fontFamily: FONT_UI, color: INKTEXT }}
          aria-label={t.typeQ}
        />
        <span
          className="text-[10px] px-2 py-0.5 rounded-full shrink-0"
          style={{ backgroundColor: "#efe0bb", color: "#5a4420", fontFamily: FONT_UI }}
        >
          {({ en: "EN", hi: "हिं", mr: "मर", kn: "ಕನ್ನ", ta: "தமி" })[lang]}
        </span>
        <button
          type="submit"
          className="daic-btn w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0"
          style={{ backgroundColor: INDIGO }}
          aria-label="Send"
        >
          <Send size={14} />
        </button>
      </form>
    </main>
  );
}

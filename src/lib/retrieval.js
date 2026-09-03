/* ---------------------------------------------------------------------- *
 * Local grounded retrieval — runs entirely in the browser, no API key.
 *
 * Ranking is BM25 over the evidence passages in src/data/corpus.js. The
 * answer is EXTRACTIVE: the sentences it returns are lifted verbatim from
 * the ranked passages, never paraphrased and never generated. That is the
 * whole point — a citation can only ever name a passage that physically
 * exists, and if nothing scores above the confidence floor the engine
 * refuses to answer rather than guessing.
 * ---------------------------------------------------------------------- */

import { ARTICLES, PASSAGES } from "../data/corpus.js";
import { splitSentences } from "./sentences.js";

const STOPWORDS = new Set([
  "a", "about", "an", "and", "any", "are", "as", "at", "be", "been", "but", "by",
  "can", "did", "do", "does", "for", "from", "had", "has", "have", "he", "her",
  "his", "how", "i", "in", "is", "it", "its", "me", "my", "of", "on", "or",
  "our", "say", "said", "says", "she", "should", "so", "some", "such", "than",
  "that", "the", "their", "them", "then", "there", "these", "they", "this",
  "to", "was", "we", "were", "what", "when", "where", "which", "who", "why",
  "will", "with", "would", "you", "your", "tell", "give", "show", "explain",
  "please", "did", "was", "about",
]);

/* Query words that are really archive vocabulary — worth expanding so a
   visitor's phrasing reaches the language the sources actually use.
   Kept deliberately tight: a synonym list that reaches for generic words
   ("social", "political") drags in every passage that happens to use them,
   which is how the Preamble once outranked the actual answer on a question
   about social democracy. */
const SYNONYMS = {
  labour: ["worker", "workers", "working", "employment", "wages"],
  labor: ["labour", "worker", "workers", "working", "employment"],
  work: ["working", "labour", "worker"],
  caste: ["castes", "outcaste", "untouchability"],
  untouchability: ["untouchable", "caste", "disability"],
  constitution: ["constitutional", "drafting", "assembly"],
  democracy: ["democratic", "franchise"],
  buddhism: ["buddha", "dhamma", "conversion", "nagpur"],
  conversion: ["buddha", "buddhism", "dhamma", "nagpur"],
  rights: ["right", "liberty", "freedom"],
  economy: ["economic", "industries", "socialism", "wealth"],
  economic: ["economy", "industries", "socialism", "wealth"],
  women: ["sex", "maternity", "woman"],
};

/* A synonym is a guess about what the visitor meant; a word they actually
   typed is not. Expanded terms therefore score at a discount. */
const SYNONYM_WEIGHT = 0.45;
const STEM_WEIGHT = 0.8;

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function contentTerms(text) {
  return tokenize(text).filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function expand(terms) {
  // term -> weight; a term reached by several routes keeps its highest weight
  const out = new Map();
  const bump = (term, w) => out.set(term, Math.max(out.get(term) || 0, w));

  for (const t of terms) {
    bump(t, 1);
    // crude stem so "labourers"/"labour" and "rights"/"right" collide
    if (t.length > 4 && t.endsWith("s")) bump(t.slice(0, -1), STEM_WEIGHT);
    for (const s of SYNONYMS[t] || []) bump(s, SYNONYM_WEIGHT);
  }
  return out;
}

/* ---- index built once at module load ---------------------------------- */

const DOCS = PASSAGES.map((p) => {
  const searchable = `${p.quote} ${p.citation} ${p.articleTitle} ${p.theme}`;
  return { passage: p, terms: tokenize(searchable) };
});

const AVG_LEN = DOCS.reduce((n, d) => n + d.terms.length, 0) / DOCS.length;

const DF = new Map();
for (const d of DOCS) {
  for (const t of new Set(d.terms)) DF.set(t, (DF.get(t) || 0) + 1);
}

function idf(term) {
  const df = DF.get(term) || 0;
  if (df === 0) return 0;
  return Math.log(1 + (DOCS.length - df + 0.5) / (df + 0.5));
}

const K1 = 1.5;
const B = 0.75;

function bm25(doc, terms) {
  let score = 0;
  for (const [term, qWeight] of terms) {
    const weight = idf(term) * qWeight;
    if (weight === 0) continue;
    let tf = 0;
    for (const t of doc.terms) if (t === term) tf++;
    if (tf === 0) continue;
    const norm = 1 - B + B * (doc.terms.length / AVG_LEN);
    score += weight * ((tf * (K1 + 1)) / (tf + K1 * norm));
  }
  return score;
}

/* ---- sentence-level extraction ----------------------------------------
   splitSentences now lives in lib/sentences.js so that production views can
   use it without importing this module, which carries the demo corpus. */
export { splitSentences };

function bestSentences(quote, terms, limit) {
  const sentences = splitSentences(quote);
  const scored = sentences.map((s, i) => {
    const toks = tokenize(s);
    let hits = 0;
    for (const [term, w] of terms) if (toks.includes(term)) hits += w;
    // small positional bonus keeps the opening sentence when nothing matches
    return { s, i, score: hits + (i === 0 ? 0.25 : 0) };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const picked = scored.slice(0, limit).filter((x) => x.score > 0);
  const chosen = (picked.length ? picked : scored.slice(0, 1)).sort((a, b) => a.i - b.i);
  return chosen.map((x) => x.s).join(" ");
}

/* ---- localisation ------------------------------------------------------ */

const LEAD_IN = {
  en: "From the archive:",
  hi: "अभिलेख से:",
  mr: "संग्रहातून:",
  kn: "ದಾಖಲೆಯಿಂದ:",
  ta: "காப்பகத்திலிருந்து:",
};

const SOURCE_NOTE = {
  en: "Quoted in the original English of the source.",
  hi: "स्रोत की मूल अंग्रेज़ी में उद्धृत।",
  mr: "स्रोताच्या मूळ इंग्रजीत उद्धृत.",
  kn: "ಮೂಲದ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಉಲ್ಲೇಖಿಸಲಾಗಿದೆ.",
  ta: "மூலத்தின் ஆங்கிலத்தில் மேற்கோள் காட்டப்பட்டுள்ளது.",
};

const NO_SOURCE = {
  en: "No source in the archive clears the confidence threshold for that question. Rather than guess, I would rather say so — try rephrasing, or browse the Archive directly.",
  hi: "इस प्रश्न के लिए संग्रह का कोई स्रोत विश्वसनीयता की सीमा पार नहीं करता। अनुमान लगाने के बजाय मैं यह कहना उचित समझता हूँ — प्रश्न दोबारा लिखें, या संग्रह सीधे देखें।",
  mr: "या प्रश्नासाठी संग्रहातील कोणताही स्रोत विश्वासार्हतेची पातळी गाठत नाही. अंदाज लावण्याऐवजी हे सांगणे योग्य — प्रश्न पुन्हा मांडा, किंवा संग्रह थेट पाहा.",
  kn: "ಈ ಪ್ರಶ್ನೆಗೆ ದಾಖಲೆಯಲ್ಲಿನ ಯಾವುದೇ ಮೂಲವು ವಿಶ್ವಾಸಾರ್ಹತೆಯ ಮಿತಿಯನ್ನು ದಾಟುವುದಿಲ್ಲ. ಊಹಿಸುವ ಬದಲು ಇದನ್ನು ಹೇಳುವುದೇ ಸರಿ — ಪ್ರಶ್ನೆಯನ್ನು ಬೇರೆ ರೀತಿ ಕೇಳಿ.",
  ta: "இந்தக் கேள்விக்கு காப்பகத்தில் எந்த ஆதாரமும் நம்பகத்தன்மை வரம்பைத் தாண்டவில்லை. ஊகிப்பதற்குப் பதிலாக இதைச் சொல்வதே சரி — கேள்வியை மாற்றிக் கேளுங்கள்.",
};

const EMPTY_QUERY = {
  en: "Ask about a speech, a debate, a manuscript, or an idea in the archive.",
  hi: "संग्रह में किसी भाषण, बहस, पांडुलिपि या विचार के बारे में पूछें।",
  mr: "संग्रहातील भाषण, चर्चा, हस्तलिखित किंवा विचाराबद्दल विचारा.",
  kn: "ದಾಖಲೆಯಲ್ಲಿನ ಭಾಷಣ, ಚರ್ಚೆ ಅಥವಾ ಹಸ್ತಪ್ರತಿಯ ಬಗ್ಗೆ ಕೇಳಿ.",
  ta: "காப்பகத்தில் உள்ள உரை, விவாதம் அல்லது கையெழுத்துப் பிரதி பற்றி கேளுங்கள்.",
};

/* Confidence floor. Below this the engine refuses rather than reaching for
   the least-bad passage — the behaviour the archive's whole premise rests on. */
const SCORE_FLOOR = 1.6;
const COVERAGE_FLOOR = 0.3;

/**
 * Answer a question from the corpus.
 * Always resolves; `fallback: true` means nothing cleared the threshold.
 */
export function answerQuestion(question, lang = "en") {
  const raw = contentTerms(question);

  if (raw.length === 0) {
    return { text: EMPTY_QUERY[lang] || EMPTY_QUERY.en, citations: [], evidence: [], fallback: true, score: 0 };
  }

  const terms = expand(raw);
  const known = raw.filter((t) => (DF.get(t) || 0) > 0 || (SYNONYMS[t] || []).some((s) => (DF.get(s) || 0) > 0));
  const coverage = known.length / raw.length;

  const ranked = DOCS.map((d) => ({ doc: d, score: bm25(d, terms) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];

  if (!top || top.score < SCORE_FLOOR || coverage < COVERAGE_FLOOR) {
    return {
      text: NO_SOURCE[lang] || NO_SOURCE.en,
      citations: [],
      evidence: [],
      fallback: true,
      score: top ? Number(top.score.toFixed(2)) : 0,
    };
  }

  // Keep passages within reach of the leader — a single dominant hit answers
  // alone, a close second earns a place beside it.
  const kept = ranked.filter((r) => r.score >= top.score * 0.55).slice(0, 3);

  const lead = LEAD_IN[lang] || LEAD_IN.en;
  // A second passage only joins the spoken answer if it is genuinely close to
  // the leader; weaker-but-relevant hits stay in the evidence list below,
  // where their relevance score is visible.
  const quoted = kept.filter((r, i) => i === 0 || r.score >= top.score * 0.7).slice(0, 2);
  const parts = quoted.map((r) => bestSentences(r.doc.passage.quote, terms, 2));

  const text = `${lead} ${parts.join(" ")}`;

  return {
    text,
    note: lang !== "en" ? SOURCE_NOTE[lang] : null,
    citations: kept.map((r) => r.doc.passage.citation),
    evidence: kept.map((r) => ({
      ...r.doc.passage,
      relevance: Number((r.score / top.score).toFixed(2)),
    })),
    fallback: false,
    score: Number(top.score.toFixed(2)),
  };
}

/** Free-text search across articles, for the home-page search box. */
export function searchArticles(query) {
  const raw = contentTerms(query);
  if (raw.length === 0) return [];
  const terms = expand(raw);

  return ARTICLES.map((a) => {
    const hay = tokenize(`${a.title} ${a.summary} ${a.body.join(" ")} ${a.theme} ${a.type}`);
    let score = 0;
    for (const [t, w] of terms) {
      if (hay.includes(t)) score += (idf(t) || 0.5) * w;
    }
    return { article: a, score };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.article);
}

export function getArticle(id) {
  return ARTICLES.find((a) => a.id === id) || null;
}

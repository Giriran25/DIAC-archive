import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CORPUS } from "./corpus.js";

/* The shape every answer must come back in. Enforced by the API rather than
   by parsing prose, so a stray sentence can never break the UI. */
const AnswerSchema = z.object({
  text: z.string().describe("The 2-4 sentence answer, grounded in the corpus."),
  citations: z.array(z.string()).describe("Exact source names the answer draws on."),
  fallback: z.boolean().describe("True when the corpus does not cover the question."),
});

const LANG_INSTRUCTION = {
  en: "Respond in clear, formal English.",
  hi: "Respond in Hindi (Devanagari script). Keep the citation source names in their original English form.",
  mr: "Respond in Marathi (Devanagari script). Keep the citation source names in their original English form.",
  kn: "Respond in Kannada (Kannada script). Keep the citation source names in their original English form.",
  ta: "Respond in Tamil (Tamil script). Keep the citation source names in their original English form.",
};

/* The corpus never changes, so it goes in its own cached block ahead of the
   per-request language instruction — that keeps the cache prefix identical
   across languages instead of invalidating it on every switch. */
const GROUNDING = `You are the AI Research Assistant for the Dr. Ambedkar International Centre (DAIC) Digital Heritage Archive. You answer questions strictly grounded in the corpus provided below — the writings and speeches of Dr. B. R. Ambedkar and the Constituent Assembly Debates.

RULES:
- Answer ONLY from the corpus. Never invent facts, dates, or quotations.
- Every answer must include the exact source citation (volume, page, speech, or debate volume).
- If the corpus does not contain enough information to answer, honestly say so and set "fallback" to true.
- Keep answers to 2-4 sentences, factual and neutral in tone.

CORPUS:
${CORPUS}`;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error("Request body too large."));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Request body was not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

/* Returns a connect-style middleware. The key is captured here, on the
   server, so it never reaches the client bundle. */
export function createAskHandler(apiKey) {
  const client = apiKey ? new Anthropic({ apiKey }) : null;

  return async function askHandler(req, res) {
    if (req.method !== "POST") {
      return send(res, 405, { error: "Use POST to ask the archive." });
    }

    if (!client) {
      return send(res, 503, {
        error:
          "No Anthropic API key configured. Add ANTHROPIC_API_KEY=sk-ant-... to the .env file in the project root, then restart the dev server.",
      });
    }

    try {
      const { question, lang } = await readJsonBody(req);
      if (typeof question !== "string" || !question.trim()) {
        return send(res, 400, { error: "Ask a question first." });
      }

      const response = await client.messages.parse({
        model: "claude-opus-5",
        max_tokens: 8000,
        system: [
          { type: "text", text: GROUNDING, cache_control: { type: "ephemeral" } },
          { type: "text", text: LANG_INSTRUCTION[lang] || LANG_INSTRUCTION.en },
        ],
        messages: [{ role: "user", content: question }],
        output_config: {
          format: zodOutputFormat(AnswerSchema),
          effort: "low", // small corpus, short answers — keeps the demo snappy
        },
      });

      if (response.stop_reason === "refusal") {
        return send(res, 200, {
          text: "I can't answer that one. Try asking about the writings, speeches, or Constituent Assembly debates in the archive.",
          citations: [],
          fallback: true,
        });
      }

      const answer = response.parsed_output;
      if (!answer) {
        return send(res, 502, { error: "The archive assistant returned an unreadable answer." });
      }
      return send(res, 200, answer);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        return send(res, 502, { error: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env." });
      }
      if (err instanceof Anthropic.RateLimitError) {
        return send(res, 502, { error: "Rate limited by the Anthropic API. Wait a moment and ask again." });
      }
      if (err instanceof Anthropic.APIConnectionError) {
        return send(res, 502, { error: "Could not reach the Anthropic API. Check this machine's internet connection." });
      }
      if (err instanceof Anthropic.APIError) {
        return send(res, 502, { error: `Anthropic API error ${err.status}: ${err.message}` });
      }
      console.error("[/api/ask]", err);
      return send(res, 500, { error: err.message || "Unexpected server error." });
    }
  };
}

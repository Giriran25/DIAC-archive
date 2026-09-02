import React, { StrictMode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "../App.jsx";
import { spoken, resetSpoken } from "./setup.js";
import { answerQuestion, searchArticles, splitSentences } from "../lib/retrieval.js";
import { ARTICLES, PASSAGES } from "../data/corpus.js";

/* Rendered in StrictMode deliberately — that is how main.jsx mounts it, and
   it is what surfaced the duplicated seeded question.

   `startAtLanding={false}` mounts past the entrance: these suites test the
   application, and the landing page has its own.
   `initialAuth={true}` by default allows suite tests to access all views. */
function mount(props = {}) {
  return render(
    <StrictMode>
      <App startAtLanding={false} initialAuth={true} {...props} />
    </StrictMode>
  );
}

beforeEach(() => resetSpoken());

describe("home page — Ask the archive button", () => {
  it("asks the typed question and lands on an answer with citations", async () => {
    const user = userEvent.setup();
    mount();

    // Deliberately not one of the preset questions, so the echoed user turn
    // is unambiguous in the DOM.
    await user.type(
      screen.getByPlaceholderText(/Ask about a speech/i),
      "hours of work and paid leave"
    );
    await user.click(screen.getByTestId("ask-archive"));

    // We are now on the Ask tab, with the question echoed back as a user turn.
    expect(await screen.findByText("hours of work and paid leave")).toBeInTheDocument();

    // ...and a grounded answer arrives.
    const answer = await screen.findByText(/From the archive:/i, {}, { timeout: 3000 });
    expect(answer).toBeInTheDocument();
    expect(screen.getAllByText(/Writings and Speeches, Vol\. X/i).length).toBeGreaterThan(0);
  });

  it("asks the question exactly once (no StrictMode double-fire)", async () => {
    const user = userEvent.setup();
    mount();

    await user.type(screen.getByPlaceholderText(/Ask about a speech/i), "labour rights");
    await user.click(screen.getByTestId("ask-archive"));

    await screen.findByText(/From the archive:/i, {}, { timeout: 3000 });
    expect(screen.getAllByText("labour rights")).toHaveLength(1);
  });

  it("still opens the Ask tab when the box is empty", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByTestId("ask-archive"));
    expect(await screen.findByPlaceholderText(/Type your question/i)).toBeInTheDocument();
  });

  it("offers matching articles as a shortcut while typing", async () => {
    const user = userEvent.setup();
    mount();

    await user.type(screen.getByPlaceholderText(/Ask about a speech/i), "untouchability");
    expect(await screen.findByRole("button", { name: /Article 17/i })).toBeInTheDocument();
  });
});

describe("ask — grounding behaviour", () => {
  it("refuses when nothing clears the confidence floor", async () => {
    const user = userEvent.setup();
    mount();

    await user.type(screen.getByPlaceholderText(/Ask about a speech/i), "best pizza in Naples");
    await user.click(screen.getByTestId("ask-archive"));

    expect(await screen.findByText(/No grounded source/i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(/From the archive:/i)).not.toBeInTheDocument();
  });

  it("shows evidence with relevance under an answer", async () => {
    const user = userEvent.setup();
    mount();

    await user.type(screen.getByPlaceholderText(/Ask about a speech/i), "Article 17 drafting record");
    await user.click(screen.getByTestId("ask-archive"));

    const details = await screen.findByText(/Evidence \(\d\)/i, {}, { timeout: 3000 });
    await user.click(details);
    expect(await screen.findAllByText(/Relevance \d+%/i)).not.toHaveLength(0);
    expect(screen.getAllByText(/Provenance:/i).length).toBeGreaterThan(0);
  });
});

describe("archive → article → evidence", () => {
  it("opens a document and shows the passages on the page being read", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getAllByRole("button", { name: /^Archive$/ })[0]);
    await user.click(await screen.findByRole("button", { name: /Annihilation of Caste/i }));

    expect(await screen.findByRole("heading", { name: "Annihilation of Caste" })).toBeInTheDocument();

    // A passage belongs to a page, so the evidence shown is the evidence on
    // the page open in the reader — not every passage in the document.
    expect(await screen.findByRole("heading", { name: /Evidence/i })).toBeInTheDocument();

    const article = ARTICLES.find((a) => a.id === "annihilation-of-caste");
    const shown = screen.getAllByText(/Writings & Speeches|Vol\./i);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThanOrEqual(article.evidence.length);

    // A confidence is rendered only where one was actually reported.
    for (const badge of screen.queryAllByText(/% OCR$/)) {
      expect(badge.textContent).not.toBe("0% OCR");
      expect(badge.textContent).not.toMatch(/NaN/);
    }
  });

  it("moves between documents through the archive list", async () => {
    const user = userEvent.setup();
    mount();

    // The archive records no "related documents" relation and exposes no
    // endpoint for one, so the route between documents is the catalogue
    // itself rather than an invented set of suggestions.
    await user.click(screen.getAllByRole("button", { name: /^Archive$/ })[0]);
    await user.click(await screen.findByRole("button", { name: /Annihilation of Caste/i }));
    expect(await screen.findByRole("heading", { name: /Annihilation of Caste/i })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /Back to/i }));
    await user.click(await screen.findByRole("button", { name: /Mahad Satyagraha/i }));

    expect(await screen.findByRole("heading", { name: "Mahad Satyagraha" })).toBeInTheDocument();
  });

  it("filters the archive by type without crashing", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getAllByRole("button", { name: /^Archive$/ })[0]);
    await user.click(await screen.findByRole("button", { name: "Manuscript" }));
    expect(await screen.findByRole("button", { name: /Mahad Satyagraha/i })).toBeInTheDocument();
  });
});

describe("read-aloud", () => {
  it("speaks an article, then replays it after it has finished", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getAllByRole("button", { name: /^Archive$/ })[0]);
    await user.click(await screen.findByRole("button", { name: /Annihilation of Caste/i }));

    const listen = screen.getAllByRole("button", { name: /Listen/i })[0];
    await user.click(listen);

    await waitFor(() => expect(spoken.length).toBeGreaterThan(1));
    const firstRun = spoken.length;

    // Wait for the queue to drain, then press Listen again — this used to be
    // a no-op because the id was never cleared.
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /Listen/i }).length).toBeGreaterThan(0)
    );
    await user.click(screen.getAllByRole("button", { name: /Listen/i })[0]);
    await waitFor(() => expect(spoken.length).toBeGreaterThan(firstRun));
  });

  it("stops narration when navigating away", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getAllByRole("button", { name: /^Archive$/ })[0]);
    await user.click(await screen.findByRole("button", { name: /Annihilation of Caste/i }));
    await user.click(screen.getAllByRole("button", { name: /Listen/i })[0]);
    await waitFor(() => expect(spoken.length).toBeGreaterThan(0));

    await user.click(screen.getAllByRole("button", { name: /^Timeline$/ })[0]);
    expect(screen.queryByText(/Reading aloud/i)).not.toBeInTheDocument();
  });
});

describe("languages", () => {
  it("switches UI and refusal text to Hindi", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getAllByRole("button", { name: "हिं" })[0]);
    expect(await screen.findByPlaceholderText(/पूछें/)).toBeInTheDocument();
  });

  it("answers in every language without throwing", () => {
    for (const lang of ["en", "hi", "mr", "kn", "ta"]) {
      const r = answerQuestion("What did Ambedkar say about labour rights?", lang);
      expect(r.fallback).toBe(false);
      expect(r.citations.length).toBeGreaterThan(0);
      expect(typeof r.text).toBe("string");
    }
  });
});

describe("timeline and archivist", () => {
  it("moves through the timeline and opens the linked article", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getAllByRole("button", { name: /^Timeline$/ })[0]);
    await user.click(await screen.findByRole("button", { name: /1948/ }));

    // An event opens through one of its archival sources, not a generic CTA:
    // the route into a document is always a passage that cites it.
    const sources = await screen.findAllByRole("button", { name: /Article 17/i });
    await user.click(sources[0]);

    expect(await screen.findByRole("heading", { name: /Article 17/i })).toBeInTheDocument();
  });

  it("opens the archivist back end and expands an OCR row", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /Visitor mode/i }));
    await user.click(await screen.findByRole("button", { name: /OCR queue/i }));

    // Rows are manuscript pages awaiting human review, not scores: a page
    // with no reported confidence still belongs in the queue.
    const rows = await screen.findAllByRole("button", { name: /page \d+/i });
    expect(rows.length).toBeGreaterThan(0);
    await user.click(rows[0]);
    expect(await screen.findByText(/Candidate text/i)).toBeInTheDocument();
  });

  it("protects archivist portal when unauthenticated and requires login", async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App startAtLanding={false} initialAuth={false} />
      </StrictMode>
    );

    await user.click(screen.getByRole("button", { name: /Visitor mode/i }));
    expect(await screen.findByText(/Institutional Archive Access/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Username/i), "archivist_test");
    await user.type(screen.getByLabelText(/Password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /Sign in/i }));

    expect(await screen.findByText(/The other half of the platform/i)).toBeInTheDocument();
  });
});

describe("retrieval engine", () => {
  it("splits sentences without lookbehind", () => {
    const out = splitSentences('One two. Three four! "Five six." Seven.');
    expect(out.length).toBe(4);
    expect(out[0]).toBe("One two.");
  });

  it("never cites a passage that is not in the corpus", () => {
    const known = new Set(PASSAGES.map((p) => p.citation));
    const questions = [
      "labour rights", "Article 17", "social democracy", "Mahad",
      "Buddhism conversion", "state ownership of industries", "caste",
    ];
    for (const q of questions) {
      for (const c of answerQuestion(q, "en").citations) {
        expect(known.has(c)).toBe(true);
      }
    }
  });

  it("returns quotes verbatim from the corpus (nothing invented)", () => {
    const corpusText = PASSAGES.map((p) => p.quote).join(" ");
    const r = answerQuestion("What did Ambedkar say about labour rights?", "en");
    const body = r.text.replace(/^From the archive:\s*/, "");
    for (const sentence of splitSentences(body)) {
      expect(corpusText).toContain(sentence.trim());
    }
  });

  it("refuses off-corpus questions", () => {
    for (const q of ["best pizza in Naples", "crypto price prediction", "weather tomorrow", "   "]) {
      expect(answerQuestion(q, "en").fallback).toBe(true);
    }
  });

  it("search returns only real articles", () => {
    const ids = new Set(ARTICLES.map((a) => a.id));
    for (const a of searchArticles("untouchability caste")) expect(ids.has(a.id)).toBe(true);
  });
});

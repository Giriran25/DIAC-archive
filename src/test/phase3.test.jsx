import React, { StrictMode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "../App.jsx";
import { resetSpoken } from "./setup.js";

function mount(props = {}) {
  return render(
    <StrictMode>
      <App startAtLanding={false} initialAuth={true} {...props} />
    </StrictMode>
  );
}

beforeEach(() => resetSpoken());

describe("Phase 3 — Advanced Archivist Portal", () => {
  it("renders overview metrics and navigates across institutional tabs", async () => {
    const user = userEvent.setup();
    mount();

    // Toggle from Visitor mode to Archivist mode
    await user.click(screen.getByRole("button", { name: /Visitor mode/i }));
    expect(await screen.findByRole("heading", { name: /The other half of the platform/i })).toBeInTheDocument();
    expect(screen.getByText(/Indexed Passages/i)).toBeInTheDocument();
    expect(screen.getByText(/Pending Ingestion Review/i)).toBeInTheDocument();
  });

  it("handles pending review, approval, and rejection workflow", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /Visitor mode/i }));
    await user.click(await screen.findByRole("button", { name: /^Pending Review$/i }));

    // Verify list of pending submissions
    expect(await screen.findByText(/Indian Statutory Commission/i)).toBeInTheDocument();

    // Open review modal
    const reviewBtns = await screen.findAllByRole("button", { name: /^Review$/i });
    await user.click(reviewBtns[0]);
    expect(await screen.findByText(/Submission Details/i)).toBeInTheDocument();
    expect(screen.getByText(/Extracted Raw Text Excerpt/i)).toBeInTheDocument();

    // Approve item
    await user.click(screen.getByRole("button", { name: /Approve & Promote to Archive/i }));
    expect(await screen.findByText(/has been approved and committed to the canonical archive/i)).toBeInTheDocument();
  });

  it("corrects a manuscript page through the real review endpoints", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /Visitor mode/i }));
    await user.click(await screen.findByRole("button", { name: /^OCR Queue$/i }));

    // The queue is derived from manuscript pages still awaiting review.
    const rows = await screen.findAllByRole("button", { name: /page \d+/i });
    expect(rows.length).toBeGreaterThan(0);
    await user.click(rows[0]);

    expect(await screen.findByText(/Candidate text/i)).toBeInTheDocument();

    await user.click((await screen.findAllByRole("button", { name: /^Correct$/i }))[0]);
    expect(await screen.findByText(/Corrected transcription/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Save correction/i }));
    // Correcting does NOT approve: the page stays in the queue until a
    // human approves it, which is the rule the whole loop exists for.
    expect(await screen.findByText(/still awaiting approval/i)).toBeInTheDocument();
  });

  it("never renders a confidence score the backend did not report", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /Visitor mode/i }));
    await user.click(await screen.findByRole("button", { name: /^OCR Queue$/i }));
    await screen.findAllByRole("button", { name: /page \d+/i });

    // A page whose engine reported no score must read "Not scored" — never
    // 0%, which would invent a terrible result where none exists.
    const badges = screen.queryAllByText(/^\d+%$/);
    for (const b of badges) expect(b.textContent).not.toBe("0%");
  });

  it("executes multi-stage ingestion upload workflow", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /Visitor mode/i }));
    await user.click(await screen.findByRole("button", { name: /^Upload$/i }));

    expect(await screen.findByText(/Archival Ingestion & Validation Lifecycle/i)).toBeInTheDocument();
    expect(screen.getByText(/Ingest New Archival Document Package/i)).toBeInTheDocument();

    // Fill title
    const titleInput = screen.getByPlaceholderText(/e\.g\. Memorandum on Rights of Labouring Classes/i);
    await user.type(titleInput, "Test Memorandum on Labor Welfare");

    // Submit upload
    await user.click(screen.getByRole("button", { name: /Ingest & Stage for Review/i }));
    expect(await screen.findByText(/Document Successfully Staged for Ingestion Review/i, {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("verifies SHA-256 preservation checksum in the preservation vault", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /Visitor mode/i }));
    await user.click(await screen.findByRole("button", { name: /^Preservation$/i }));

    // The panel lists real archive documents, not a separate vault fixture.
    const titles = await screen.findAllByText(/Mahad Satyagraha/i);
    expect(titles.length).toBeGreaterThan(0);
    const checksumMatches = await screen.findAllByText(/SHA-256 Master Checksum/i);
    expect(checksumMatches.length).toBeGreaterThan(0);

    // Before a check runs, the panel claims nothing about the file on disk.
    expect(screen.getAllByText(/Not checked this session/i).length).toBeGreaterThan(0);

    const verifyBtns = await screen.findAllByRole("button", { name: /Verify Checksum/i });
    await user.click(verifyBtns[0]);

    // The verdict shown is the backend's, not an assumption that it passed.
    expect(await screen.findByText(/checksum matches the ingestion record/i)).toBeInTheDocument();
  });

  it("searches and filters immutable institutional audit trail", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole("button", { name: /Visitor mode/i }));
    await user.click(await screen.findByRole("button", { name: /^Audit$/i }));

    const auditHeaders = await screen.findAllByText(/Target Item/i);
    expect(auditHeaders.length).toBeGreaterThan(0);

    // The trail stores an actor, an action, a document id and a free-text
    // detail — there is no "result" column, because a failure that never
    // wrote a row cannot be reported as one that did.
    const searchInput = screen.getByPlaceholderText(/Search audit events, actors, actions…/i);
    await user.type(searchInput, "system_cron");
    const actorCells = await screen.findAllByText(/system_cron/i);
    expect(actorCells.length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Rejected$/)).not.toBeInTheDocument();
  });
});

describe("Phase 3 — Summarization & Translation UI", () => {
  it("generates archival summary for an opened primary source article", async () => {
    const user = userEvent.setup();
    mount();

    // Go to archive and open Annihilation of Caste
    await user.click(screen.getAllByRole("button", { name: /^Archive$/ })[0]);
    await user.click(await screen.findByRole("button", { name: /Annihilation of Caste/i }));

    // Click Summarize
    const summarizeBtn = await screen.findByRole("button", { name: /Summarize/i });
    await user.click(summarizeBtn);

    expect(await screen.findByRole("heading", { name: /Archival Summary/i })).toBeInTheDocument();
    expect(screen.getByText(/Key Archival Findings/i)).toBeInTheDocument();
  });

  it("translates or displays graceful unavailable state for primary titles", async () => {
    const user = userEvent.setup();
    mount();

    // Go to archive and open Annihilation of Caste
    await user.click(screen.getAllByRole("button", { name: /^Archive$/ })[0]);
    await user.click(await screen.findByRole("button", { name: /Annihilation of Caste/i }));

    // Click Translate
    const translateBtn = await screen.findByRole("button", { name: /Translate/i });
    await user.click(translateBtn);

    expect(await screen.findByText(/Select target language for institutional primary translation/i)).toBeInTheDocument();

    // Choose Hindi
    await user.click(screen.getByRole("button", { name: /Hindi \(हिंदी\)/i }));
    expect(await screen.findByText(/जाति का विनाश/i)).toBeInTheDocument();
  });
});

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

describe("Phase 2 — Interactive Timeline", () => {
  it("displays timeline events with locations and allows switching", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getAllByRole("button", { name: /^Timeline$/ })[0]);
    expect(await screen.findByText(/A life read across formats/i)).toBeInTheDocument();

    // Click 1927 Mahad Satyagraha event
    // The chronology is fetched, so the track appears after the heading.
    await user.click(await screen.findByRole("button", { name: /1927/ }));
    expect(await screen.findByText(/Mahad, Maharashtra/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Mahad Satyagraha/i })).toBeInTheDocument();
  });
});

describe("Phase 2 — Memorial Storytelling", () => {
  it("tells an episode only through passages the archive holds", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getAllByRole("button", { name: /^Stories$/i })[0]);
    expect(await screen.findByRole("heading", { name: /Oral Histories & Landmark Narratives/i })).toBeInTheDocument();

    // Every quotation on this screen is a stored passage attributed to the
    // document it came from — never an authored pull-quote.
    const tabs = await screen.findAllByRole("tab", { name: /Passage \d+/i });
    expect(tabs.length).toBeGreaterThan(0);

    await user.click(tabs[tabs.length - 1]);
    expect(await screen.findByRole("button", { name: /Open this document/i })).toBeInTheDocument();
  });
});

describe("Phase 2 — Manuscript & OCR Viewer", () => {
  it("renders manuscript leaves and toggles between scan and OCR transcription", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getAllByRole("button", { name: /^Manuscripts$/i })[0]);
    expect(await screen.findByRole("heading", { name: /Original Scans & Verified Transcriptions/i })).toBeInTheDocument();

    // Default manuscript is Mahad Tank Declaration Draft
    const msMatches = await screen.findAllByText(/Mahad Tank Declaration Draft/i);
    expect(msMatches.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/OCR Transcription/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Original Scan/i).length).toBeGreaterThan(0);

    // Test page navigation
    const nextBtn = await screen.findByRole("button", { name: /Next page/i });
    await user.click(nextBtn);
    expect(await screen.findByText(/Page 2 of 3/i)).toBeInTheDocument();
  });
});

describe("Phase 2 — Audio & Video Media Archive", () => {
  it("renders audio player with synchronized timecoded transcript and allows timestamp seeking", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getAllByRole("button", { name: /^Media$/i })[0]);
    expect(await screen.findByRole("heading", { name: /Recorded Voices & Archival Reels/i })).toBeInTheDocument();

    // Audio player should be visible for Columbia interview
    const columbiaMatches = await screen.findAllByText(/Columbia University Interview on Indian Democracy/i);
    expect(columbiaMatches.length).toBeGreaterThan(0);
    expect(screen.getByText(/Interactive Timecoded Transcript/i)).toBeInTheDocument();

    // Click timestamp seeking
    const timestampBtn = (await screen.findAllByText("00:00:45"))[0];
    await user.click(timestampBtn);
    expect(await screen.findByText(/Without social democracy at the base/i)).toBeInTheDocument();
  });

  it("handles unservable preservation video with archival master notice", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getAllByRole("button", { name: /^Media$/i })[0]);
    // Switch to video tab
    await user.click(await screen.findByRole("button", { name: /Video Archive/i }));
    // Select preservation reel
    await user.click(await screen.findByRole("button", { name: /Mahad Tank Satyagraha Archival Newsreel/i }));

    // The reason must be the archive's own, not an invented restoration story.
    expect(await screen.findByText(/Not available for playback/i)).toBeInTheDocument();
    expect(screen.getByText(/No playable master is held/i)).toBeInTheDocument();
  });
});

describe("Phase 2 — Knowledge Graph Mapping", () => {
  it("explores conceptual relationships across nodes", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getAllByRole("button", { name: /^Knowledge$/i })[0]);
    expect(await screen.findByRole("heading", { name: /Conceptual Knowledge Map/i })).toBeInTheDocument();

    // Select Social Justice node
    await user.click(screen.getAllByRole("button", { name: /Social Justice/i })[0]);
    expect(await screen.findByText(/The systemic eradication of caste hierarchy/i)).toBeInTheDocument();
    expect(screen.getByText(/Connected Relationships/i)).toBeInTheDocument();
  });
});

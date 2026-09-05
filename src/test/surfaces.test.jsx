import React, { StrictMode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "../App.jsx";
import { resetSpoken } from "./setup.js";

/* ---------------------------------------------------------------------- *
 * Every surface, mounted for real.
 *
 * The other suites test behaviour one screen at a time. This one walks the
 * whole product the way a visitor does and fails on anything React logs as
 * an error — a crashed render, a bad hook call, a key warning that means a
 * list is rebuilding wrongly. Without it a view can break in a way no
 * assertion happens to look at, and the first person to find out is
 * whoever is running the demonstration.
 * ---------------------------------------------------------------------- */

function mount(props = {}) {
  return render(
    <StrictMode>
      <App startAtLanding={false} initialAuth={true} {...props} />
    </StrictMode>
  );
}

let consoleError;

beforeEach(() => {
  resetSpoken();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError?.mockRestore();
});

/** React logs render failures through console.error; nothing may reach it. */
function expectNoReactErrors() {
  const noise = consoleError.mock.calls
    .map((args) => String(args[0] ?? ""))
    /* jsdom cannot lay out or play media, so its own limitation is not a
       defect in the archive. Everything else counts. */
    .filter((m) => !/not implemented: HTMLMediaElement|jsdom/i.test(m));
  expect(noise).toEqual([]);
}

const TABS = [
  ["Home", /Every word, dated|Explore the archive/i],
  ["Ask", /AI Research Assistant/i],
  ["Timeline", /A life read across formats/i],
  ["Archive", /By theme, not by shelf/i],
  ["Manuscripts", /Original Scans/i],
  ["Media", /Recorded Voices/i],
  ["Stories", /Oral Histories/i],
  ["Knowledge", /Knowledge|Relationships|entities/i],
];

describe("every visitor surface mounts", () => {
  for (const [tab, marker] of TABS) {
    it(`renders ${tab} without a React error`, async () => {
      const user = userEvent.setup();
      mount();

      const nav = screen.getAllByRole("button", { name: new RegExp(`^${tab}$`, "i") });
      await user.click(nav[0]);

      expect(await screen.findAllByText(marker)).not.toHaveLength(0);
      expectNoReactErrors();
    });
  }
});

describe("the journey map", () => {
  it("explains the research path and navigates from it", async () => {
    const user = userEvent.setup();
    mount();

    // Home is the default surface.
    expect(await screen.findByRole("heading", { name: /How this archive is used/i }))
      .toBeInTheDocument();

    // The steps a reader follows, in order, ending at a real document.
    expect(screen.getByText(/the passages the answer rests on/i)).toBeInTheDocument();
    expect(screen.getByText(/volume and printed page/i)).toBeInTheDocument();

    // A step that is a destination actually goes there.
    await user.click(screen.getByRole("button", { name: /Ask the archive — open/i }));
    expect(await screen.findByText(/AI Research Assistant/i)).toBeInTheDocument();
    expectNoReactErrors();
  });

  it("keeps the archivist workflow separate and does not fake its steps", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole("tab", { name: /How material gets in/i }));

    expect(await screen.findByText(/an archivist checks it/i)).toBeInTheDocument();
    expect(screen.getByText(/only once approved/i)).toBeInTheDocument();

    /* These are stages in a staff workflow, not places a visitor can open.
       They must not be rendered as buttons that go nowhere. */
    expect(screen.queryByRole("button", { name: /Ingest & OCR/i })).not.toBeInTheDocument();
    expectNoReactErrors();
  });

  it("does not put retrieval internals in front of a visitor", async () => {
    mount();
    const journey = screen.getByRole("region", { name: /How this archive is used/i });
    for (const jargon of [/FAISS/i, /rank fusion/i, /rerank/i, /evidence gate/i, /BM25/i]) {
      expect(within(journey).queryByText(jargon)).not.toBeInTheDocument();
    }
  });
});

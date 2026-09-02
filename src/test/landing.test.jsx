import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "../App.jsx";
import { media } from "./setup.js";

/* App starts at the landing page by default, so these render <App /> with
   no props — exactly what main.jsx mounts. */
beforeEach(() => { media.rejectPlay = false; });
afterEach(() => { media.rejectPlay = false; });

/* GlobalStyles renders before the landing's own <style>, so a single
   querySelector picks the wrong block. Join them all. */
function cssOf(container) {
  return [...container.querySelectorAll("style")].map((s) => s.textContent).join(" ");
}

describe("landing page", () => {
  it("is the first thing a visitor sees", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /preserve the past/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId("get-started")).toBeInTheDocument();
    // The application's own home page must not be underneath it.
    expect(screen.queryByTestId("ask-archive")).not.toBeInTheDocument();
  });

  it("plays the intro film muted and inline so autoplay is allowed", () => {
    const { container } = render(<App />);
    const video = container.querySelector("video");
    expect(video).toBeTruthy();
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute("playsInline");
    expect(video).toHaveAttribute("loop");
  });

  it("uses the provided film, full-screen and undistorted", () => {
    const { container } = render(<App />);
    const sources = [...container.querySelectorAll("video source")].map((s) => s.getAttribute("src"));
    expect(sources).toEqual(["/ambedkar.mp4"]);

    // object-fit: cover is what keeps a 16:9 film undistorted in any
    // viewport; without it the video stretches.
    const styles = cssOf(container);
    expect(styles).toMatch(/object-fit:\s*cover/);
    expect(styles).toMatch(/object-position:\s*center/);
    expect(container.querySelector("video")).toHaveClass("daic-film");
  });

  it("renders all three text elements as HTML, not baked into the film", () => {
    render(<App />);
    // Tagline.
    expect(screen.getByRole("heading", { name: "Preserve the Past. Inspire the Future.", level: 1 }))
      .toBeInTheDocument();
    // Left and right blocks, headings and quotes alike.
    expect(screen.getByRole("heading", { name: "Education", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Freedom", level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/Cultivation of mind should be the ultimate aim/i)).toBeInTheDocument();
    expect(screen.getByText(/Freedom of mind is the real freedom/i)).toBeInTheDocument();
    expect(screen.getByTestId("get-started")).toHaveTextContent(/get started/i);
  });

  it("puts Education on the left lane and Freedom on the right", () => {
    const { container } = render(<App />);
    expect(container.querySelector(".daic-side-left")).toHaveTextContent(/Education/);
    expect(container.querySelector(".daic-side-right")).toHaveTextContent(/Freedom/);

    const styles = cssOf(container);
    // Three columns with an EMPTY centre: the middle area is never assigned
    // to any block, which is what keeps Ambedkar and the Chakra clear.
    expect(styles).toMatch(/grid-template-columns:\s*minmax\(0,29fr\) minmax\(0,42fr\) minmax\(0,29fr\)/);
    expect(styles).toMatch(/"left mid  right"/);
    expect(styles).not.toMatch(/grid-area:\s*mid/);
  });

  it("slides the side blocks in from their own edges only", () => {
    const { container } = render(<App />);
    const styles = cssOf(container);
    // Percentages are of each block's OWN width, and each block already
    // sits in the outer 29%, so neither can sweep across the centre.
    expect(styles).toMatch(/daicFromLeft[\s\S]*?translateX\(-115%\)/);
    expect(styles).toMatch(/daicFromRight[\s\S]*?translateX\(115%\)/);
    expect(styles).toMatch(/\.daic-side-left\s*\{[\s\S]*?daicFromLeft/);
    expect(styles).toMatch(/\.daic-side-right\s*\{[\s\S]*?daicFromRight/);
  });

  it("shows the side blocks in place when motion is reduced", () => {
    const { container } = render(<App />);
    const styles = cssOf(container);
    const block = styles.slice(styles.indexOf("prefers-reduced-motion"));
    expect(block).toMatch(/animation:\s*none/);
    expect(block).toMatch(/transform:\s*none/);
  });

  it("does not attribute the side lines to Ambedkar", () => {
    const { container } = render(<App />);
    // None of the three lines is in the corpus, so none may carry an
    // attribution or a citation on this page.
    const text = container.textContent;
    expect(text).not.toMatch(/Ambedkar["']|—\s*Dr\./);
    expect(text).not.toMatch(/Writings and Speeches/);
    expect(text.toLowerCase()).not.toContain("tigress");
  });

  it("veils the film with parchment rather than black", () => {
    const { container } = render(<App />);
    const styles = cssOf(container);
    // The film is a light painting; a dark scrim would change how it reads.
    expect(styles).toContain("rgba(244,234,208");
    expect(styles).not.toMatch(/rgba\(0,\s*0,\s*0/);
  });

  it("stays usable when the browser refuses autoplay", async () => {
    media.rejectPlay = true;
    render(<App />);
    // A play control appears instead of a silently blank hero.
    const play = await screen.findByRole("button", { name: /play the introduction film/i });
    expect(play).toBeInTheDocument();
    // And the page still works: the entrance is unaffected.
    expect(screen.getByTestId("get-started")).toBeInTheDocument();
  });

  it("shows no play overlay when autoplay is allowed", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /play the introduction film/i }))
        .not.toBeInTheDocument()
    );
  });

  it("keeps the one button at the bottom of the composition", () => {
    const { container } = render(<App />);
    // Exactly one entrance, and it sits in the bottom-right grid area.
    expect(screen.getAllByTestId("get-started")).toHaveLength(1);
    expect(container.querySelector(".daic-cta-wrap")).toContainElement(
      screen.getByTestId("get-started")
    );
    expect(cssOf(container)).toMatch(/\.daic-cta-wrap\s*\{[^}]*justify-self:\s*end/);
  });

  it("enters the existing archive home when Get started is pressed", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId("get-started"));

    // The application's real home page - not a duplicate of it.
    await waitFor(() => expect(screen.getByTestId("ask-archive")).toBeInTheDocument());
    expect(screen.queryByTestId("get-started")).not.toBeInTheDocument();
    // The archive's own navigation is present, so this is the real app.
    expect(screen.getAllByText(/Timeline/i).length).toBeGreaterThan(0);
  });

  it("is reachable by keyboard", async () => {
    const user = userEvent.setup();
    render(<App />);
    const cta = screen.getByTestId("get-started");
    cta.focus();
    expect(cta).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("ask-archive")).toBeInTheDocument());
  });

  it("does not show again while navigating inside the archive", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId("get-started"));
    await waitFor(() => expect(screen.getByTestId("ask-archive")).toBeInTheDocument());

    // Move around the app; the entrance must not come back.
    await user.click(screen.getAllByText(/Archive/i)[0]);
    expect(screen.queryByTestId("get-started")).not.toBeInTheDocument();
  });

  it("returns to the landing page on a fresh load", async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(screen.getByTestId("get-started"));
    await waitFor(() => expect(screen.getByTestId("ask-archive")).toBeInTheDocument());

    // A browser reload is a fresh mount with no persisted state, so the
    // entrance must come back. Nothing may be written to storage.
    expect(window.sessionStorage.getItem("daic:entered")).toBeNull();
    expect(window.localStorage.getItem("daic:entered")).toBeNull();

    first.unmount();
    render(<App />);
    expect(screen.getByTestId("get-started")).toBeInTheDocument();
    expect(screen.queryByTestId("ask-archive")).not.toBeInTheDocument();
  });

  it("shows the brand block in the top-left corner", () => {
    const { container } = render(<App />);
    const brand = container.querySelector(".daic-brand");
    expect(brand).toBeTruthy();
    expect(brand).toHaveTextContent("DAIC ARCHIVE");
    expect(brand).toHaveTextContent("Ambedkar International Centre");
    // The existing Chakra component, not a second logo.
    expect(brand.querySelector("svg")).toBeTruthy();

    const styles = cssOf(container);
    expect(styles).toMatch(/\.daic-brand\s*\{[^}]*position:\s*absolute/);
    expect(styles).toMatch(/\.daic-brand\s*\{[^}]*z-index:\s*3/);
    // Decorative: it must not sit in the tab order.
    expect(styles).toMatch(/\.daic-brand\s*\{[^}]*pointer-events:\s*none/);
  });

  it("keeps the approved composition untouched by the brand", () => {
    const { container } = render(<App />);
    // The brand lives outside the grid, so the three text areas are
    // exactly where they were.
    expect(container.querySelector(".daic-overlay .daic-brand")).toBeNull();
    const styles = cssOf(container);
    expect(styles).toMatch(/"left mid  right"/);
    expect(styles).toMatch(/grid-template-columns:\s*minmax\(0,29fr\)/);
  });
});

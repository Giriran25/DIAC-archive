import { useEffect, useRef, useState } from "react";
import { ChevronRight, Play } from "lucide-react";

import ChakraMark from "../components/ChakraMark.jsx";
import {
  BORDER_SOFT, FONT_DISPLAY, FONT_UI,
  GOLD, INDIGO, INKTEXT, MUTED, PARCH,
} from "../lib/tokens.js";

/* ---------------------------------------------------------------------- *
 * Landing — the entrance to the archive.
 *
 * A full-bleed film with three blocks of real HTML text arranged around
 * it. Every word is live DOM: selectable, translatable and responsive.
 *
 * The layout is dictated by the film, measured off the 1920x1080 frame
 * rather than guessed:
 *
 *   Chakra ring      x 655-1230,  top edge y 145
 *   Ambedkar's head  y 195-265
 *   plinth top       y 790
 *   visitors' faces  y 735-780
 *
 * So the protected centre is 31%-69% across the full height, the side
 * lanes are the outer 29%, the tagline must finish above 13% or it clips
 * the top of the Chakra, and the button sits below 80% where only legs
 * and foliage are behind it.
 * ---------------------------------------------------------------------- */

const FILM = "/ambedkar.mp4";

/* Editorial copy for the entrance.
 *
 * NONE of these three lines is attributed, and none carries a citation.
 * Every distinctive phrase was searched for in the archive first —
 * "cultivation of mind", "ultimate aim of human existence", "freedom of
 * mind", "real freedom", "mind is not free" — and each returns zero
 * chunks. They circulate widely online, but this project holds no source
 * for them, so presenting them as Ambedkar's words would be exactly the
 * unverified attribution the archive exists to avoid.
 *
 * The tagline is interface copy and is likewise not a quotation.
 */
const TAGLINE = "Preserve the Past. Inspire the Future.";

const EDUCATION = {
  key: "education",
  heading: "Education",
  text: "Cultivation of mind should be the ultimate aim of human existence.",
};

const FREEDOM = {
  key: "freedom",
  heading: "Freedom",
  text: "Freedom of mind is the real freedom. A person whose mind is not free is a slave.",
};

export default function LandingView({ onEnter }) {
  const videoRef = useRef(null);
  const [needsTap, setNeedsTap] = useState(false);

  // Muted autoplay is still refused by some browsers. Catch the rejection
  // so the hero never sits frozen with no way to start it.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const attempt = el.play();
    if (attempt && typeof attempt.catch === "function") {
      attempt.catch(() => setNeedsTap(true));
    }
  }, []);

  const startFilm = () => {
    const el = videoRef.current;
    if (!el) return;
    el.play().then(() => setNeedsTap(false)).catch(() => {});
  };

  return (
    <main
      className="daic-landing"
      aria-labelledby="daic-landing-title"
      style={{ backgroundColor: PARCH }}
    >
      <style>{`
        .daic-landing {
          position: relative;
          width: 100%;
          min-height: 100vh;
          overflow: hidden;          /* clips the side blocks before entry */
        }
        @supports (min-height: 100dvh) { .daic-landing { min-height: 100dvh; } }

        .daic-film {
          position: absolute; inset: 0;
          width: 100%; height: 100%;
          object-fit: cover;         /* fills the viewport, never distorts */
          object-position: center;
          display: block;
        }

        /* Parchment, never black: the film is a light painting and a dark
           veil would change how it reads. Stops sit off the measured frame
           so the Chakra, the figure and the visitors' faces are untouched. */
        .daic-scrim-top, .daic-scrim-bottom {
          position: absolute; left: 0; right: 0; pointer-events: none;
        }
        .daic-scrim-top {
          top: 0; height: 18%;
          background: linear-gradient(to bottom,
            rgba(244,234,208,0.88) 0%,
            rgba(244,234,208,0.40) 55%,
            rgba(244,234,208,0) 100%);
        }
        .daic-scrim-bottom {
          bottom: 0; height: 40%;
          background: linear-gradient(to top,
            rgba(244,234,208,0.95) 0%,
            rgba(244,234,208,0.80) 20%,
            rgba(244,234,208,0.22) 48%,
            rgba(244,234,208,0) 68%);
        }
        /* Faint washes under the side lanes only. They stop well short of
           the centre, so the artwork behind Ambedkar is never veiled. */
        .daic-lane-wash {
          position: absolute; top: 14%; bottom: 22%; width: 30%;
          pointer-events: none;
        }
        .daic-lane-wash.left {
          left: 0;
          background: linear-gradient(to right,
            rgba(244,234,208,0.55) 0%, rgba(244,234,208,0.28) 55%, rgba(244,234,208,0) 100%);
        }
        .daic-lane-wash.right {
          right: 0;
          background: linear-gradient(to left,
            rgba(244,234,208,0.55) 0%, rgba(244,234,208,0.28) 55%, rgba(244,234,208,0) 100%);
        }

        /* Brand block, top-left. Absolutely positioned so it sits outside
           the grid and cannot move the approved composition. It occupies
           only the open corner: the tagline is centred, the side lanes
           begin lower down, and the artwork starts well right of it. */
        .daic-brand {
          position: absolute;
          z-index: 3;                     /* above the scrims, below nothing */
          top: clamp(0.85rem, 2.4vh, 1.9rem);
          left: clamp(1rem, 3vw, 3.25rem);
          display: flex;
          align-items: center;
          gap: clamp(0.5rem, 0.9vw, 0.8rem);
          pointer-events: none;           /* decorative: never traps focus */
        }
        .daic-brand svg { width: clamp(22px, 2.3vw, 34px); height: auto; flex: none; }
        .daic-brand-text { display: flex; flex-direction: column; line-height: 1.15; }
        .daic-brand-name {
          font-family: ${FONT_UI};
          color: ${INKTEXT};
          font-weight: 600;
          letter-spacing: 0.12em;
          font-size: clamp(11px, 1.15vw, 15px);
        }
        .daic-brand-sub {
          font-family: ${FONT_UI};
          color: ${MUTED};
          letter-spacing: 0.04em;
          font-size: clamp(8.5px, 0.85vw, 11px);
          margin-top: 2px;
        }
        /* Below the tablet breakpoint the tagline widens toward the edges,
           so the brand steps down a size to stay out of its way. */
        @media (max-width: 780px) {
          .daic-brand { gap: 0.45rem; }
          .daic-brand-sub { display: none; }
        }

        /* Three columns: left lane, protected centre, right lane. The
           centre column holds nothing at any breakpoint — that is what
           keeps Ambedkar and the Chakra clear. */
        .daic-overlay {
          position: relative; z-index: 2;
          min-height: 100vh;
          display: grid;
          grid-template-columns: minmax(0,29fr) minmax(0,42fr) minmax(0,29fr);
          grid-template-rows: auto 1fr auto;
          grid-template-areas:
            "tag  tag  tag"
            "left mid  right"
            "bl   bm   cta";
          column-gap: clamp(0.5rem, 2vw, 2rem);
          padding: clamp(0.9rem, 2.4vh, 2rem) clamp(1rem, 3vw, 3.25rem)
                   clamp(1.1rem, 3vh, 2.5rem);
        }
        @supports (min-height: 100dvh) { .daic-overlay { min-height: 100dvh; } }

        .daic-tagline-wrap { grid-area: tag; text-align: center; }
        .daic-side-left  { grid-area: left;  align-self: center; }
        .daic-side-right { grid-area: right; align-self: center; }
        .daic-cta-wrap   { grid-area: cta;   justify-self: end; align-self: end; }

        /* ---- entrances -------------------------------------------------
           Each side block travels only inside its own lane: the transform
           is a percentage of the BLOCK's own width, and the block already
           sits in the outer 29%, so it can never sweep across the centre.
           It enters once and settles — no bounce, no idle motion. */
        @keyframes daicFromLeft {
          0%   { opacity: 0; transform: translateX(-115%); }
          72%  { opacity: 1; transform: translateX(2%); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes daicFromRight {
          0%   { opacity: 0; transform: translateX(115%); }
          72%  { opacity: 1; transform: translateX(-2%); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes daicRise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: none; }
        }

        .daic-tagline-wrap, .daic-cta-wrap {
          opacity: 0; animation: daicRise 700ms cubic-bezier(.22,.61,.36,1) forwards;
        }
        .daic-tagline-wrap { animation-delay: 300ms; }
        .daic-cta-wrap     { animation-delay: 1250ms; }

        .daic-side-left {
          opacity: 0;
          animation: daicFromLeft 1000ms cubic-bezier(.16,.84,.3,1) 650ms forwards;
        }
        .daic-side-right {
          opacity: 0;
          animation: daicFromRight 1000ms cubic-bezier(.16,.84,.3,1) 650ms forwards;
        }

        .daic-cta { transition: transform 180ms ease, box-shadow 180ms ease; }
        .daic-cta:hover { transform: translateY(-1px); box-shadow: 0 10px 22px -12px rgba(20,28,48,0.65); }
        .daic-cta:active { transform: translateY(0); }
        .daic-cta:focus-visible, .daic-play:focus-visible {
          outline: 2px solid ${GOLD}; outline-offset: 4px;
        }

        /* ---- tablet: pull the lanes inward a little ---- */
        @media (max-width: 1100px) {
          .daic-overlay { grid-template-columns: minmax(0,31fr) minmax(0,38fr) minmax(0,31fr); }
        }

        /* ---- narrow: the crop leaves no side lanes ---------------------
           object-fit: cover on a portrait viewport shows only the middle
           slice of the film, so the outer lanes are off-screen entirely.
           The blocks move below the figure, keeping their order, and the
           button centres under them. */
        @media (max-width: 780px) {
          .daic-overlay {
            grid-template-columns: 1fr 1fr;
            grid-template-rows: auto 1fr auto auto;
            grid-template-areas:
              "tag   tag"
              "mid   mid"
              "left  right"
              "cta   cta";
            row-gap: clamp(0.6rem, 1.6vh, 1rem);
          }
          .daic-side-left, .daic-side-right { align-self: end; }
          .daic-cta-wrap { justify-self: center; }
          .daic-lane-wash { display: none; }
          .daic-scrim-bottom { height: 50%; }
          /* clears the brand block, which sits above the grid */
          .daic-overlay { padding-top: clamp(3rem, 7vh, 4rem); }
        }

        @media (max-width: 460px) {
          .daic-overlay {
            grid-template-columns: 1fr;
            grid-template-areas: "tag" "mid" "left" "right" "cta";
          }
        }

        /* ---- short landscape: the crop eats the sky, so tighten ---- */
        @media (max-height: 620px) {
          .daic-side-quote { display: none; }
          .daic-overlay { padding-top: clamp(0.4rem, 1.2vh, 0.9rem); }
        }

        @media (prefers-reduced-motion: reduce) {
          .daic-tagline-wrap, .daic-cta-wrap,
          .daic-side-left, .daic-side-right {
            animation: none; opacity: 1; transform: none;
          }
          .daic-cta:hover { transform: none; }
        }
      `}</style>

      {/* ---- the film ---- */}
      <video
        ref={videoRef}
        className="daic-film"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        disablePictureInPicture
        aria-label="Introductory film: a statue of Dr. B. R. Ambedkar before the Ashoka Chakra, with visitors gathered around it"
      >
        <source src={FILM} type="video/mp4" />
      </video>

      <div className="daic-scrim-top" aria-hidden="true" />
      <div className="daic-scrim-bottom" aria-hidden="true" />
      <div className="daic-lane-wash left" aria-hidden="true" />
      <div className="daic-lane-wash right" aria-hidden="true" />

      {/* Brand, in the open top-left corner. Positioned outside the grid so
          it cannot shift the approved composition — the tagline, the two
          side blocks and the button all stay exactly where they were. */}
      <div className="daic-brand">
        <ChakraMark size={34} />
        <div className="daic-brand-text">
          <span className="daic-brand-name">DAIC ARCHIVE</span>
          <span className="daic-brand-sub">Ambedkar International Centre</span>
        </div>
      </div>

      {needsTap && (
        <button
          type="button"
          onClick={startFilm}
          className="daic-play absolute inset-0 flex items-center justify-center"
          style={{ zIndex: 3, backgroundColor: "rgba(244,234,208,0.25)" }}
          aria-label="Play the introduction film"
        >
          <span
            className="flex items-center justify-center rounded-full"
            style={{
              width: 72, height: 72, backgroundColor: PARCH,
              border: `1px solid ${GOLD}`, color: INDIGO,
              boxShadow: "0 8px 24px -12px rgba(20,28,48,0.6)",
            }}
          >
            <Play size={26} />
          </span>
        </button>
      )}

      {/* ---- overlay: every word is HTML, nothing baked into the film ---- */}
      <div className="daic-overlay">

        {/* top — finishes above the Chakra */}
        <div className="daic-tagline-wrap">
          <h1
            id="daic-landing-title"
            style={{
              fontFamily: FONT_DISPLAY,
              color: INKTEXT,
              fontSize: "clamp(1.15rem, 3.1vw, 2.6rem)",
              lineHeight: 1.15,
              margin: 0,
            }}
          >
            {TAGLINE}
          </h1>
          <div
            aria-hidden="true"
            className="mx-auto"
            style={{
              width: "clamp(38px, 5vw, 64px)", height: 1,
              backgroundColor: BORDER_SOFT,
              marginTop: "clamp(0.5rem, 1.2vh, 0.9rem)",
            }}
          />
        </div>

        {/* the centre column stays empty at every breakpoint */}

        <SideBlock block={EDUCATION} className="daic-side-left" align="left" />
        <SideBlock block={FREEDOM} className="daic-side-right" align="right" />

        {/* bottom right — the way in */}
        <div className="daic-cta-wrap">
          <button
            type="button"
            onClick={onEnter}
            data-testid="get-started"
            className="daic-cta inline-flex items-center gap-2 rounded-full text-white"
            style={{
              backgroundColor: INDIGO,
              fontFamily: FONT_UI,
              fontSize: "clamp(13px, 1.5vw, 15px)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "15px 30px",
              minHeight: 52,
              boxShadow: "0 6px 18px -10px rgba(20,28,48,0.55)",
            }}
          >
            Get started <ChevronRight size={17} />
          </button>
        </div>
      </div>
    </main>
  );
}

/* One side block: a gold small-caps heading over the archive's display
   serif, matching the eyebrow treatment used across the application. */
function SideBlock({ block, className, align }) {
  const edge = align === "right" ? "auto" : "0";
  return (
    <section
      className={className}
      aria-labelledby={`daic-${block.key}`}
      style={{ textAlign: align }}
    >
      <h2
        id={`daic-${block.key}`}
        style={{
          fontFamily: FONT_UI,
          color: GOLD,
          textTransform: "uppercase",
          letterSpacing: "0.24em",
          fontSize: "clamp(10px, 1.15vw, 13px)",
          fontWeight: 600,
          margin: 0,
        }}
      >
        {block.heading}
      </h2>
      <div
        aria-hidden="true"
        style={{
          width: "clamp(24px, 2.6vw, 40px)", height: 1,
          backgroundColor: BORDER_SOFT,
          margin: "clamp(0.45rem, 1vh, 0.7rem) 0",
          marginLeft: edge,
        }}
      />
      <p
        className="daic-side-quote"
        style={{
          fontFamily: FONT_DISPLAY,
          color: INKTEXT,
          fontSize: "clamp(0.9rem, 1.55vw, 1.3rem)",
          lineHeight: 1.5,
          margin: 0,
          maxWidth: "22ch",
          marginLeft: edge,
        }}
      >
        {block.text}
      </p>
    </section>
  );
}

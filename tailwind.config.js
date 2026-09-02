/** @type {import('tailwindcss').Config} */

/* ---------------------------------------------------------------------- *
 * The palette lives in src/lib/tokens.js, which JSX imports directly for
 * inline styles. Mirroring it here means a Tailwind class and a token
 * cannot drift apart: `bg-parch` and `PARCH` are the same value, and a new
 * shade has exactly one place to be added.
 *
 * The literals are duplicated rather than imported because Tailwind reads
 * this file through its own loader, and a runtime import of a module that
 * the browser bundle also owns is the kind of coupling that breaks on a
 * config change nobody expects.
 * ---------------------------------------------------------------------- */

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#141c30",
        indigo: "#1c2c4d",
        parch: "#f4ead0",
        gold: { DEFAULT: "#b3862c", light: "#d9ac4f" },
        vermil: "#9c3d2e",
        inktext: "#241f16",
        cream: "#f4ead0",
        card: "#faf4e4",
        chip: "#efe0bb",
        muted: "#8a7f63",
        bodytext: "#4a4330",
        edge: { DEFAULT: "#d8c79a", soft: "#c9b98c" },
      },
      fontFamily: {
        display: ["Tiro Devanagari Hindi", "Noto Serif Devanagari", "Georgia", "Times New Roman", "serif"],
        body: ["Source Serif 4", "Georgia", "Cambria", "Times New Roman", "serif"],
        ui: ["Work Sans", "Segoe UI", "system-ui", "-apple-system", "Helvetica Neue", "Arial", "sans-serif"],
      },
      screens: {
        /* The kiosk tablet sits at 1280x800 landscape; this breakpoint
           exists so kiosk-only layout rules have a name. */
        kiosk: { raw: "(min-width: 1024px) and (max-height: 900px)" },
      },
    },
  },
  plugins: [],
}

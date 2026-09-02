import { GOLD } from "../lib/tokens.js";

/* The 24-spoke Ashoka Chakra used as the archive's mark. Moved out of
   App.jsx unchanged so the landing page shows the same mark rather than a
   second drawing of it. */
export default function ChakraMark({ size = 22, spinning = false, color = GOLD }) {
  const spokes = Array.from({ length: 24 });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={spinning ? "animate-[spin_2.4s_linear_infinite]" : ""}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="24" cy="24" r="21" fill="none" stroke={color} strokeWidth="1.4" />
      {spokes.map((_, i) => {
        const angle = (i * 360) / 24;
        return (
          <line
            key={i}
            x1="24"
            y1="24"
            x2={24 + 20 * Math.cos((angle * Math.PI) / 180)}
            y2={24 + 20 * Math.sin((angle * Math.PI) / 180)}
            stroke={color}
            strokeWidth="1"
            opacity="0.85"
          />
        );
      })}
      <circle cx="24" cy="24" r="3.4" fill={color} />
    </svg>
  );
}

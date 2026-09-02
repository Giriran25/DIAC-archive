import { FONT_UI } from "../../lib/tokens.js";

/* Multi-step loading animation for the AI research assistant.
   Each step appears with a short staggered delay. No fake percentages. */

export default function LoadingSteps({ t }) {
  const steps = [
    { key: 1, text: t.loadStep1, delay: 0 },
    { key: 2, text: t.loadStep2, delay: 600 },
    { key: 3, text: t.loadStep3, delay: 1200 },
    { key: 4, text: t.loadStep4, delay: 1800 },
    { key: 5, text: t.loadStep5, delay: 2400 },
  ];

  return (
    <div
      className="rounded-2xl rounded-bl-sm px-4 py-3 text-sm border"
      style={{ backgroundColor: "#faf4e4", borderColor: "#d8c79a" }}
    >
      <div className="space-y-1.5">
        {steps.map((step) => (
          <div
            key={step.key}
            className="daic-load-step flex items-center gap-2 text-[12px]"
            style={{
              fontFamily: FONT_UI,
              color: "#6b6350",
              animationDelay: `${step.delay}ms`,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: "#b3862c", opacity: 0.6 }}
            />
            {step.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts}",
  ],
  safelist: [
    "bg-status-red",
    "bg-status-yellow",
    "bg-status-green",
    "text-status-red",
    "text-status-yellow",
    "text-status-green",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        cream: "#221A36",
        blush: "#F9C5D5",
        mint: "#B8E8D0",
        lavender: "#D4C5F9",
        peach: "#FFDAB9",
        status: {
          red: "#EF4444",
          yellow: "#EAB308",
          green: "#22C55E",
        },
        ink: "#F3E9F2",
        berry: "#E0518A",
        // Semantic error color, kept separate from the berry brand accent so
        // invalid states never look like prices/highlights.
        error: "#F87171",
        night: "#0B1020",
        plum: "#1A1230",
      },
      fontFamily: {
        sans: ["var(--font-nunito)", "system-ui", "sans-serif"],
        display: ["var(--font-pixelify)", "var(--font-nunito)", "sans-serif"],
        secondary: ["var(--font-gugi)", "var(--font-nunito)", "sans-serif"],
      },
      boxShadow: {
        cozy: "0 4px 0 0 rgba(0, 0, 0, 0.35)",
        "cozy-sm": "0 2px 0 0 rgba(0, 0, 0, 0.3)",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        popIn: {
          "0%": { opacity: "0", transform: "scale(0.8)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        pixelBob: {
          "0%, 16%, 100%": { transform: "translateY(0)" },
          "8%": { transform: "translateY(-10px)" },
        },
        softBounce: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-3px)" },
        },
        pixelWobble: {
          "0%, 100%": { transform: "rotate(-2deg)" },
          "50%": { transform: "rotate(2deg)" },
        },
      },
      animation: {
        "fade-in": "fadeIn 0.5s ease-out both",
        "fade-up": "fadeUp 0.6s ease-out both",
        "pop-in": "popIn 0.5s ease-out both",
        "pixel-bob": "pixelBob 2s ease-in-out infinite",
        "soft-bounce": "softBounce 0.9s ease-in-out infinite",
        "pixel-wobble": "pixelWobble 1s steps(6, end) infinite",
      },
    },
  },
  plugins: [],
};

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
    "bg-status-blue",
    "bg-status-yellow",
    "bg-status-green",
    "text-status-red",
    "text-status-blue",
    "text-status-yellow",
    "text-status-green",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        cream: "#221A36",
        mint: "#B8E8D0",
        lavender: "#D4C5F9",
        peach: "#FFDAB9",
        sky: "#B8D9F5",
        status: {
          red: "#EF4444",
          blue: "#3B82F6",
          yellow: "#EAB308",
          green: "#22C55E",
        },
        ink: "#F3E9F2",
        error: "#F87171",
        night: "#0B1020",
        plum: "#1A1230",
      },
      fontFamily: {
        sans: [
          "var(--font-instrument-sans)",
          "var(--font-nunito)",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
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
        softBounce: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-3px)" },
        },
      },
      animation: {
        "fade-in": "fadeIn 0.5s ease-out both",
        "fade-up": "fadeUp 0.6s ease-out both",
        "pop-in": "popIn 0.5s ease-out both",
        "soft-bounce": "softBounce 0.9s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

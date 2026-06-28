/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        cream: "#FFF8F0",
        blush: "#F9C5D5",
        mint: "#B8E8D0",
        lavender: "#D4C5F9",
        peach: "#FFDAB9",
        ink: "#4A3F55",
        berry: "#E0518A",
      },
      fontFamily: {
        sans: ["var(--font-nunito)", "system-ui", "sans-serif"],
        display: ["var(--font-pixelify)", "var(--font-nunito)", "sans-serif"],
        secondary: ["var(--font-gugi)", "var(--font-nunito)", "sans-serif"],
      },
      boxShadow: {
        cozy: "0 4px 0 0 rgba(74, 63, 85, 0.15)",
        "cozy-sm": "0 2px 0 0 rgba(74, 63, 85, 0.12)",
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
      },
      animation: {
        "fade-in": "fadeIn 0.5s ease-out both",
        "fade-up": "fadeUp 0.6s ease-out both",
        "pop-in": "popIn 0.5s ease-out both",
      },
    },
  },
  plugins: [],
};

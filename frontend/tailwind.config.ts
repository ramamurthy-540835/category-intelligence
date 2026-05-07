import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bby: {
          blue:    "#003087",
          yellow:  "#ffe000",
          dark:    "#0d1117",
          surface: "#161b22",
          card:    "#1c2230",
          border:  "#2d3748",
          muted:   "#64748b",
          accent:  "#3b82f6",
          ticker:  "#1a1a2e",
          activeBg:"#1e3a5f",
          activeText: "#60a5fa",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "ui-sans-serif", "system-ui"],
      },
      keyframes: {
        marquee: {
          "0%":   { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        pulse_dot: {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.3" },
        },
      },
      animation: {
        marquee:   "marquee 40s linear infinite",
        pulse_dot: "pulse_dot 1.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;

import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./frontend/renderer/index.html",
    "./frontend/renderer/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "var(--color-brand)",
          hover: "var(--color-brand-hover)",
          active: "var(--color-brand-active)",
          subtle: "var(--color-brand-subtle)",
          pill: "var(--color-brand-pill-border)",
        },
        bg: {
          base: "var(--color-bg-base)",
          subtle: "var(--color-bg-subtle)",
          raised: "var(--color-bg-raised)",
          overlay: "var(--color-bg-overlay)",
        },
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
          disabled: "var(--color-text-disabled)",
          inverse: "var(--color-text-inverse)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          strong: "var(--color-border-strong)",
          brand: "var(--color-border-brand)",
        },
        success: {
          DEFAULT: "var(--color-success)",
          subtle: "var(--color-success-subtle)",
          pill: "var(--color-success-pill-border)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
          subtle: "var(--color-warning-subtle)",
          pill: "var(--color-warning-pill-border)",
        },
        error: {
          DEFAULT: "var(--color-error)",
          subtle: "var(--color-error-subtle)",
          pill: "var(--color-error-pill-border)",
        },
        info: {
          DEFAULT: "var(--color-info)",
          subtle: "var(--color-info-subtle)",
        },
        chart: {
          emerald: "var(--color-chart-emerald)",
          purple: "var(--color-chart-purple)",
          amber: "var(--color-chart-amber)",
          blue: "var(--color-chart-blue)",
          indigo: "var(--color-chart-indigo)",
        },
        journey: {
          supplier: "var(--color-journey-supplier)",
          "supplier-soft": "var(--color-journey-supplier-soft)",
          cargo: "var(--color-journey-cargo)",
          "cargo-soft": "var(--color-journey-cargo-soft)",
          stop: "var(--color-journey-stop)",
          "stop-soft": "var(--color-journey-stop-soft)",
          final: "var(--color-journey-final)",
          "final-soft": "var(--color-journey-final-soft)",
        },
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "row-leave": {
          from: { opacity: "1", transform: "translateX(0)" },
          to: { opacity: "0", transform: "translateX(24px)", display: "none" },
        },
        "row-flash": {
          from: { backgroundColor: "var(--color-brand-subtle)" },
          to: { backgroundColor: "transparent" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "slide-up": "slide-up 250ms ease-out",
        "row-flash": "row-flash 1800ms ease-out",
        "row-leave": "row-leave 260ms ease-in forwards",
        "slide-in-right": "slide-in-right 220ms cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;

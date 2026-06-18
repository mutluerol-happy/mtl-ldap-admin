// MTL Console — Tailwind tasarım sistemi
// Tema: dark default · monospace başlıklar · IBM Plex Sans body · amber accent
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: "1rem", sm: "1.5rem", lg: "2rem" },
      screens: { "2xl": "1440px" },
    },
    extend: {
      // ====================================================================
      // Tipografi
      // ====================================================================
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', "monospace"],
        display: ['"JetBrains Mono"', '"IBM Plex Mono"', "monospace"],
      },

      // ====================================================================
      // Renk paleti — CSS değişkenleri üzerinden çağrılır
      // ====================================================================
      colors: {
        border: "hsl(var(--mtl-border) / <alpha-value>)",
        ring: "hsl(var(--mtl-ring) / <alpha-value>)",
        bg: {
          DEFAULT: "hsl(var(--mtl-bg) / <alpha-value>)",
          surface: "hsl(var(--mtl-bg-surface) / <alpha-value>)",
          elevated: "hsl(var(--mtl-bg-elevated) / <alpha-value>)",
          inset: "hsl(var(--mtl-bg-inset) / <alpha-value>)",
        },
        fg: {
          DEFAULT: "hsl(var(--mtl-fg) / <alpha-value>)",
          muted: "hsl(var(--mtl-fg-muted) / <alpha-value>)",
          subtle: "hsl(var(--mtl-fg-subtle) / <alpha-value>)",
          inverse: "hsl(var(--mtl-fg-inverse) / <alpha-value>)",
        },
        amber: {
          DEFAULT: "hsl(var(--mtl-amber) / <alpha-value>)",
          glow: "hsl(var(--mtl-amber-glow) / <alpha-value>)",
        },
        accent: "hsl(var(--mtl-accent) / <alpha-value>)",
        success: "hsl(var(--mtl-success) / <alpha-value>)",
        danger: "hsl(var(--mtl-danger) / <alpha-value>)",
        warning: "hsl(var(--mtl-warning) / <alpha-value>)",
        // shadcn-uyumlu takma adlar -> MTL tokenlarina eslenir (tanimsiz "yok-sinif" siniflari stil alsin)
        card: "hsl(var(--mtl-bg-surface) / <alpha-value>)",
        muted: "hsl(var(--mtl-bg-inset) / <alpha-value>)",
        destructive: "hsl(var(--mtl-danger) / <alpha-value>)",
        primary: "hsl(var(--mtl-amber) / <alpha-value>)",
      },

      // ====================================================================
      // Boşluk & boyut
      // ====================================================================
      borderRadius: {
        sm: "2px",
        DEFAULT: "4px",
        md: "6px",
        lg: "8px",
        xl: "12px",
      },

      // ====================================================================
      // Gölge — incelikli
      // ====================================================================
      boxShadow: {
        "glow-amber": "0 0 0 1px hsl(var(--mtl-amber) / 0.4), 0 0 16px hsl(var(--mtl-amber) / 0.2)",
        "glow-danger": "0 0 0 1px hsl(var(--mtl-danger) / 0.5), 0 0 16px hsl(var(--mtl-danger) / 0.25)",
        "ring-fine": "inset 0 0 0 1px hsl(var(--mtl-border) / 0.8)",
        elevated:
          "0 4px 6px -1px hsl(0 0% 0% / 0.4), 0 2px 4px -2px hsl(0 0% 0% / 0.3)",
      },

      // ====================================================================
      // Animasyon
      // ====================================================================
      keyframes: {
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "blink-caret": {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "slide-up": "slide-up 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        "blink-caret": "blink-caret 1.1s step-end infinite",
        scan: "scan 4s linear infinite",
      },

      letterSpacing: {
        tightest: "-0.04em",
        "wider-2": "0.08em",
      },
    },
  },
  plugins: [],
};

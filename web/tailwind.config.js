/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Engineering console palette
        ink: {
          950: '#0a0a0a', // app bg
          900: '#111111', // panel bg
          800: '#1a1a1a', // raised
          700: '#262626', // borders
          500: '#737373', // muted text
          300: '#a3a3a3',
          100: '#e8e6e3', // primary text (warm white)
        },
        amber: {
          DEFAULT: '#f59e0b',
          dim: '#b97309',
        },
        ok: '#10b981',
        warn: '#f59e0b',
        err: '#ef4444',
      },
      letterSpacing: {
        wider: '0.08em',
        widest: '0.12em',
      },
    },
  },
  plugins: [],
}

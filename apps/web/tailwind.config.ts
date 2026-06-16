import type { Config } from 'tailwindcss';

// Liquid-crystal light theme, ported from the Lumpy-web landing site
// (Lumpy-web/src/styles.css). Bright, glassy, Apple-app feel.
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        // Remap the neutral scale to INVERTED light values so the app's existing
        // neutral-* classes (built for a dark theme) render as the light
        // liquid-crystal palette without touching every page: dark text tokens
        // (neutral-50..200) become ink, panel/page backgrounds (neutral-900/950)
        // become near-white, borders (neutral-700/800) become hairlines.
        neutral: {
          50: '#0b1422',
          100: '#142033',
          200: '#26344c',
          300: '#3f4f68',
          400: '#5a6880',
          500: '#6b788f',
          600: '#97a4b6',
          700: '#cfd9e5',
          800: '#dde5ef',
          900: '#eef3fa',
          950: '#f7fbff',
        },
        ink: '#142033',
        muted: '#657188',
        line: 'rgba(44, 64, 91, 0.14)',
        // Liquid-crystal accents.
        mint: '#51efc3',
        ice: '#68c8ff',
        violet: '#a888ff',
        coral: '#ff876f',
        // Status.
        ok: '#0f7d63',
        warn: '#b4791f',
        danger: '#d6492f',
      },
      backgroundColor: {
        glass: 'rgba(255, 255, 255, 0.66)',
        'glass-strong': 'rgba(255, 255, 255, 0.82)',
      },
      borderColor: {
        glass: 'rgba(255, 255, 255, 0.74)',
      },
      boxShadow: {
        glass: '0 18px 50px rgba(72, 96, 131, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.88)',
        'glass-lg': '0 28px 80px rgba(59, 87, 128, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
        pill: '0 12px 28px rgba(20, 32, 51, 0.18)',
      },
      backdropBlur: {
        glass: '16px',
      },
      keyframes: {
        // A card sliding into its lane (used on enter and on lane change).
        'lane-in': {
          '0%': { opacity: '0', transform: 'translateX(-10px) scale(0.985)' },
          '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
        },
        // A finished card draining off the Done lane before it retires.
        drain: {
          '0%': { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(18px)' },
        },
      },
      animation: {
        'lane-in': 'lane-in 340ms cubic-bezier(0.22, 1, 0.36, 1) both',
        drain: 'drain 700ms ease-in both',
      },
    },
  },
  plugins: [],
} satisfies Config;

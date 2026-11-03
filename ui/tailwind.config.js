/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ps: {
          bg: "#07090e",
          card: "rgba(18, 23, 34, 0.75)",
          cardHover: "rgba(28, 35, 51, 0.9)",
          blue: "#0070d1",
          neon: "#00a2ff",
          surface: "#111622",
          surfaceLight: "#1c2333",
          border: "rgba(255, 255, 255, 0.08)",
          borderHover: "rgba(0, 162, 255, 0.4)",
          gold: "#f59e0b",
          cross: "#2d7ef7",
          circle: "#ef4444",
          triangle: "#10b981",
          square: "#ec4899",
        }
      },
      fontFamily: {
        playstation: ['"Inter Variable"', '"Inter"', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      boxShadow: {
        'ps-glow': '0 0 25px -5px rgba(0, 162, 255, 0.4)',
        'ps-glow-lg': '0 0 45px -5px rgba(0, 162, 255, 0.6)',
        'ps-card': '0 10px 30px -10px rgba(0, 0, 0, 0.7)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'scale(0.98)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        }
      }
    },
  },
  plugins: [],
}

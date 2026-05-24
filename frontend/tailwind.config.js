/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Gray — inverted warm-beige scale (950 = lightest/body, 100 = darkest/text).
        // Darker than before so the UI reads as warm parchment, not white.
        gray: {
          50:  '#150E08',
          100: '#22190F',  // body text (very dark warm brown)
          200: '#342C24',
          300: '#4A4038',
          400: '#635850',  // muted text
          500: '#7E746C',
          600: '#9A9088',
          700: '#B5AB9D',  // borders
          800: '#C9C0B0',  // input backgrounds
          900: '#D6CDBD',  // card backgrounds
          950: '#E4DBD0',  // body background (dark beige)
        },
        // Primary — warm terracotta/copper (replaces indigo).
        primary: {
          50:  '#FFF5EE',
          100: '#FFE8D6',
          200: '#FFCBA6',
          300: '#F09A5A',
          400: '#D97A38',
          500: '#C0601C',
          600: '#A84A0A',  // button background
          700: '#8C3A06',
          800: '#6E2C04',
          900: '#4E1C02',
          950: '#320E00',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}

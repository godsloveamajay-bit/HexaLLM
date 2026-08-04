/** @type {import('tailwindcss').Config} */
const ramp = (name) => Object.fromEntries(
  ['50','100','200','300','400','500','600','700','800','850','900','925','950']
    .map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`])
)
export default {
  // Theme is class-driven: <html class="light"> flips the CSS variables below.
  // gray/primary/secondary/energy resolve to those variables, so existing
  // semantic classes theme automatically and new accents stay palette-bound.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        gray: ramp('g'),
        primary: ramp('p'),
        secondary: ramp('s'),
        energy: ramp('e'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['Roboto Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}

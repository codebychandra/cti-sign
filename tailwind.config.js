/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // CTI brand — red + black primary, blue reserved for UI accents only
        cti: {
          red: '#E11B22',
          redDark: '#B3151B',
          black: '#111111',
          ink: '#1a1a1a',
          gray: '#6b7280',
          line: '#e5e7eb',
          bg: '#f7f7f8',
          blue: '#2563eb',
        },
      },
      fontFamily: {
        heading: ['Inter', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

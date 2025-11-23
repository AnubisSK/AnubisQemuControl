/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,html}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#1e1e1e',
          surface: '#252526',
          surface2: '#2d2d30',
          border: '#3e3e42',
          text: '#cccccc',
          text2: '#858585',
          accent: '#007acc',
          accentHover: '#0098ff',
          success: '#4ec9b0',
          warning: '#dcdcaa',
          error: '#f48771',
        }
      }
    },
  },
  plugins: [],
}


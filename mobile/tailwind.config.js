/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#FF6B6B',
        accent: '#4ECDC4',
        'dark-bg': '#0F0F0F',
        'light-bg': '#F8F8F8',
        'dark-card': '#1A1A1A',
        'light-card': '#FFFFFF',
        'light-text': '#FFFFFF',
        'dark-text': '#FFFFFF',
        'light-subtext': '#CCCCCC',
        'dark-subtext': '#CCCCCC',
        activeGreen: '#4ADE80',
        error: '#FF6B6B',
        warning: '#FFD93D',
        success: '#4ECDC4',
      },
      borderRadius: {
        '2xl': '16px',
      },
    },
  },
  plugins: [],
};

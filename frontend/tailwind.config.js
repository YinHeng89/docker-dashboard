/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 通过 CSS 变量实现主题切换（暗色 / 浅色）
        panel:          'rgb(var(--c-panel) / <alpha-value>)',
        surface:        'rgb(var(--c-surface) / <alpha-value>)',
        card:           'rgb(var(--c-card) / <alpha-value>)',
        border:         'rgb(var(--c-border) / <alpha-value>)',
        accent:         'rgb(var(--c-accent) / <alpha-value>)',
        accentDim:      'rgb(var(--c-accent-dim) / <alpha-value>)',
        running:        'rgb(var(--c-running) / <alpha-value>)',
        stopped:        'rgb(var(--c-stopped) / <alpha-value>)',
        warning:        'rgb(var(--c-warning) / <alpha-value>)',
        error:          'rgb(var(--c-error) / <alpha-value>)',
        textPrimary:    'rgb(var(--c-text-primary) / <alpha-value>)',
        textSecondary:  'rgb(var(--c-text-secondary) / <alpha-value>)',
        textMuted:      'rgb(var(--c-text-muted) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}

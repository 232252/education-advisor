/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 风险等级色板
        risk: {
          low: '#22c55e',
          medium: '#f59e0b',
          high: '#ef4444',
          extreme: '#7f1d1d',
        },
        // Agent 状态色
        agent: {
          idle: '#6b7280',
          running: '#3b82f6',
          error: '#ef4444',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}

/** @type {import('tailwindcss').Config} */
// =============================================================
// Tailwind 配置 — Education Advisor 官网
//
// 设计原则 (Rust 生态审美):
//   硬核、极简、工程美学。白色系为主 + Rust 标志色 #CE412B 作为强调色。
//   不用花哨的渐变/玻璃态, 用精确的间距和字体层级表达专业感。
// =============================================================
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  darkMode: 'class', // 跟随 Starlight 的 dark/light 切换
  theme: {
    extend: {
      colors: {
        // Rust 官方品牌色 (https://www.rust-lang.org)
        rust: {
          50: '#fef2f1',
          100: '#fee4e2',
          200: '#fecdca',
          300: '#fda29b',
          400: '#f97066',
          500: '#f04438',
          600: '#d92d20',
          700: '#b42318',
          800: '#912018',
          900: '#7a271a',
          // Rust 标志红 (用于 Logo/强调)
          DEFAULT: '#CE412B',
        },
        // 中性色 (Slab 风格, 工程美学)
        slab: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
      },
      fontFamily: {
        // 等宽字体 (代码块/数字) — 与 Rust 代码块呼应
        mono: ['"JetBrains Mono"', '"Cascadia Code"', '"Fira Code"', 'monospace'],
        // 正文 (Latin only — CLS 优化: 仅 subset 英文 + 数字)
        sans: ['"Inter"', '-apple-system', 'system-ui', 'sans-serif'],
      },
      // 发光动效 (Hero 区标题)
      animation: {
        'glow-pulse': 'glow 3s ease-in-out infinite',
        'fade-in-up': 'fadeInUp 0.6s ease-out',
      },
      keyframes: {
        glow: {
          '0%, 100%': { textShadow: '0 0 20px rgba(206, 65, 43, 0.3)' },
          '50%': { textShadow: '0 0 40px rgba(206, 65, 43, 0.6)' },
        },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

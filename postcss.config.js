// Tailwind CSS v4 — 改用官方 PostCSS 插件 @tailwindcss/postcss
// v4 不再需要单独的 tailwindcss + autoprefixer(postcss-import/autoprefixer 已内建)
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

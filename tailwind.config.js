/**
 * Tailwind CSS v4 配置说明
 *
 * ⚠️ Tailwind v4 采用 CSS-first 配置,主题已迁移至:
 *      src/renderer/styles/globals.css  的 @theme 块
 *
 * v4 不再自动加载此 JS 配置文件。此文件保留仅供:
 *  - 迁移历史参考
 *  - 若需回退 v3 时的参照(见 .upgrade-backup/tailwind.config.js)
 *
 * v4 的 content 自动检测会扫描项目源码,无需显式 content 配置。
 * darkMode:'class' 已由 globals.css 的 @custom-variant dark 实现。
 * 颜色 / 字体 / 动画 / 阴影 均在 @theme 中声明。
 *
 * 如需在 v4 中强制加载 JS 配置,可在 globals.css 添加:
 *   @import "tailwindcss";
 *   @config "../../tailwind.config.js";
 * 但当前已全量迁移到 @theme,无需 @config。
 */

// 保留导出以防个别工具仍尝试读取,内容为空 theme(v4 实际配置在 CSS 中)
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
}

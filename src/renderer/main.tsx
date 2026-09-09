// =============================================================
// React 渲染进程入口
// =============================================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { initHtmlLang, startHealWatcher } from './i18n'
// Inter Variable(西文/数字主字体) — 必须在 globals.css 之前加载，
// 使 --font-sans 首位的 "Inter Variable" @font-face 就绪；CJK 仍走系统字体。
// 仅 latin/latin-ext 两子集(本地声明,见 styles/fonts.css 头注释)
import './styles/fonts.css'
// JetBrains Mono(等宽字体) — 用于代码块/数字表格/终端输出，跨平台一致；
// 400/500/700 三 weight 仅 latin 子集(此前整包 css 实为全 6 子集)
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import './styles/globals.css'

// 启动时同步 <html lang> 到当前 i18n 语言 (修复 index.html 静态 "zh-CN" 不随切换更新)
initHtmlLang()
// app:// 分区 localStorage 刷盘窗口竞态自愈(boot 后 10s 内持续对齐偏好)
startHealWatcher()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found')
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

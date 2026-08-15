// =============================================================
// React 渲染进程入口
// =============================================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { initHtmlLang } from './i18n'
// Inter Variable(西文/数字主字体) — 必须在 globals.css 之前加载，
// 使 --font-sans 首位的 "Inter Variable" @font-face 就绪；CJK 仍走系统字体
import '@fontsource-variable/inter'
// JetBrains Mono(等宽字体) — 用于代码块/数字表格/终端输出，跨平台一致；
// 仅加载 400/500/700 三个最常用 weight 的 latin 子集(按 unicode-range 按需解码)
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/700.css'
import './styles/globals.css'

// 启动时同步 <html lang> 到当前 i18n 语言 (修复 index.html 静态 "zh-CN" 不随切换更新)
initHtmlLang()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found')
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

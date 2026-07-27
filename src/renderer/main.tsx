// =============================================================
// React 渲染进程入口
// =============================================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { initHtmlLang } from './i18n'
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

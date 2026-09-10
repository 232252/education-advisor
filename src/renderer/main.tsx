// =============================================================
// React 渲染进程入口
// =============================================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import { createWindowApi } from '../main/preload/api/create-window-api'
import { App } from './App'
import { initHtmlLang, startHealWatcher } from './i18n'
import { installWebBridge } from './lib/web-bridge'
import type { WindowAPI } from './lib/window-api'
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

initHtmlLang()
startHealWatcher()

function renderConnecting(message: string): void {
  const rootEl = document.getElementById('root')
  if (!rootEl) throw new Error('Root element #root not found')
  rootEl.innerHTML = `<div style="font-family:system-ui,sans-serif;max-width:36rem;margin:20vh auto;padding:1.5rem;line-height:1.6">
    <h1 style="font-size:1.25rem;margin:0 0 .75rem">Education Advisor WebUI</h1>
    <p>${message}</p>
    <p style="color:#666;font-size:.9rem">请从桌面应用设置或托盘菜单打开带访问令牌的地址。</p>
  </div>`
}

function renderApp(): void {
  const rootEl = document.getElementById('root')
  if (!rootEl) throw new Error('Root element #root not found')
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

async function boot(): Promise<void> {
  if (!window.api) {
    const ok = await installWebBridge()
    if (!ok) {
      renderConnecting(
        window.location.protocol !== 'https:' && window.location.protocol !== 'http:'
          ? '请使用桌面应用给出的访问地址。'
          : '无法连上本机 WebUI。请先启动桌面应用，并在设置里选择「长期开启」或等到定时时段。确认地址里带有访问令牌。',
      )
      return
    }
    window.api = createWindowApi() as WindowAPI
  }
  renderApp()
}

void boot()

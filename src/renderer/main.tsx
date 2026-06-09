// =============================================================
// React 渲染进程入口
// =============================================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles/globals.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found')
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

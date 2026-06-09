// =============================================================
// useForwardConsole — 渲染端 console 劫持 hook
// 装到 App 顶部 useEffect,所有 console.debug/info/warn/error
// 转发到主进程 logs/renderer-YYYY-MM-DD.log
// chat.conversationLogging 关闭时仍记录 console(独立开关)
// =============================================================

import { useEffect } from 'react'
import { getAPI } from '../lib/ipc-client'

export function useForwardConsole(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const origDebug = console.debug.bind(console)
    const origInfo = console.info.bind(console)
    const origWarn = console.warn.bind(console)
    const origError = console.error.bind(console)

    const stringify = (v: unknown): string => {
      if (typeof v === 'string') return v
      try {
        return JSON.stringify(v)
      } catch {
        return String(v)
      }
    }

    console.debug = (...args: unknown[]) => {
      origDebug(...args)
      try {
        getAPI().log.forward('debug', args.map(stringify).join(' '))
      } catch {
        /* main not ready */
      }
    }
    console.info = (...args: unknown[]) => {
      origInfo(...args)
      try {
        getAPI().log.forward('info', args.map(stringify).join(' '))
      } catch {
        /* main not ready */
      }
    }
    console.warn = (...args: unknown[]) => {
      origWarn(...args)
      try {
        getAPI().log.forward('warn', args.map(stringify).join(' '))
      } catch {
        /* main not ready */
      }
    }
    console.error = (...args: unknown[]) => {
      origError(...args)
      try {
        getAPI().log.forward('error', args.map(stringify).join(' '))
      } catch {
        /* main not ready */
      }
    }

    // 启动确认日志
    console.info('[Renderer] useForwardConsole hook installed')

    return () => {
      console.debug = origDebug
      console.info = origInfo
      console.warn = origWarn
      console.error = origError
    }
  }, [])
}

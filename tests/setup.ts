// =============================================================
// Vitest 全局 setup（P2-5）
// - 静默主进程 service 中的 console.error/warn（避免测试输出噪音）
// - 提供 vi.hoisted mock 占位（不在这里 import electron,
//   由具体 spec 按需 import 并 stub）
// - 渲染进程(jsdom): 确保 localStorage 可用(某些 Node 版本下 jsdom 不提供)
// =============================================================

import { vi } from 'vitest'

// 渲染进程(jsdom): 确保 localStorage 可用
// 某些 Node.js 版本下 jsdom 不自动提供 localStorage,需要手动 polyfill
if (typeof globalThis !== 'undefined' && typeof window !== 'undefined' && !window.localStorage) {
  const store: Record<string, string> = {}
  const localStorageMock = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value)
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      for (const key of Object.keys(store)) {
        delete store[key]
      }
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length
    },
  }
  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true,
  })
}

// 主进程 service 在 catch 块里有 console.error/warn
// 测试中只验证行为,不污染输出
const originalError = console.error
const originalWarn = console.warn

beforeAll(() => {
  console.error = (...args: unknown[]) => {
    // 标记为 SUPPRESS 前缀的允许打印
    if (args[0] && typeof args[0] === 'string' && args[0].startsWith('SUPPRESS:')) {
      originalError.apply(console, args)
      return
    }
    // 其余静默(但保留记录到数组以备需要时检查)
  }
  console.warn = (...args: unknown[]) => {
    if (args[0] && typeof args[0] === 'string' && args[0].startsWith('SUPPRESS:')) {
      originalWarn.apply(console, args)
    }
  }
})

afterAll(() => {
  console.error = originalError
  console.warn = originalWarn
  vi.restoreAllMocks()
})

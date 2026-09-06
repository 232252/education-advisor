// =============================================================
// toastStore 测试 mock 单一来源 — 此前 11 个 hook 测试各抄一份
// 用法:
//   vi.mock('<rel>/src/renderer/stores/toastStore',
//     async () => (await import('<rel>/helpers/mock-toast')).mockToastStore)
//   import { toastMocks } from '<rel>/helpers/mock-toast'  // 断言用
// =============================================================

import { vi } from 'vitest'

export const toastMocks = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  show: vi.fn(),
  dismiss: vi.fn(),
  clear: vi.fn(),
}

export const mockToastStore = { toast: toastMocks }

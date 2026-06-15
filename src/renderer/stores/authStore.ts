// =============================================================
// Auth Store — OAuth 回调桥接 (Tauri only)
// =============================================================
//
// 启动时自动监听 `oauth-callback` 事件 (deep-link 触发),
// 拿到 {code, state, providerId} 后调后端 ai_oauth_exchange 换 token。
//
// 收到回调后自动清空 pending state, 弹 toast 提示用户成功/失败。
//
// Electron 模式不需这个 store (用 loopback HTTP 替代 deep-link)。

import { create } from 'zustand'
import { getAPI } from '../lib/ipc-client'
import { toast } from './toastStore'

interface OAuthCallback {
  code: string
  state: string
  providerId?: string
}

interface AuthState {
  /** 当前正在等待的 flow state (用于防重复触发 exchange) */
  pendingState: string | null
  /** 启动时一次性注册监听 (幂等) */
  initListener: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  pendingState: null,

  initListener: () => {
    // 避免重复注册 (React strict mode 双调用)
    if ((window as unknown as { __ea_oauth_listener?: boolean }).__ea_oauth_listener) {
      return
    }
    ;(window as unknown as { __ea_oauth_listener?: boolean }).__ea_oauth_listener = true

    // 仅 Tauri 模式: 动态 require 避免 Electron 构建拉 @tauri-apps/api
    const tauriInternals = (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__
    if (!tauriInternals) {
      // Electron 模式不监听
      return
    }

    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
        const { listen } =
          require('@tauri-apps/api/event') as typeof import('@tauri-apps/api/event')
        await listen<OAuthCallback>('oauth-callback', async (event) => {
          const { code, state, providerId } = event.payload
          if (!code || !state) {
            toast.error('OAuth 回调缺少 code 或 state')
            return
          }
          if (get().pendingState && get().pendingState !== state) {
            // 不同的 state 同时进行 → 仅处理最新的 (避免重放)
            console.warn('[authStore] 收到非当前 pending state, 忽略:', state)
            return
          }
          set({ pendingState: state })
          try {
            const r = await (
              getAPI().ai as unknown as {
                oauthExchange: (
                  c: string,
                  s: string,
                  p: string,
                ) => Promise<{ success: boolean; providerId?: string; error?: string }>
              }
            ).oauthExchange(code, state, providerId || '')
            if (r.success) {
              toast.success(`${providerId || 'OAuth'} 登录成功`)
            } else {
              toast.error(`OAuth 登录失败: ${r.error || '未知错误'}`)
            }
          } catch (e) {
            toast.error(`OAuth exchange 异常: ${(e as Error).message}`)
          } finally {
            set({ pendingState: null })
          }
        })
      } catch (e) {
        console.warn('[authStore] 监听 oauth-callback 失败:', e)
      }
    })()
  },
}))

// 在应用启动时调用一次
useAuthStore.getState().initListener()

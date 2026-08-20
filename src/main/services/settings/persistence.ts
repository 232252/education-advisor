// =============================================================
// 设置持久化 — 节流写盘 / 原子写入 / flush
//
// 修复:
//   P1-26: save() 改为异步写盘
//   A6: 通过单个 fd 写入 + fsync 确保数据落盘后再 rename
//   M17b: 原子写序列收敛到 utils/atomic-write(与 keystore-service 共享)
// =============================================================

import type { UnifiedSettings } from '@shared/types'
import { atomicWrite } from '../../utils/atomic-write'

/** 持久化状态(节流定时器/写入标志/最近错误) */
export interface PersistenceState {
  /** settings.json 路径 */
  settingsPath: string
  /** 待写入的 setTimeout id（用于节流） */
  saveTimer: NodeJS.Timeout | null
  /** 是否有未完成的写入 */
  writing: boolean
  /** 已有写入进行中时标记需要再次写盘 */
  needsResave: boolean
  /** 上次错误信息 */
  lastError: string | null
}

/**
 * 节流保存：500ms 内的多次 update 合并为一次写入
 * 立即保存可用 saveNow()（fire-and-forget）
 */
export function scheduleSave(
  state: PersistenceState,
  getSettings: () => UnifiedSettings,
  immediate = false,
): void {
  if (state.saveTimer) {
    clearTimeout(state.saveTimer)
    state.saveTimer = null
  }
  if (immediate) {
    void saveNow(state, getSettings)
  } else {
    state.saveTimer = setTimeout(() => {
      state.saveTimer = null
      void saveNow(state, getSettings)
    }, 300)
  }
}

/** 异步写盘，不阻塞主进程（P1-26） */
export async function saveNow(
  state: PersistenceState,
  getSettings: () => UnifiedSettings,
): Promise<void> {
  if (state.writing) {
    // 已有写入进行中,标记需要再次写盘;当前 write 完成后会在 do-while 里重写最新状态
    state.needsResave = true
    return
  }
  state.writing = true
  try {
    do {
      state.needsResave = false
      const json = JSON.stringify(getSettings(), null, 2)
      // M17b 收敛: 原子写入(fd+fsync+rename,带 EPERM/EACCES/EBUSY 重试)
      // 统一走 utils/atomic-write,与 keystore-service 共享同一实现
      // (A6 语义保留: fsync 确保数据落盘后再 rename,防 Windows 文件缓存
      //  在 SIGKILL/断电时丢失刚 rename 的设置)
      await atomicWrite(state.settingsPath, json)
      state.lastError = null
    } while (state.needsResave)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    state.lastError = `Failed to save settings: ${msg}`
    console.error('[Settings] Save failed:', msg)
  } finally {
    state.writing = false
  }
}

/** 等待所有待写入完成（graceful shutdown） */
export async function flush(
  state: PersistenceState,
  getSettings: () => UnifiedSettings,
): Promise<void> {
  if (state.saveTimer) {
    clearTimeout(state.saveTimer)
    state.saveTimer = null
    await saveNow(state, getSettings)
  }
  while (state.writing) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

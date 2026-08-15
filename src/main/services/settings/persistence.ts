// =============================================================
// 设置持久化 — 节流写盘 / 原子写入 / flush
//
// 修复:
//   P1-26: save() 改为异步写盘
//   A6: 通过单个 fd 写入 + fsync 确保数据落盘后再 rename
//   使用唯一临时文件名避免 Windows 上 writeFile+rename 的竞态条件
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import type { UnifiedSettings } from '@shared/types'

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
      // 修复: 使用唯一临时文件名避免 Windows 上 writeFile+rename 的竞态条件
      const tmpPath = `${state.settingsPath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
      // 确保目录存在
      await fsp.mkdir(path.dirname(state.settingsPath), { recursive: true })
      // A6 修复: 通过单个 fd 写入 + fsync 确保数据落盘后再 rename,
      // 避免 Windows 文件缓存在 SIGKILL/断电时丢失刚 rename 的设置 (R4 同类问题)
      const fd = await fsp.open(tmpPath, 'w')
      try {
        await fd.writeFile(json, 'utf-8')
        await fd.sync()
      } finally {
        await fd.close()
      }
      await fsp.rename(tmpPath, state.settingsPath)
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

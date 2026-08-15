// =============================================================
// Ollama 服务检测 — 二进制定位 / serve 运行检测 / 系统 PATH 检测
//
// 检测结果缓存于 DetectionState(直到 reset)。
// =============================================================

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { log } from '../../utils/logger'
import { HEALTH_TIMEOUT_MS, OLLAMA_BASE_URL } from './constants'

/** 检测缓存状态 */
export interface DetectionState {
  /** null = 未检测; boolean = 缓存的检测结果 */
  available: boolean | null
}

/**
 * 解析 ollama 二进制路径。
 * 优先级: 系统 PATH > 打包 resources/ollama/
 */
export function resolveBinaryPath(): string | null {
  // 1. 打包模式: resources/ollama/ollama.exe
  const platform = process.platform
  const binName = platform === 'win32' ? 'ollama.exe' : 'ollama'

  // dev 路径
  const devPath = path.join(__dirname, '..', '..', '..', 'resources', 'ollama', binName)
  if (fs.existsSync(devPath)) return devPath

  // packaged 路径
  if (app.isPackaged) {
    const pkgPath = path.join(process.resourcesPath, 'ollama', binName)
    if (fs.existsSync(pkgPath)) return pkgPath
  }

  // 2. 回退: 系统 PATH 里的 ollama (用户自行安装)
  // 用 `ollama --version` 检测,这里先返回 'ollama' 让 detect() 去验证
  return null
}

/**
 * 检测 ollama 是否可用(二进制存在 OR serve 已在运行)。
 * 结果缓存(直到 reset)。
 */
export async function detect(state: DetectionState): Promise<boolean> {
  if (state.available !== null) return state.available

  // 先检查 serve 是否已经在跑(可能是用户自己启动的)
  const running = await isServeRunning()
  if (running) {
    state.available = true
    log('info', 'ollama', 'detected: serve already running on :11434')
    return true
  }

  // 检查二进制是否存在
  const binPath = resolveBinaryPath()
  if (binPath) {
    state.available = true
    log('info', 'ollama', `detected: binary at ${binPath}`)
    return true
  }

  // 检查系统 PATH(尝试 ollama --version)
  const inPath = await checkSystemOllama()
  state.available = inPath
  if (inPath) log('info', 'ollama', 'detected: system ollama in PATH')
  return inPath
}

/** 重置检测结果缓存(强制重新检测) */
export function resetDetection(state: DetectionState): void {
  state.available = null
}

/** 检查 ollama serve 是否已在 11434 端口运行 */
export async function isServeRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

/** 检查系统 PATH 里是否有 ollama */
function checkSystemOllama(): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = process.platform
    const cmd = platform === 'win32' ? 'where' : 'which'
    const proc = spawn(cmd, ['ollama'], { stdio: 'pipe', shell: false })
    let settled = false
    const done = (result: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    proc.on('error', () => done(false))
    proc.on('exit', (code) => done(code === 0))
    const timer = setTimeout(() => {
      if (!proc.killed) proc.kill()
      done(false)
    }, HEALTH_TIMEOUT_MS)
  })
}

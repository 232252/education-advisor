// =============================================================
// Ollama serve 启停管理 — 后台子进程生命周期
//
// 启动 ollama serve(后台子进程,绑定 127.0.0.1:11434),
// 设计参照 eaa-bridge.ts 的原生二进制管理模式。
// =============================================================

import { spawn } from 'node:child_process'
import { log } from '../../utils/logger'
import { SERVE_WAIT_MS } from './constants'
import { isServeRunning, resolveBinaryPath } from './detection'

/** serve 子进程状态 */
export interface ServeState {
  /** 当前 serve 子进程(仅跟踪本服务启动的进程) */
  process: ReturnType<typeof spawn> | null
}

/**
 * 启动 ollama serve(后台子进程)。
 * 如果 serve 已在运行,直接返回。
 * @returns 是否成功启动
 */
export async function startServe(state: ServeState): Promise<boolean> {
  // 已在运行
  if (await isServeRunning()) {
    log('info', 'ollama', 'serve already running')
    return true
  }

  const binPath = resolveBinaryPath()
  if (!binPath) {
    log('warn', 'ollama', 'no ollama binary found, cannot start serve')
    return false
  }

  // 启动 serve,设置环境变量
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OLLAMA_HOST: '127.0.0.1:11434',
    OLLAMA_ORIGINS: '*',
  }
  try {
    const serveProcess = spawn(binPath, ['serve'], {
      stdio: 'pipe',
      env,
      detached: false,
      windowsHide: true,
    })
    state.process = serveProcess
    // 消费 stdout/stderr 防止管道缓冲区满导致子进程挂起
    serveProcess.stdout?.on('data', () => {})
    serveProcess.stderr?.on('data', (d) => {
      log('debug', 'ollama', `serve stderr: ${d.toString().trim()}`)
    })
    serveProcess.on('error', (err) => {
      log('error', 'ollama', `serve process error: ${err.message}`)
      state.process = null
    })
    serveProcess.on('exit', (code) => {
      log('info', 'ollama', `serve process exited with code ${code}`)
      state.process = null
    })
    // 等待 serve 就绪
    await new Promise((r) => setTimeout(r, SERVE_WAIT_MS))
    const ready = await isServeRunning()
    if (ready) {
      log('info', 'ollama', 'serve started successfully')
    } else {
      log('warn', 'ollama', 'serve started but health check failed')
    }
    return ready
  } catch (err) {
    log('error', 'ollama', `failed to start serve: ${err}`)
    return false
  }
}

/** 停止 ollama serve(仅停止我们启动的子进程) */
export function stopServe(state: ServeState): void {
  if (state.process && !state.process.killed) {
    // L-2 修复: 检查 kill() 返回值,失败时记录警告(可能权限不足或进程已退出)
    const killed = state.process.kill()
    if (killed) {
      log('info', 'ollama', 'serve stopped')
    } else {
      log('warn', 'ollama', 'failed to kill serve process (may require manual cleanup)')
    }
    // 销毁 stdout/stderr 流释放资源
    state.process.stdout?.destroy()
    state.process.stderr?.destroy()
  }
  state.process = null
}

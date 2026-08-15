// =============================================================
// EAA Bridge — 子进程执行器
// spawn / 超时 SIGTERM→SIGKILL 升级 / 输出累积上限 / 事件接线
// 从 eaa-bridge.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import { debug } from '@shared/debug'
import spawn from 'cross-spawn'
import { buildCommandArgs, sanitizeArgsForLog } from './command-classification'
import { parseProcessOutput } from './output-parser'
import type { EAACommand, EAAResult } from './types'

/** 进程执行上下文(实例状态由 EAABridge 编排层显式传入,子模块不持有实例状态) */
export interface ProcessExecutorContext {
  /** 已解析的 eaa 二进制路径(调用前保证非 null) */
  binaryPath: string
  /** EAA 数据目录(作为 cwd 与 EAA_DATA_DIR 环境变量) */
  dataDir: string
  /** 隐私引擎密码(可选,通过 EAA_PRIVACY_PASSWORD 环境变量传递) */
  privacyPassword?: string
  /** 活跃子进程注册表(P1-10,shutdown 时终止所有 in-flight 进程) */
  activeProcesses: Set<ReturnType<typeof spawn>>
  /** ENOENT 回调: 二进制消失时由编排层更新 unavailableReason/binaryPath 状态 */
  onBinaryDisappeared: (message: string) => void
  /** 可选 AbortSignal(pi-agent-core 工具执行透传):已 abort 则不 spawn,执行中 abort 则 kill 子进程 */
  signal?: AbortSignal
}

/** F4: abort 结果构造(与 spawn error 路径的 EAAResult 字段形态保持一致) */
function abortedResult<T>(): EAAResult<T> {
  return { success: false, data: null, stderr: 'aborted', exitCode: -1 }
}

/**
 * 实际执行 EAA 命令的子进程逻辑(提取自 EAABridge._doExecute,逻辑逐字保留)。
 * 调用前 execute 已完成 binaryPath 重新 resolve 和 unavailable 检查。
 * 写命令由 execute 通过 writeQueue 串行化后调用,读命令直接调用。
 */
export function executeProcess<T = unknown>(
  cmd: EAACommand,
  ctx: ProcessExecutorContext,
): Promise<EAAResult<T>> {
  const startTime = debug.eaa ? Date.now() : 0

  return new Promise((resolve) => {
    // F4: 调用方已取消(signal 已 abort)则不 spawn,直接返回失败
    if (ctx.signal?.aborted) {
      resolve(abortedResult<T>())
      return
    }

    // 根据命令名决定是否追加 --output json
    const args = buildCommandArgs(cmd)

    if (debug.eaa) {
      // High 修复: privacy init/load/disable 命令的 args 中包含明文密码(位置参数),
      // 直接打印会泄露到主进程日志文件,需要脱敏
      // 注意: cmd.args 不含命令名(结构 ['init', 'password']),
      //       args 含命令名(结构 ['privacy', 'init', 'password']),
      //       两者都需要脱敏,但 sanitizeArgsForLog 需要区分
      const safeArgs = sanitizeArgsForLog(cmd.command, cmd.args, false)
      const safeFullArgs = sanitizeArgsForLog(cmd.command, args, true)
      console.log('[debug:eaa] spawn', {
        command: cmd.command,
        args: safeArgs,
        fullArgs: safeFullArgs,
        timeout: cmd.timeout ?? 30_000,
      })
    }

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      EAA_DATA_DIR: ctx.dataDir,
    }
    if (ctx.privacyPassword) {
      env.EAA_PRIVACY_PASSWORD = ctx.privacyPassword
    }

    const proc = spawn(ctx.binaryPath, args, {
      cwd: ctx.dataDir,
      env,
      // 不使用 spawn 自带 timeout(仅发 SIGTERM),改用手动管理支持 SIGKILL 升级
      windowsHide: true,
    })

    // P1-10: 注册到活跃进程表, 供 shutdown() 终止
    ctx.activeProcesses.add(proc)

    // F4: 执行中 abort → kill 子进程(SIGTERM,与超时路径相同的终止策略),
    // close/error 时按 aborted 标志返回统一的失败结果
    let aborted = false
    const onAbort = () => {
      if (aborted) return
      aborted = true
      try {
        proc.kill('SIGTERM')
      } catch {
        /* already exited */
      }
    }
    ctx.signal?.addEventListener('abort', onAbort, { once: true })

    // 修复: 超时后 SIGTERM → 3秒后 SIGKILL 升级,防止子进程成为孤儿
    const timeoutMs = cmd.timeout ?? 30_000
    let sigkillHandle: ReturnType<typeof setTimeout> | null = null
    const timeoutHandle = setTimeout(() => {
      try {
        proc.kill('SIGTERM')
      } catch {
        /* already exited */
      }
      // 3 秒后升级到 SIGKILL,确保进程被强制终止
      sigkillHandle = setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch {
          /* already exited */
        }
      }, 3000)
    }, timeoutMs)

    // MEDIUM 修复: stdout/stderr 设置 50MB/10MB 累积上限,溢出时截断并 kill 子进程,防止 OOM
    // 重要: 用 Buffer 累积而非字符串拼接。多字节 UTF-8 字符(如中文学生名)可能被
    // 拆分到两个 data chunk 上,逐 chunk toString() 会产生 U+FFFD 替换符,破坏 JSON。
    const MAX_STDOUT_BYTES = 50 * 1024 * 1024
    const MAX_STDERR_BYTES = 10 * 1024 * 1024
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let stdoutTruncated = false
    let stderrTruncated = false

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutTruncated) return
      stdoutChunks.push(chunk)
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        stdoutChunks.push(Buffer.from('\n[... stdout truncated at 50MB ...]'))
        stdoutTruncated = true
        try {
          proc.kill('SIGTERM')
        } catch {
          /* already exited */
        }
      }
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (stderrTruncated) return
      stderrChunks.push(chunk)
      stderrBytes += chunk.length
      if (stderrBytes > MAX_STDERR_BYTES) {
        stderrChunks.push(Buffer.from('\n[... stderr truncated at 10MB ...]'))
        stderrTruncated = true
        try {
          proc.kill('SIGTERM')
        } catch {
          /* already exited */
        }
      }
    })

    proc.on('close', (code) => {
      clearTimeout(timeoutHandle)
      if (sigkillHandle) clearTimeout(sigkillHandle)
      ctx.activeProcesses.delete(proc)
      ctx.signal?.removeEventListener('abort', onAbort)
      // F4: 因 abort 被 kill 的进程统一返回 aborted 失败结果
      if (aborted) {
        resolve(abortedResult<T>())
        return
      }
      const exitCode = code ?? -1
      const success = exitCode === 0

      // 合并 Buffer 后一次性解码为字符串，避免多字节字符被拆分到不同 chunk
      const stdout = Buffer.concat(stdoutChunks).toString('utf8')
      const stderr = Buffer.concat(stderrChunks).toString('utf8')

      if (debug.eaa) {
        const elapsed = Date.now() - startTime
        const stdoutPreview =
          stdout.length > 500 ? `${stdout.slice(0, 500)}... (${stdout.length} chars)` : stdout
        const stderrPreview =
          stderr.length > 500 ? `${stderr.slice(0, 500)}... (${stderr.length} chars)` : stderr
        console.log('[debug:eaa] close', {
          command: cmd.command,
          exitCode,
          success,
          elapsedMs: elapsed,
          stdoutPreview,
          stderrPreview,
        })
      }

      // 解析 stdout：仅当追加了 --output json 时尝试 JSON.parse
      const expectsJson = args.includes('--output') && args.includes('json')
      resolve(parseProcessOutput<T>(stdout, stderr, exitCode, expectsJson))
    })

    proc.on('error', (err) => {
      clearTimeout(timeoutHandle)
      ctx.activeProcesses.delete(proc)
      ctx.signal?.removeEventListener('abort', onAbort)
      // F4: abort 触发的 kill 在部分平台走 error 路径,同样返回统一 aborted 结果
      if (aborted) {
        resolve(abortedResult<T>())
        return
      }
      // M-7 修复: 清理 stream listeners,防止 error 后仍接收数据造成资源泄漏
      proc.stdout?.removeAllListeners('data')
      proc.stderr?.removeAllListeners('data')
      if (debug.eaa) {
        console.error('[debug:eaa] spawn error', {
          command: cmd.command,
          error: err.message,
          code: (err as NodeJS.ErrnoException).code,
        })
      }
      // ENOENT 触发时更新 unavailable 状态
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        ctx.onBinaryDisappeared(err.message)
      }
      resolve({
        success: false,
        data: null,
        stderr: err.message,
        exitCode: -1,
      })
    })
  })
}

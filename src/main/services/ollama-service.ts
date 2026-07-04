// =============================================================
// OllamaService — 本地 LLM 运行时管理
//
// 管理打包/系统安装的 ollama.exe 生命周期:
//   - 检测 ollama 是否可用(系统安装 或 打包二进制)
//   - 启动 ollama serve(后台子进程,绑定 127.0.0.1:11434)
//   - 列出已安装模型 (GET /api/tags)
//   - 下载模型 (POST /api/pull,流式进度)
//   - 删除模型 (DELETE /api/delete)
//
// 设计参照 eaa-bridge.ts 的原生二进制管理模式。
// =============================================================

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { log } from '../utils/logger'

/** Ollama REST API 基地址(固定本地) */
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
/** Ollama OpenAI 兼容端点(pi-ai provider baseUrl) */
export const OLLAMA_OPENAI_BASE_URL = 'http://127.0.0.1:11434/v1'
/** 本地/keyless provider 列表 — 这些 provider 不需要 apiKey */
export const KEYLESS_PROVIDERS = new Set(['ollama'])
/** Ollama 连接检测超时(ms) */
const HEALTH_TIMEOUT_MS = 3000
/** Ollama serve 启动等待(ms) */
const SERVE_WAIT_MS = 2000

export interface OllamaModel {
  name: string
  size: number
  digest: string
  details?: {
    family?: string
    parameter_size?: string
    quantization_level?: string
  }
}

export interface OllamaPullProgress {
  status: string
  completed?: number
  total?: number
  digest?: string
}

class OllamaService {
  private serveProcess: ReturnType<typeof spawn> | null = null
  private _available: boolean | null = null

  /**
   * 解析 ollama 二进制路径。
   * 优先级: 系统 PATH > 打包 resources/ollama/
   */
  resolveBinaryPath(): string | null {
    // 1. 打包模式: resources/ollama/ollama.exe
    const platform = process.platform
    const binName = platform === 'win32' ? 'ollama.exe' : 'ollama'

    // dev 路径
    const devPath = path.join(__dirname, '..', '..', 'resources', 'ollama', binName)
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
  async detect(): Promise<boolean> {
    if (this._available !== null) return this._available

    // 先检查 serve 是否已经在跑(可能是用户自己启动的)
    const running = await this.isServeRunning()
    if (running) {
      this._available = true
      log('info', 'ollama', 'detected: serve already running on :11434')
      return true
    }

    // 检查二进制是否存在
    const binPath = this.resolveBinaryPath()
    if (binPath) {
      this._available = true
      log('info', 'ollama', `detected: binary at ${binPath}`)
      return true
    }

    // 检查系统 PATH(尝试 ollama --version)
    const inPath = await this.checkSystemOllama()
    this._available = inPath
    if (inPath) log('info', 'ollama', 'detected: system ollama in PATH')
    return inPath
  }

  /** 重置检测结果缓存(强制重新检测) */
  resetDetection(): void {
    this._available = null
  }

  /** 检查 ollama serve 是否已在 11434 端口运行 */
  async isServeRunning(): Promise<boolean> {
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
  private checkSystemOllama(): Promise<boolean> {
    return new Promise((resolve) => {
      const platform = process.platform
      const cmd = platform === 'win32' ? 'where' : 'which'
      const proc = spawn(cmd, ['ollama'], { stdio: 'pipe', shell: false })
      proc.on('error', () => resolve(false))
      proc.on('exit', (code) => resolve(code === 0))
      setTimeout(() => {
        if (!proc.killed) proc.kill()
        resolve(false)
      }, HEALTH_TIMEOUT_MS)
    })
  }

  /**
   * 启动 ollama serve(后台子进程)。
   * 如果 serve 已在运行,直接返回。
   * @returns 是否成功启动
   */
  async startServe(): Promise<boolean> {
    // 已在运行
    if (await this.isServeRunning()) {
      log('info', 'ollama', 'serve already running')
      return true
    }

    const binPath = this.resolveBinaryPath()
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
      this.serveProcess = spawn(binPath, ['serve'], {
        stdio: 'pipe',
        env,
        detached: false,
        windowsHide: true,
      })
      this.serveProcess.on('error', (err) => {
        log('error', 'ollama', `serve process error: ${err.message}`)
        this.serveProcess = null
      })
      this.serveProcess.on('exit', (code) => {
        log('info', 'ollama', `serve process exited with code ${code}`)
        this.serveProcess = null
      })
      // 等待 serve 就绪
      await new Promise((r) => setTimeout(r, SERVE_WAIT_MS))
      const ready = await this.isServeRunning()
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
  stopServe(): void {
    if (this.serveProcess && !this.serveProcess.killed) {
      this.serveProcess.kill()
      log('info', 'ollama', 'serve stopped')
    }
    this.serveProcess = null
  }

  /**
   * 列出已安装模型。
   * 需要 serve 在运行。
   */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      })
      if (!res.ok) return []
      const data = (await res.json()) as { models?: OllamaModel[] }
      return data.models ?? []
    } catch {
      return []
    }
  }

  /**
   * 下载(pull)一个模型,流式返回进度。
   * @param modelName 模型名,如 "qwen3:1.7b"
   * @param onProgress 进度回调
   */
  async pullModel(
    modelName: string,
    onProgress: (p: OllamaPullProgress) => void,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true }),
      })
      if (!res.ok || !res.body) {
        return { success: false, error: `HTTP ${res.status}` }
      }
      // 逐行读取流式 JSON
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let success = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const evt = JSON.parse(line) as OllamaPullProgress
            onProgress(evt)
            if (evt.status === 'success') success = true
          } catch {
            // 忽略解析失败的行
          }
        }
      }
      return { success }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  }

  /** 删除一个已安装模型 */
  async deleteModel(modelName: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
      })
      return { success: res.ok }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  }
}

/** Ollama 服务单例 */
export const ollamaService = new OllamaService()

/**
 * 推荐的本地模型列表(中文友好 + CPU友好)。
 * 用户可在模型页一键下载。
 */
export interface RecommendedModel {
  tag: string
  name: string
  sizeLabel: string
  chineseLevel: '优秀' | '良好' | '一般'
  tier: 'CPU入门' | 'CPU进阶' | 'GPU/大内存'
  description: string
  /** 手动下载 GGUF 的备选链接(免登录) */
  manualUrls: Array<{ label: string; url: string }>
}

export const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    tag: 'qwen3:1.7b',
    name: 'Qwen3 1.7B',
    sizeLabel: '~1 GB',
    chineseLevel: '优秀',
    tier: 'CPU入门',
    description: '阿里通义千问3代,1.7B参数,CPU上速度极快,中文能力优秀。推荐入门首选。',
    manualUrls: [
      {
        label: 'HuggingFace',
        url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
      },
      {
        label: 'ModelScope(国内快)',
        url: 'https://modelscope.cn/models/Qwen/Qwen3-1.7B-GGUF',
      },
    ],
  },
  {
    tag: 'qwen3:4b',
    name: 'Qwen3 4B',
    sizeLabel: '~2.5 GB',
    chineseLevel: '优秀',
    tier: 'CPU进阶',
    description: 'Qwen3 4B,质量与速度的最佳平衡,中文能力优秀,适合稍好的CPU。',
    manualUrls: [
      {
        label: 'HuggingFace',
        url: 'https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
      },
      {
        label: 'ModelScope(国内快)',
        url: 'https://modelscope.cn/models/Qwen/Qwen3-4B-GGUF',
      },
    ],
  },
  {
    tag: 'qwen2.5:3b',
    name: 'Qwen2.5 3B',
    sizeLabel: '~2 GB',
    chineseLevel: '优秀',
    tier: 'CPU进阶',
    description: 'Qwen2.5 3B,成熟稳定,中文优秀,CPU推理速度快。',
    manualUrls: [
      {
        label: 'HuggingFace',
        url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF',
      },
      {
        label: 'ModelScope(国内快)',
        url: 'https://modelscope.cn/models/Qwen/Qwen2.5-3B-Instruct-GGUF',
      },
    ],
  },
  {
    tag: 'qwen3.6:35b-a3b',
    name: 'Qwen3.6 35B-A3B',
    sizeLabel: '~20 GB',
    chineseLevel: '优秀',
    tier: 'GPU/大内存',
    description:
      'Qwen最新3.6代,MoE架构(35B总参/3B激活),agentic coding和推理大幅升级。需≥16GB内存或GPU。',
    manualUrls: [
      {
        label: 'HuggingFace',
        url: 'https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF',
      },
      {
        label: 'ModelScope(国内快)',
        url: 'https://modelscope.cn/models/Qwen/Qwen3.6-35B-A3B-GGUF',
      },
    ],
  },
  {
    tag: 'gemma3:2b',
    name: 'Gemma 3 2B',
    sizeLabel: '~1.5 GB',
    chineseLevel: '一般',
    tier: 'CPU入门',
    description: 'Google Gemma3 2B,体积极小,CPU极速,中文能力一般。',
    manualUrls: [
      {
        label: 'HuggingFace',
        url: 'https://huggingface.co/google/gemma-3-2b-it-qat-q4_0-gguf',
      },
    ],
  },
]

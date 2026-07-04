// =============================================================
// LocalModelsSection — 本地模型(Ollama)管理区
// 显示 Ollama 状态、推荐模型列表(一键下载)、已安装模型、下载进度。
// 放置在模型页顶部,独立于云端 provider 管理。
// =============================================================

import type { OllamaModelInfo, OllamaPullProgressInfo, OllamaStatusInfo } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'

// 推荐模型列表(与主进程 RECOMMENDED_MODELS 保持一致,这里内联用于 UI)
// 按硬件需求分级: CPU入门 → CPU进阶 → GPU/大内存
const RECOMMENDED = [
  {
    tag: 'qwen3:1.7b',
    name: 'Qwen3 1.7B',
    size: '~1 GB',
    chinese: '优秀',
    tier: 'CPU入门',
    desc: '阿里通义千问3代,1.7B参数,CPU上速度极快,中文优秀。入门首选。',
    manual: [
      { label: 'HuggingFace', url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF' },
      { label: 'ModelScope', url: 'https://modelscope.cn/models/Qwen/Qwen3-1.7B-GGUF' },
    ],
  },
  {
    tag: 'qwen3:4b',
    name: 'Qwen3 4B',
    size: '~2.5 GB',
    chinese: '优秀',
    tier: 'CPU进阶',
    desc: '质量与速度的最佳平衡,中文优秀,适合稍好的CPU。',
    manual: [
      { label: 'HuggingFace', url: 'https://huggingface.co/unsloth/Qwen3-4B-GGUF' },
      { label: 'ModelScope', url: 'https://modelscope.cn/models/Qwen/Qwen3-4B-GGUF' },
    ],
  },
  {
    tag: 'qwen2.5:3b',
    name: 'Qwen2.5 3B',
    size: '~2 GB',
    chinese: '优秀',
    tier: 'CPU进阶',
    desc: '成熟稳定,中文优秀,CPU推理速度快。',
    manual: [
      { label: 'HuggingFace', url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF' },
      { label: 'ModelScope', url: 'https://modelscope.cn/models/Qwen/Qwen2.5-3B-Instruct-GGUF' },
    ],
  },
  {
    tag: 'qwen3.6:35b-a3b',
    name: 'Qwen3.6 35B-A3B',
    size: '~20 GB',
    chinese: '优秀',
    tier: 'GPU/大内存',
    desc: 'Qwen最新3.6代,MoE架构(35B总参/3B激活),agentic coding和推理大幅升级。需≥16GB内存或GPU。',
    manual: [
      { label: 'HuggingFace', url: 'https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF' },
      { label: 'ModelScope', url: 'https://modelscope.cn/models/Qwen/Qwen3.6-35B-A3B-GGUF' },
    ],
  },
  {
    tag: 'gemma3:2b',
    name: 'Gemma 3 2B',
    size: '~1.5 GB',
    chinese: '一般',
    tier: 'CPU入门',
    desc: 'Google Gemma3 2B,体积极小,CPU极速,中文一般。',
    manual: [
      { label: 'HuggingFace', url: 'https://huggingface.co/google/gemma-3-2b-it-qat-q4_0-gguf' },
    ],
  },
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function LocalModelsSection() {
  const [status, setStatus] = useState<OllamaStatusInfo | null>(null)
  const [installed, setInstalled] = useState<OllamaModelInfo[]>([])
  const [pulling, setPulling] = useState<string | null>(null)
  const [progress, setProgress] = useState<OllamaPullProgressInfo | null>(null)
  const [expandedManual, setExpandedManual] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const st = await getAPI().ollama.detect()
      setStatus(st)
      if (st.serveRunning) {
        const models = await getAPI().ollama.listModels()
        setInstalled(models)
      } else {
        setInstalled([])
      }
    } catch {
      /* 忽略 */
    }
  }, [])

  useEffect(() => {
    refresh()
    const unsub = getAPI().ollama.onPullProgress((info) => {
      setProgress(info)
    })
    // 定时刷新状态(检测 ollama 启动)
    const timer = setInterval(refresh, 10000)
    return () => {
      unsub()
      clearInterval(timer)
    }
  }, [refresh])

  const handleStartServe = async () => {
    const r = await getAPI().ollama.startServe()
    if (r.success) {
      toast.success('Ollama 已启动')
      await refresh()
    } else {
      toast.error('Ollama 启动失败，请确认已安装 Ollama')
    }
  }

  const handlePull = async (tag: string) => {
    if (pulling) return
    setPulling(tag)
    setProgress({ model: tag, status: 'starting' })
    const r = await getAPI().ollama.pullModel(tag)
    setPulling(null)
    setProgress(null)
    if (r.success) {
      toast.success(`${tag} 下载完成`)
      await refresh()
    } else {
      toast.error(`下载失败: ${r.error}`)
    }
  }

  const handleDelete = async (name: string) => {
    const r = await getAPI().ollama.deleteModel(name)
    if (r.success) {
      toast.success(`已删除 ${name}`)
      await refresh()
    } else {
      toast.error(`删除失败: ${r.error}`)
    }
  }

  const serveRunning = status?.serveRunning ?? false
  const available = status?.available ?? false

  return (
    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-gray-800 dark:to-gray-800/50 border border-indigo-200 dark:border-gray-700 rounded-xl overflow-hidden mb-6">
      {/* 标题栏 */}
      <div className="px-5 py-4 border-b border-indigo-200 dark:border-gray-700/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🖥️</span>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">本地模型</h2>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            Ollama · CPU 推理 · 免登录免费
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              serveRunning
                ? 'bg-emerald-400 animate-pulse'
                : available
                  ? 'bg-amber-400'
                  : 'bg-gray-400 dark:bg-gray-500'
            }`}
          />
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {serveRunning ? '运行中' : available ? '已安装(未运行)' : '未安装'}
          </span>
          {serveRunning ? (
            <button
              type="button"
              onClick={() => getAPI().ollama.stopServe()}
              className="text-[10px] px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartServe}
              disabled={!available}
              className="text-[10px] px-2 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 disabled:opacity-50 transition-colors"
            >
              启动
            </button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* 未安装提示 */}
        {!available && (
          <div className="text-xs text-gray-500 dark:text-gray-400 bg-white/60 dark:bg-gray-800/40 rounded-lg p-3 leading-relaxed">
            <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">未检测到 Ollama</div>
            本地模型功能需要先安装 Ollama（免费、开源）:
            <ol className="list-decimal ml-4 mt-1 space-y-0.5">
              <li>
                访问{' '}
                <a
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-500 dark:text-indigo-400 underline"
                >
                  ollama.com/download
                </a>{' '}
                下载安装(Windows 版约 500MB)
              </li>
              <li>安装后回到此页面,点击"启动"</li>
            </ol>
          </div>
        )}

        {/* 推荐模型 */}
        <div>
          <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
            推荐模型（中文友好 · CPU 优化）
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {RECOMMENDED.map((m) => {
              const isInstalled = installed.some((i) => i.name === m.tag)
              const isPullingThis = pulling === m.tag
              const progPct =
                progress && progress.model === m.tag && progress.total
                  ? Math.round(((progress.completed ?? 0) / progress.total) * 100)
                  : 0
              return (
                <div
                  key={m.tag}
                  className="bg-white/80 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/60 rounded-lg p-3"
                >
                  <div className="flex items-start justify-between mb-1">
                    <div>
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                        {m.name}
                      </span>
                      <span className="ml-2 text-[10px] text-gray-400">{m.size}</span>
                      <span
                        className={`ml-1 text-[10px] px-1 py-0.5 rounded ${
                          m.tier === 'GPU/大内存'
                            ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
                            : m.tier === 'CPU进阶'
                              ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                              : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400'
                        }`}
                      >
                        {m.tier}
                      </span>
                      <span
                        className={`ml-1 text-[10px] px-1 py-0.5 rounded ${
                          m.chinese === '优秀'
                            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        中文{m.chinese}
                      </span>
                    </div>
                    {isInstalled ? (
                      <span className="text-[10px] text-emerald-500 dark:text-emerald-400 flex-shrink-0">
                        ✓ 已安装
                      </span>
                    ) : isPullingThis ? (
                      <span className="text-[10px] text-indigo-500 flex-shrink-0">{progPct}%</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handlePull(m.tag)}
                        disabled={!serveRunning || !!pulling}
                        className="text-[10px] px-2 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 disabled:opacity-40 transition-colors flex-shrink-0"
                      >
                        下载
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                    {m.desc}
                  </p>
                  {/* 下载进度条 */}
                  {isPullingThis && (
                    <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 transition-all duration-300"
                        style={{ width: `${progPct}%` }}
                      />
                    </div>
                  )}
                  {/* 手动下载链接 */}
                  <div className="mt-1.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedManual(expandedManual === m.tag ? null : m.tag)}
                      className="text-[10px] text-gray-400 hover:text-indigo-500 transition-colors"
                    >
                      {expandedManual === m.tag ? '收起' : '手动下载'}
                    </button>
                    {expandedManual === m.tag && (
                      <div className="flex gap-2">
                        {m.manual.map((url) => (
                          <a
                            key={url.url}
                            href={url.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-indigo-500 dark:text-indigo-400 underline"
                          >
                            {url.label}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 已安装模型 */}
        {serveRunning && installed.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
              已安装模型（{installed.length}）
            </div>
            <div className="space-y-1">
              {installed.map((m) => (
                <div
                  key={m.name}
                  className="flex items-center justify-between bg-white/60 dark:bg-gray-800/40 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-700 dark:text-gray-200 font-mono">
                      {m.name}
                    </span>
                    {m.size > 0 && (
                      <span className="text-[10px] text-gray-400">{formatBytes(m.size)}</span>
                    )}
                    {m.details?.parameter_size && (
                      <span className="text-[10px] text-gray-400">{m.details.parameter_size}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(m.name)}
                    className="text-[10px] text-gray-400 hover:text-rose-500 transition-colors"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 说明 */}
        <div className="text-[10px] text-gray-400 dark:text-gray-500 italic">
          本地模型在 CPU 上运行,不消耗网络流量,数据完全本地化。首次下载需联网,之后离线可用。
          对话时在 Agent 设置里选择 ollama provider 即可。
        </div>
      </div>
    </div>
  )
}

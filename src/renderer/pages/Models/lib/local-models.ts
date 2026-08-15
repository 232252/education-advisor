// =============================================================
// local-models — 本地模型推荐列表常量与格式化纯函数
// 自 LocalModelsSection.tsx 逐字搬移
// =============================================================

/** 手动下载链接 */
export interface ManualLink {
  label: string
  url: string
}

/** 推荐模型条目 */
export interface RecommendedModel {
  tag: string
  name: string
  size: string
  chinese: string
  tier: string
  desc: string
  manual: ManualLink[]
}

// 推荐模型列表(与主进程 RECOMMENDED_MODELS 保持一致,这里内联用于 UI)
// 按硬件需求分级: CPU入门 → CPU进阶 → GPU/大内存
export const RECOMMENDED: RecommendedModel[] = [
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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

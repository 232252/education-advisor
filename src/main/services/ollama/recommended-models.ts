// =============================================================
// 推荐的本地模型列表 — 中文友好 + CPU 友好
//
// 用户可在模型页一键下载(数据与渲染进程内联版本保持一致)。
// =============================================================

import type { RecommendedModel } from './types'

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

// =============================================================
// File Tools — 图片读取工具(read_image)
// P2-8(2026-09-13 深查 C2): 聊天链路的视觉通道。
// 此前全应用没有把图片内容发给模型的通路 — 二进制附件只传路径文字,
// 模型对"看看这张卷子"类请求只能自述"无法识别图片里的文字"。
// pi-agent-core 的 AgentToolResult.content 原生支持 ImageContent 块,
// openai-completions 客户端会把它翻译为 image_url 内容块(多模态请求),
// 无图片能力的模型则降级为 "(see attached image)" 文本占位,不会报错。
// 注入侧由 execution.ts 按 model.input 是否含 'image' 门控。
//
// 安全: 与 read_file 同口径(允许读取任意本机绝对路径是产品设计 —
// 教师让 AI 查看本机任意图片)。校验: 强制绝对路径 + normalize 前后
// 双重拒绝 ".." 路径段(防穿越),不做 path.resolve/join 拼接。
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { AgentTool } from '@main/services/llm-contracts'
import { Type } from 'typebox'
import { downscaleToAiJpeg } from '../grading/media-prep'
import { validateFilePath } from './security'
import { textResult } from './shared'

/** 支持的图片格式(与 pi-ai 各 provider 的 image 输入格式取交集) */
const IMAGE_EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
}

/** 单图上限 10MB — base64 后约 13MB,与 sys.readFile 的读内容上限同口径 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * 路径安全校验: 强制绝对路径(Windows 盘符/UNC 或 POSIX 根),
 * normalize 前后双重拒绝 ".." 段(以原样/规范化路径读取,无拼接)。
 */
function assertSafeAbsolutePath(inputPath: string): string {
  validateFilePath(inputPath)
  if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(inputPath)) {
    throw new Error('请提供图片的绝对路径(例如 C:\\Users\\...\\xxx.jpg 或 /home/.../xxx.png)')
  }
  const normalized = path.normalize(inputPath)
  for (const p of [inputPath, normalized]) {
    if (p.split(/[\\/]/).includes('..')) {
      throw new Error(`路径不安全,包含 ".." 段(疑似 path traversal): ${inputPath}`)
    }
  }
  return normalized
}

const readImageParams = Type.Object({
  path: Type.String({ description: '图片文件的绝对路径(png/jpg/jpeg/webp/bmp/gif)' }),
})

export const readImageTool: AgentTool<typeof readImageParams> = {
  name: 'read_image',
  label: '查看图片',
  description:
    '读取本机图片文件并以视觉方式查看内容(支持 png/jpg/jpeg/webp/bmp/gif)。适合查看试卷/作业照片、截图、扫描件,可直接识别其中的文字与图形。批量批改任务仍优先使用 eaa_grading_from_files(带量规抽取与复核台账),本工具用于单张查看与答疑。',
  parameters: readImageParams,
  execute: async (_toolCallId, params, signal) => {
    if (signal?.aborted) return textResult('已取消')
    const imagePath = assertSafeAbsolutePath(params.path)

    if (!fs.existsSync(imagePath)) {
      throw new Error(`文件不存在: ${imagePath}`)
    }
    const ext = path.extname(imagePath).toLowerCase()
    const mimeType = IMAGE_EXT_MIME[ext]
    if (!mimeType) {
      throw new Error(
        `不支持的图片格式: ${ext || '(无扩展名)'} (支持 ${Object.keys(IMAGE_EXT_MIME).join('/')})`,
      )
    }
    const stat = await fsp.stat(imagePath)
    if (!stat.isFile()) {
      throw new Error(`不是普通文件: ${imagePath}`)
    }
    if (stat.size === 0) {
      throw new Error(`图片文件为空(0 字节): ${imagePath}`)
    }
    if (stat.size > MAX_IMAGE_BYTES) {
      throw new Error(
        `图片过大: ${(stat.size / 1024 / 1024).toFixed(1)}MB (上限 ${MAX_IMAGE_BYTES / 1024 / 1024}MB)`,
      )
    }
    const data = await fsp.readFile(imagePath)
    // BMP 是未压缩格式：既最费 token，又是 dsh 后端唯一不受理的受支持扩展名
    // （dsh 只认 png/jpeg/webp/gif）。统一重编码成 JPEG 后两条后端形状一致。
    const prepared =
      mimeType === 'image/bmp'
        ? await downscaleToAiJpeg(data, mimeType)
        : { data: data.toString('base64'), mimeType }
    return {
      content: [
        {
          type: 'text' as const,
          text: `已加载图片: ${path.basename(imagePath)} (${(stat.size / 1024).toFixed(1)}KB, ${prepared.mimeType})`,
        },
        {
          type: 'image' as const,
          data: prepared.data,
          mimeType: prepared.mimeType,
        },
      ],
      details: { path: imagePath, size: stat.size, mimeType },
    }
  },
}

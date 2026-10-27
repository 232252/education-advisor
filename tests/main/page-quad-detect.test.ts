// =============================================================
// page-quad-detect — 自动四点检测编排(CV→AI 链)测试
// 假 canvas/quad-cv/llm-call/grading-service 等,锁定编排语义:
// CV 高置信不升 AI、低置信/失败自动 AI 兜底且 AI 胜出、AI 未配置
// 回教师可读错误、useAi=false 纯本地、任务级逐页落库与跳空卷。
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageQuad } from '@shared/grading-geometry'

const mocks = vi.hoisted(() => ({
  loadImage: vi.fn(),
  createCanvas: vi.fn(),
  detectQuadInGray: vi.fn(),
  parseQuadResponse: vi.fn(),
  toAiJpegBuffer: vi.fn(),
  completeGradingCall: vi.fn(),
  getSettings: vi.fn(),
  resolveModel: vi.fn(),
  apiKeyFor: vi.fn(),
  isVisionModel: vi.fn(),
  resolveGradingModelIds: vi.fn(),
  getTask: vi.fn(),
  paperFilePath: vi.fn(),
  saveOverlayQuads: vi.fn(),
  readFile: vi.fn(),
}))

// 原图 2000×1400 → 分析尺度 1000×700(scale 0.5),canvas 桩在 beforeEach 重置
vi.mock('@napi-rs/canvas', () => ({
  loadImage: mocks.loadImage,
  createCanvas: mocks.createCanvas,
}))
vi.mock('node:fs/promises', () => ({ default: { readFile: mocks.readFile } }))
vi.mock('../../src/main/utils/logger', () => ({
  log: vi.fn(),
  default: { log: vi.fn() },
}))
vi.mock('../../src/main/services/grading/quad-cv', () => ({
  buildQuadPrompt: vi.fn(() => 'PROMPT'),
  detectQuadInGray: mocks.detectQuadInGray,
  parseQuadResponse: mocks.parseQuadResponse,
  rgbaToGray: vi.fn(() => new Uint8Array(4)),
}))
vi.mock('../../src/main/services/grading/media-prep', () => ({
  toAiJpegBuffer: mocks.toAiJpegBuffer,
}))
vi.mock('../../src/main/services/grading/llm-call', () => ({
  completeGradingCall: mocks.completeGradingCall,
}))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: mocks.getSettings },
}))
vi.mock('../../src/main/services/pi-ai/model-utils', () => ({
  resolveModel: mocks.resolveModel,
}))
vi.mock('../../src/main/services/grading/grading-pipeline', () => ({
  apiKeyFor: mocks.apiKeyFor,
  isVisionModel: mocks.isVisionModel,
  resolveGradingModelIds: mocks.resolveGradingModelIds,
}))
vi.mock('../../src/main/services/grading/grading-service', () => ({
  gradingService: {
    getTask: mocks.getTask,
    paperFilePath: mocks.paperFilePath,
    saveOverlayQuads: mocks.saveOverlayQuads,
  },
}))

import {
  detectQuadForBuffer,
  detectQuadFromImage,
  detectQuadsForTask,
} from '../../src/main/services/grading/page-quad-detect'

/** 分析尺度(1000×700)下的 CV 四点 */
function cvQuad(confidence: number): PageQuad {
  return {
    tl: { x: 100, y: 70 },
    tr: { x: 900, y: 70 },
    br: { x: 900, y: 630 },
    bl: { x: 100, y: 630 },
    source: 'cv',
    confidence,
    imageWidth: 1000,
    imageHeight: 700,
  } as PageQuad
}

const AI_QUAD: PageQuad = {
  tl: { x: 210, y: 147 },
  tr: { x: 1890, y: 147 },
  br: { x: 1890, y: 1323 },
  bl: { x: 210, y: 1323 },
  source: 'ai',
  confidence: 0.9,
  imageWidth: 2000,
  imageHeight: 1400,
} as PageQuad

const BUF = Buffer.from('img')

describe('detectQuadForBuffer — CV→AI 自动链', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadImage.mockResolvedValue({ width: 2000, height: 1400 })
    mocks.createCanvas.mockReturnValue({
      getContext: () => ({
        drawImage: () => undefined,
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      }),
    })
  })

  it('CV 高置信(≥0.55): 直接采用,零 AI 调用,坐标换算回原图', async () => {
    mocks.detectQuadInGray.mockReturnValue(cvQuad(0.9))
    const r = await detectQuadForBuffer(BUF, 'T1')
    expect(r.quad).not.toBeNull()
    expect(r.quad?.source).toBe('cv')
    // 分析尺度 1000×700 → 原图 2000×1400 等比放大
    expect(r.quad?.tl).toEqual({ x: 200, y: 140 })
    expect(r.quad?.imageWidth).toBe(2000)
    expect(mocks.completeGradingCall).not.toHaveBeenCalled()
  })

  it('CV 低置信(<0.55): 自动升 AI 且 AI 四点胜出', async () => {
    mocks.detectQuadInGray.mockReturnValue(cvQuad(0.3))
    mocks.resolveGradingModelIds.mockReturnValue({ providerId: 'p', modelId: 'm' })
    mocks.resolveModel.mockReturnValue({ id: 'm', maxTokens: 512 })
    mocks.isVisionModel.mockReturnValue(true)
    mocks.apiKeyFor.mockReturnValue('key')
    mocks.toAiJpegBuffer.mockResolvedValue(Buffer.from('j'))
    mocks.completeGradingCall.mockResolvedValue({
      content: [{ type: 'text', text: '{...}' }],
    })
    mocks.parseQuadResponse.mockReturnValue(AI_QUAD)
    const r = await detectQuadForBuffer(BUF, 'T1')
    expect(r.quad?.source).toBe('ai')
    expect(mocks.completeGradingCall).toHaveBeenCalledTimes(1)
    expect(mocks.completeGradingCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ systemPrompt: 'PROMPT' }),
      expect.objectContaining({ apiKey: 'key', sessionId: 'quad:T1', maxTokens: 256 }),
    )
  })

  it('CV 失败 + AI 未配置: 回教师可读错误', async () => {
    mocks.detectQuadInGray.mockReturnValue(null)
    mocks.resolveGradingModelIds.mockReturnValue({ providerId: 'p', modelId: 'm' })
    mocks.resolveModel.mockReturnValue(null)
    const r = await detectQuadForBuffer(BUF, 'T1')
    expect(r.quad).toBeNull()
    expect(r.error).toBe('批改模型不存在')
  })

  it('useAi=false: 纯本地 CV,低置信也不升 AI', async () => {
    mocks.detectQuadInGray.mockReturnValue(cvQuad(0.3))
    const r = await detectQuadForBuffer(BUF, 'T1', false)
    expect(r.quad?.source).toBe('cv')
    expect(r.quad?.confidence).toBe(0.3)
    expect(mocks.completeGradingCall).not.toHaveBeenCalled()
  })
})

describe('detectQuadFromImage — 解码失败吞错为 null', () => {
  it('非图片字节 → null 不抛', async () => {
    mocks.loadImage.mockRejectedValue(new Error('decode failed'))
    await expect(detectQuadFromImage(Buffer.from('junk'))).resolves.toBeNull()
  })
})

describe('detectQuadsForTask — 任务级编排', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadImage.mockResolvedValue({ width: 2000, height: 1400 })
    mocks.createCanvas.mockReturnValue({
      getContext: () => ({
        drawImage: () => undefined,
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      }),
    })
    mocks.paperFilePath.mockReturnValue('C:/store/p.png')
  })

  it('逐页检测落库;空卷跳过;读文件失败页 ok:false', async () => {
    mocks.getTask.mockResolvedValue({
      papers: [
        { id: 'P1', studentName: '甲', files: [{ storedName: 'a.png' }, { storedName: 'b.png' }] },
        { id: 'P2', studentName: null, files: [] },
      ],
    })
    mocks.detectQuadInGray
      .mockReturnValueOnce(cvQuad(0.9))
      .mockReturnValueOnce(null)
    mocks.resolveGradingModelIds.mockReturnValue({ providerId: 'p', modelId: 'm' })
    mocks.resolveModel.mockReturnValue(null) // AI 未配置
    mocks.readFile.mockResolvedValue(BUF)

    const results = await detectQuadsForTask('T1')

    // P2 空卷完全不进结果
    expect(results).toHaveLength(1)
    expect(results[0].paperId).toBe('P1')
    expect(results[0].studentName).toBe('甲')
    expect(results[0].pages).toEqual([
      { page: 0, ok: true, source: 'cv', confidence: 0.9 },
      { page: 1, ok: false, error: '批改模型不存在' },
    ])
    // quads 数组含 null 占位,逐份落库
    expect(mocks.saveOverlayQuads).toHaveBeenCalledWith('T1', 'P1', [
      expect.objectContaining({ source: 'cv' }),
      null,
    ])
  })
})
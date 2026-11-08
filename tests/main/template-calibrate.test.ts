// =============================================================
// template-calibrate — 套打母版标定测试
// 假 fs/grading-service/llm-call/quad-detect 等,锁定: 入参与模型
// 六重防呆、留档与文件名净化、PDF 栅格化并入页数上限、四点失败不
// 阻断、AI 定位命中与回落、结果结构与落库形状。
// =============================================================

import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageQuad } from '@shared/grading-geometry'

const mocks = vi.hoisted(() => ({
  rm: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  getTask: vi.fn(),
  templateDirPath: vi.fn(),
  saveOverlayTemplate: vi.fn(),
  resolveModel: vi.fn(),
  getSettings: vi.fn(),
  apiKeyFor: vi.fn(),
  isVisionModel: vi.fn(),
  resolveGradingModelIds: vi.fn(),
  completeGradingCall: vi.fn(),
  toAiJpeg: vi.fn(),
  detectQuadForBuffer: vi.fn(),
  buildLocatePrompt: vi.fn(),
  parseLocateResponse: vi.fn(),
  pdfToPageJpegs: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  default: {
    rm: mocks.rm,
    mkdir: mocks.mkdir,
    stat: mocks.stat,
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
  },
}))
vi.mock('../../src/main/utils/logger', () => ({ log: vi.fn() }))
vi.mock('../../src/main/services/pi-ai/model-utils', () => ({ resolveModel: mocks.resolveModel }))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: mocks.getSettings },
}))
vi.mock('../../src/main/services/grading/archive-import', () => ({
  pdfToPageJpegs: mocks.pdfToPageJpegs,
}))
vi.mock('../../src/main/services/grading/grading-pipeline', () => ({
  apiKeyFor: mocks.apiKeyFor,
  isVisionModel: mocks.isVisionModel,
  resolveGradingModelIds: mocks.resolveGradingModelIds,
}))
vi.mock('../../src/main/services/grading/grading-service', () => ({
  gradingService: {
    getTask: mocks.getTask,
    templateDirPath: mocks.templateDirPath,
    saveOverlayTemplate: mocks.saveOverlayTemplate,
  },
}))
vi.mock('../../src/main/services/grading/llm-call', () => ({
  completeGradingCall: mocks.completeGradingCall,
}))
vi.mock('../../src/main/services/grading/media-prep', () => ({ toAiJpeg: mocks.toAiJpeg }))
vi.mock('../../src/main/services/grading/page-quad-detect', () => ({
  detectQuadForBuffer: mocks.detectQuadForBuffer,
}))
vi.mock('../../src/main/services/grading/staged-pipeline', () => ({
  buildLocatePrompt: mocks.buildLocatePrompt,
  parseLocateResponse: mocks.parseLocateResponse,
}))

import { calibrateOverlayTemplate } from '../../src/main/services/grading/template-calibrate'

const QUAD: PageQuad = {
  tl: { x: 0, y: 0 },
  tr: { x: 100, y: 0 },
  br: { x: 100, y: 140 },
  bl: { x: 0, y: 140 },
  source: 'cv',
  confidence: 0.9,
  imageWidth: 100,
  imageHeight: 140,
} as PageQuad

const RUBRIC = [
  { id: 'q1', title: '一、单选' },
  { id: 'q2', title: '二、填空' },
]

// 防穿越守卫要求原生分隔符(与生产 templateDirPath 一致):必须是绝对路径,
// 盘符写法在 Linux 上 resolve 后会脱离 destDir,守卫误报"非法样卷文件名"
const TPL_DIR = path.join(os.tmpdir(), 'ea-tpl-test', 'T1', 'template')

function readyTask(opts?: { rubric?: typeof RUBRIC }) {
  mocks.getTask.mockResolvedValue({
    rubric: opts?.rubric ?? RUBRIC,
  })
  mocks.resolveGradingModelIds.mockReturnValue({ providerId: 'p', modelId: 'm' })
  mocks.resolveModel.mockReturnValue({ id: 'm', maxTokens: 8192 })
  mocks.isVisionModel.mockReturnValue(true)
  mocks.apiKeyFor.mockReturnValue('key')
  mocks.templateDirPath.mockReturnValue(TPL_DIR)
  mocks.rm.mockResolvedValue(undefined)
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.stat.mockResolvedValue({ isFile: () => true })
  mocks.readFile.mockResolvedValue(Buffer.from('img'))
  mocks.writeFile.mockResolvedValue(undefined)
  mocks.detectQuadForBuffer.mockResolvedValue({ quad: QUAD })
  mocks.toAiJpeg.mockResolvedValue({ data: 'b64', mimeType: 'image/jpeg' })
  mocks.completeGradingCall.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] })
  mocks.parseLocateResponse.mockReturnValue(new Map([['q1', { x: 1, y: 2, w: 3, h: 4 }]]))
  mocks.buildLocatePrompt.mockReturnValue('LOCATE_PROMPT')
}

describe('calibrateOverlayTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readyTask()
  })

  it('入参与模型六重防呆', async () => {
    await expect(calibrateOverlayTemplate('T1', [])).rejects.toThrow('样卷图片不能为空')
    await expect(calibrateOverlayTemplate('T1', Array.from({ length: 9 }, (_, i) => `p${i}.png`))).rejects.toThrow(
      '样卷最多 8 页',
    )
    await expect(calibrateOverlayTemplate('T1', ['a.pdf'])).rejects.toThrow('样卷图片不能为空').catch(() => {})
    readyTask({ rubric: [] })
    await expect(calibrateOverlayTemplate('T1', ['a.png'])).rejects.toThrow('量规为空,无法标定母版')
    readyTask()
    mocks.resolveModel.mockReturnValue(null)
    await expect(calibrateOverlayTemplate('T1', ['a.png'])).rejects.toThrow('批改模型不存在')
    readyTask()
    mocks.isVisionModel.mockReturnValue(false)
    await expect(calibrateOverlayTemplate('T1', ['a.png'])).rejects.toThrow('模型不支持图像输入')
    readyTask()
    mocks.apiKeyFor.mockReturnValue(undefined)
    await expect(calibrateOverlayTemplate('T1', ['a.png'])).rejects.toThrow('未配置 API Key')
  })

  it('留档: mime 推断、序号前缀、文件名净化与 bytes 记录', async () => {
    const r = await calibrateOverlayTemplate('T1', ['卷 首.png', 'scan b.jpg'])
    expect(r.pages).toBe(2)
    const names = mocks.writeFile.mock.calls.map((c) => String(c[0]).split('\\').pop()?.split('/').pop())
    expect(names[0]).toMatch(/^tpl-1-/) // 空格净化为下划线
    expect(String(mocks.writeFile.mock.calls[0][0])).toContain('tpl-1-')
    const saved = mocks.saveOverlayTemplate.mock.calls[0][1]
    expect(saved.files).toHaveLength(2)
    expect(saved.files[0]).toMatchObject({ mime: 'image/png', bytes: 3 })
    expect(saved.files[1]).toMatchObject({ mime: 'image/jpeg' })
    expect(saved.calibratedAt).toEqual(expect.any(String))
  })

  it('不支持扩展名拒绝', async () => {
    await expect(calibrateOverlayTemplate('T1', ['a.gif'])).rejects.toThrow(
      '不支持的样卷类型 .gif',
    )
  })

  it('PDF 栅格化展开计页,超出上限拒绝', async () => {
    mocks.pdfToPageJpegs.mockResolvedValue([Buffer.from('p1'), Buffer.from('p2')])
    const r = await calibrateOverlayTemplate('T1', ['样卷.pdf'])
    expect(r.pages).toBe(2)
    expect(mocks.pdfToPageJpegs).toHaveBeenCalledWith(expect.any(Buffer), '样卷.pdf', 8)
    const saved = mocks.saveOverlayTemplate.mock.calls[0][1]
    expect(saved.files[0].name).toBe('样卷-p1.jpg')
    expect(saved.files[0].mime).toBe('image/jpeg')

    mocks.pdfToPageJpegs.mockResolvedValue(Array.from({ length: 9 }, () => Buffer.from('p')))
    await expect(calibrateOverlayTemplate('T1', ['样卷.pdf'])).rejects.toThrow(
      '样卷最多 8 页(PDF 按展开后页数计)',
    )
  })

  it('四点检测: 失败页存 null 不阻断,quadsOk 计数', async () => {
    mocks.detectQuadForBuffer
      .mockResolvedValueOnce({ quad: QUAD })
      .mockResolvedValueOnce({ quad: null, error: 'CV 未定位' })
    const r = await calibrateOverlayTemplate('T1', ['a.png', 'b.png'])
    expect(r.quadsOk).toBe(1)
    const saved = mocks.saveOverlayTemplate.mock.calls[0][1]
    expect(saved.quads).toEqual([QUAD, null])
  })

  it('AI 定位: 命中入库带 boxes 与 missing;失败回落空仍落库', async () => {
    const r = await calibrateOverlayTemplate('T1', ['a.png'])
    expect(r.located).toBe(1)
    expect(r.missing).toEqual(['二、填空'])
    expect(mocks.completeGradingCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ systemPrompt: 'LOCATE_PROMPT' }),
      expect.objectContaining({ apiKey: 'key', sessionId: 'template:T1', maxTokens: 2048 }),
    )
    const saved = mocks.saveOverlayTemplate.mock.calls[0][1]
    expect(saved.boxes).toEqual({ q1: { x: 1, y: 2, w: 3, h: 4 } })

    // locate 抛错 → boxes 缺省、missing 全量,但模板仍落库(四点可用)
    vi.clearAllMocks()
    readyTask()
    mocks.completeGradingCall.mockRejectedValue(new Error('llm down'))
    const r2 = await calibrateOverlayTemplate('T1', ['a.png'])
    expect(r2.located).toBe(0)
    expect(r2.missing).toEqual(['一、单选', '二、填空'])
    expect(mocks.saveOverlayTemplate.mock.calls[0][1].boxes).toBeUndefined()
    expect(mocks.saveOverlayTemplate.mock.calls[0][1].quads).toEqual([QUAD])
  })
})
// =============================================================
// grading-handlers — IPC 边界(信任边界)轻校验测试
// 覆盖: 参数拒绝→统一失败信封、合法路径委托到 service、
// roster 解析清洗、publish 双缓存失效、静默打印参数值域、
// CSV 导出写盘。深校验(状态机/量规)在 grading-service,不在此测。
// =============================================================

import fsp from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

const mocks = vi.hoisted(() => ({
  win: {
    webContents: {
      print: vi.fn((_opts: unknown, cb: (ok: boolean, reason?: string) => void) => cb(true)),
      printToPDF: vi.fn(async () => new Uint8Array([1, 2, 3])),
    },
  },
  startGrading: vi.fn(async () => {}),
  regradePapers: vi.fn(async () => {}),
  abortGrading: vi.fn(() => true),
  gradingService: {
    listTasks: vi.fn(async () => []),
    getTask: vi.fn(async (id: string) => ({ id, papers: [] })),
    createTask: vi.fn(async () => ({})),
    updateTask: vi.fn(async () => ({})),
    deleteTask: vi.fn(async () => {}),
    importPapers: vi.fn(async () => ({})),
    assignPaper: vi.fn(async () => ({})),
    removePaper: vi.fn(async () => ({})),
    appendPaperPages: vi.fn(async () => ({})),
    saveReview: vi.fn(async () => ({})),
    setStatus: vi.fn(async () => ({})),
    readPaperFile: vi.fn(async () => ''),
    publishTask: vi.fn(async () => ({ published: 0, skipped: [] })),
    saveOverlayQuads: vi.fn(async () => ({})),
    saveOverlayPrintSettings: vi.fn(async () => ({})),
  },
  identifyUnassignedPapers: vi.fn(async () => ({
    assigned: 0,
    unresolved: 0,
    merged: 0,
    continuationMerged: 0,
    duplicates: [],
  })),
  detectQuadsForTask: vi.fn(async () => []),
  extractRubricFromSamples: vi.fn(async () => ({})),
  refineRubricStandards: vi.fn(async () => []),
  buildSummaryCsv: vi.fn(() => '\uFEFFcsv'),
  calibrateOverlayTemplate: vi.fn(async () => ({})),
  invalidateOnExamsWrite: vi.fn(),
  invalidateOnGradesWrite: vi.fn(),
  writeFile: vi.fn(async () => {}),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler)
    }),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: class {},
}))

vi.mock('../../src/main/services/grading/grading-pipeline', () => ({
  startGrading: mocks.startGrading,
  regradePapers: mocks.regradePapers,
  abortGrading: mocks.abortGrading,
}))
vi.mock('../../src/main/services/grading/grading-service', () => ({
  gradingService: mocks.gradingService,
}))
vi.mock('../../src/main/services/grading/identify-papers', () => ({
  identifyUnassignedPapers: mocks.identifyUnassignedPapers,
}))
vi.mock('../../src/main/services/grading/page-quad-detect', () => ({
  detectQuadsForTask: mocks.detectQuadsForTask,
}))
vi.mock('../../src/main/services/grading/rubric-extract', () => ({
  extractRubricFromSamples: mocks.extractRubricFromSamples,
}))
vi.mock('../../src/main/services/grading/rubric-refine', () => ({
  refineRubricStandards: mocks.refineRubricStandards,
}))
vi.mock('../../src/main/services/grading/summary-export', () => ({
  buildSummaryCsv: mocks.buildSummaryCsv,
}))
vi.mock('../../src/main/services/grading/template-calibrate', () => ({
  calibrateOverlayTemplate: mocks.calibrateOverlayTemplate,
}))
vi.mock('../../src/main/ipc/academic/cache', () => ({
  invalidateOnExamsWrite: mocks.invalidateOnExamsWrite,
  invalidateOnGradesWrite: mocks.invalidateOnGradesWrite,
}))
vi.mock('node:fs/promises', () => ({
  default: { writeFile: mocks.writeFile },
}))

import { registerGradingHandlers } from '../../src/main/ipc/grading-handlers'
import * as IPC from '@shared/ipc-channels'

/** 失败信封断言: handleIpc 把 throw 转成 { success:false, error } */
async function expectRejected(channel: string, ...args: unknown[]) {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  const r = (await fn({} as never, ...args)) as { success: boolean; error?: string }
  expect(r.success).toBe(false)
  expect(typeof r.error).toBe('string')
  return r
}

async function callOk<T>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return (await fn({} as never, ...args)) as T
}

describe('grading-handlers IPC 边界', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerGradingHandlers(mocks.win as never)
  })

  it('getTask: 空/非字符串 taskId 拒绝;合法 id 委托 service', async () => {
    await expectRejected(IPC.IPC_GRADING_GET, '')
    await expectRejected(IPC.IPC_GRADING_GET, 42)
    const r = await callOk<{ success: boolean; data: { id: string } }>(IPC.IPC_GRADING_GET, 't1')
    expect(r.success).toBe(true)
    expect(r.data.id).toBe('t1')
    expect(mocks.gradingService.getTask).toHaveBeenCalledWith('t1')
  })

  it('setStatus: 非法状态拒绝,合法状态委托', async () => {
    const bad = await expectRejected(IPC.IPC_GRADING_SET_STATUS, 't1', 'hacked')
    expect(bad.error).toContain('非法状态')
    const r = await callOk<{ success: boolean }>(IPC.IPC_GRADING_SET_STATUS, 't1', 'review')
    expect(r.success).toBe(true)
    expect(mocks.gradingService.setStatus).toHaveBeenCalledWith('t1', 'review')
  })

  it('regrade: paperIds 空/超 200/含非字符串拒绝;合法则委托 regradePapers', async () => {
    await expectRejected(IPC.IPC_GRADING_REGRADE, 't1', [])
    await expectRejected(IPC.IPC_GRADING_REGRADE, 't1', Array.from({ length: 201 }, () => 'p'))
    await expectRejected(IPC.IPC_GRADING_REGRADE, 't1', ['ok', 5])
    const r = await callOk<{ success: boolean }>(IPC.IPC_GRADING_REGRADE, 't1', ['p1', 'p2'])
    expect(r.success).toBe(true)
    expect(mocks.regradePapers).toHaveBeenCalledWith('t1', ['p1', 'p2'], mocks.win)
  })

  it('run: roster 缺省为空数组;脏名单被清洗(trim/过滤空名/过滤空别名)', async () => {
    await callOk(IPC.IPC_GRADING_RUN, 't1')
    expect(mocks.startGrading).toHaveBeenCalledWith('t1', mocks.win, [])

    await callOk(IPC.IPC_GRADING_RUN, 't1', [
      { name: '  张三  ', aliases: ['三儿', '', 7] },
      { name: '   ' },
      'not-an-object',
      { name: '李四' },
    ])
    const roster = mocks.startGrading.mock.lastCall?.[2] as Array<{
      name: string
      aliases?: string[]
    }>
    expect(roster).toEqual([
      { name: '张三', aliases: ['三儿'] },
      { name: '李四' },
    ])
  })

  it('identifyPapers: 空名单拒绝;合法名单委托(已解析)', async () => {
    await expectRejected(IPC.IPC_GRADING_IDENTIFY_PAPERS, 't1', [])
    await expectRejected(IPC.IPC_GRADING_IDENTIFY_PAPERS, 't1', [{ name: '' }])
    const r = await callOk<{ success: boolean }>(IPC.IPC_GRADING_IDENTIFY_PAPERS, 't1', [
      { name: '王五' },
    ])
    expect(r.success).toBe(true)
    expect(mocks.identifyUnassignedPapers).toHaveBeenCalledWith('t1', [{ name: '王五' }])
  })

  it('publish: 成功后学业双缓存失效,学生名列表过滤 null', async () => {
    mocks.gradingService.getTask.mockResolvedValueOnce({
      id: 't1',
      papers: [
        { studentName: '张三' },
        { studentName: null },
        { studentName: '李四' },
      ],
    })
    const r = await callOk<{ success: boolean }>(IPC.IPC_GRADING_PUBLISH, 't1')
    expect(r.success).toBe(true)
    expect(mocks.invalidateOnExamsWrite).toHaveBeenCalledTimes(1)
    expect(mocks.invalidateOnGradesWrite).toHaveBeenCalledWith(['张三', '李四'])
  })

  it('extractRubric: paths 空/超 8/含非字符串拒绝', async () => {
    await expectRejected(IPC.IPC_GRADING_EXTRACT_RUBRIC, [])
    await expectRejected(IPC.IPC_GRADING_EXTRACT_RUBRIC, Array.from({ length: 9 }, () => 'x'))
    await expectRejected(IPC.IPC_GRADING_EXTRACT_RUBRIC, ['ok', ''])
    const r = await callOk<{ success: boolean }>(IPC.IPC_GRADING_EXTRACT_RUBRIC, ['a.jpg'])
    expect(r.success).toBe(true)
    expect(mocks.extractRubricFromSamples).toHaveBeenCalledWith(['a.jpg'])
  })

  it('silentPrint: 非法 order/duplexMode 拒绝;合法时静默无边距打印', async () => {
    await expectRejected(IPC.IPC_GRADING_OVERLAY_SILENT_PRINT, 't1', { order: 'random' })
    await expectRejected(IPC.IPC_GRADING_OVERLAY_SILENT_PRINT, 't1', { duplexMode: 'both' })
    const r = await callOk<{ success: boolean; data: { ok: boolean } }>(
      IPC.IPC_GRADING_OVERLAY_SILENT_PRINT,
      't1',
      { duplexMode: 'longEdge' },
    )
    expect(r.success).toBe(true)
    expect(r.data.ok).toBe(true)
    const printOpts = mocks.win.webContents.print.mock.calls[0]?.[0] as Record<string, unknown>
    expect(printOpts.silent).toBe(true)
    expect(printOpts.margins).toEqual({ marginType: 'none' })
    expect(printOpts.duplexMode).toBe('longEdge')
  })

  it('exportSummaryCsv: filePath 校验拒绝;合法时写盘并返回字节数', async () => {
    await expectRejected(IPC.IPC_GRADING_EXPORT_SUMMARY_CSV, 't1', '')
    await expectRejected(IPC.IPC_GRADING_EXPORT_SUMMARY_CSV, 't1', 3)
    const r = await callOk<{ success: boolean; data: { bytes: number } }>(
      IPC.IPC_GRADING_EXPORT_SUMMARY_CSV,
      't1',
      'C:/out/summary.csv',
    )
    expect(r.success).toBe(true)
    expect(r.data.bytes).toBeGreaterThan(0)
    expect(mocks.writeFile).toHaveBeenCalledWith('C:/out/summary.csv', expect.any(String), 'utf-8')
  })
})

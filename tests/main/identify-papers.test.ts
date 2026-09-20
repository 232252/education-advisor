// =============================================================
// Identify Papers 测试 — prompt 契约 + JSON 解析 + classifyPaperIdentity
// + readIdentity 轻量模式(fake model 计数) + 多页归组闭环/计数守恒/中止
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GradingPaper, GradingTask, GradingTaskStatus } from '@shared/types'

const mocks = vi.hoisted(() => {
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  const filesDir = `${tmpBase}/identify-papers-files-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  // 结构兼容 GradingTask 的最小内存任务(仅供 mock 服务读写)
  const state: {
    task: null | {
      id: string
      status: string
      papers: Array<{
        id: string
        studentName: string | null
        status: string
        files: Array<{ name: string; storedName: string; mime: string; bytes: number }>
        identity?: unknown
        ai?: unknown
      }>
    }
  } = { task: null }
  const responses: Array<{ name: string; number: string }> = []
  const appendCalls: Array<[string, string]> = []
  const completeSimple = vi.fn(async (
    _model: unknown,
    _req: unknown,
    opts?: { signal?: AbortSignal },
  ) => {
    if (opts?.signal?.aborted) return { stopReason: 'aborted', content: [] }
    const next = responses.shift() ?? { name: '', number: '' }
    return { stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify(next) }] }
  })
  const log = vi.fn()
  const gradingService = {
    getTask: async (id: string) => {
      if (!state.task || state.task.id !== id) throw new Error(`批改任务不存在: ${id}`)
      return state.task
    },
    paperFilePath: (_id: string, storedName: string) => `${filesDir}/${storedName}`,
    savePaperIdentity: async (
      _t: string,
      paperId: string,
      rec: { name: string; number: string; candidates: string[]; readAt: string },
    ) => {
      const p = state.task?.papers.find((x) => x.id === paperId)
      if (p) p.identity = rec
    },
    assignPaper: async (_t: string, paperId: string, name: string | null) => {
      const p = state.task?.papers.find((x) => x.id === paperId)
      if (!p) throw new Error(`试卷不存在: ${paperId}`)
      p.studentName = name && name.trim().length > 0 ? name.trim() : null
      if (p.studentName === null) p.status = 'unassigned'
      else if (p.status === 'unassigned') p.status = 'pending'
    },
    appendPaperPages: async (_t: string, anchorId: string, sourceId: string) => {
      const task = state.task
      if (!task) throw new Error('批改任务不存在')
      const anchor = task.papers.find((x) => x.id === anchorId)
      const source = task.papers.find((x) => x.id === sourceId)
      if (!anchor || !source) throw new Error('试卷不存在')
      appendCalls.push([anchorId, sourceId])
      anchor.files.push(...source.files)
      const idx = task.papers.findIndex((x) => x.id === sourceId)
      task.papers.splice(idx, 1)
    },
  }
  return {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return `${tmpBase}/identify-papers-test-${Date.now()}`
      throw new Error(`Unexpected path: ${name}`)
    }),
    filesDir,
    state,
    responses,
    appendCalls,
    completeSimple,
    log,
    gradingService,
  }
})

vi.mock('electron', () => ({ app: { getPath: mocks.getPath } }))
vi.mock('@earendil-works/pi-ai/compat', () => ({ completeSimple: mocks.completeSimple }))
vi.mock('../../src/main/utils/logger', () => ({ log: mocks.log }))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: () => ({}) },
}))
vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: { getApiKey: () => undefined },
}))
vi.mock('../../src/main/services/profile-service', () => ({
  profileService: { get: async () => ({}) },
}))
vi.mock('../../src/main/services/pi-ai/model-utils', () => ({
  resolveModel: () => ({ id: 'fake-vision', maxTokens: 4096 }),
}))
vi.mock('../../src/main/services/grading/grading-pipeline', () => ({
  resolveGradingModelIds: () => ({ providerId: 'p', modelId: 'm' }),
  isVisionModel: () => true,
  apiKeyFor: () => 'test-key',
}))
vi.mock('../../src/main/services/grading/grading-service', () => ({
  gradingService: mocks.gradingService,
}))

import {
  buildIdentifyPrompt,
  classifyPaperIdentity,
  identifyUnassignedPapers,
  parseIdentifyResponse,
  parsePageKey,
  readIdentity,
  shouldMergeContinuation,
} from '../../src/main/services/grading/identify-papers'
import type { resolveModel } from '../../src/main/services/pi-ai/model-utils'

const TASK_ID = 'grading-t1'
const fakeModel = { id: 'fake-vision', maxTokens: 4096 } as unknown as NonNullable<
  ReturnType<typeof resolveModel>
>

function fileRec(storedName: string, mime = 'image/jpeg'): GradingPaper['files'][number] {
  return { name: storedName, storedName, mime, bytes: 2048 }
}

function makePaper(id: string, storedNames: string[]): GradingPaper {
  return {
    id,
    studentName: null,
    files: storedNames.map((n) => fileRec(n)),
    uploadedAt: '2026-09-20T00:00:00Z',
    status: 'unassigned',
  }
}

function setTask(papers: GradingPaper[], status: GradingTaskStatus = 'draft'): void {
  const task: GradingTask = {
    id: TASK_ID,
    name: '识别测试',
    semester: 's',
    status,
    rubric: [],
    papers,
    createdAt: '2026-09-20T00:00:00Z',
    updatedAt: '2026-09-20T00:00:00Z',
  }
  mocks.state.task = {
    id: task.id,
    status: task.status,
    papers: task.papers.map((p) => ({
      id: p.id,
      studentName: p.studentName,
      status: p.status,
      files: p.files.map((f) => ({ ...f })),
      ...(p.ai ? { ai: p.ai } : {}),
    })),
  }
}

/** 画一张带姓名的可解码 JPEG(页眉区有字,crop 可读) */
async function writePageJpeg(storedName: string, label: string): Promise<void> {
  const canvas = createCanvas(160, 226)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 160, 226)
  ctx.fillStyle = '#000000'
  ctx.font = '14px sans-serif'
  ctx.fillText(label, 8, 24)
  await fsp.writeFile(path.join(mocks.filesDir, storedName), canvas.toBuffer('image/jpeg', 0.9))
}

function resetMocks(): void {
  mocks.completeSimple.mockClear()
  mocks.log.mockClear()
  mocks.responses.length = 0
  mocks.appendCalls.length = 0
  mocks.state.task = null
}

beforeAll(async () => {
  await fsp.mkdir(mocks.filesDir, { recursive: true })
})
afterAll(async () => {
  await fsp.rm(mocks.filesDir, { recursive: true, force: true })
})

describe('buildIdentifyPrompt', () => {
  it('要求只读页眉姓名栏并输出 JSON', () => {
    const p = buildIdentifyPrompt()
    expect(p).toContain('姓名栏')
    expect(p).toContain('"name"')
    expect(p).toContain('"number"')
    expect(p).toContain('不要猜')
    expect(p).toContain('考号经常不等于学号')
  })

  it('编号要求原样保留前导零(01 不写成 1)', () => {
    expect(buildIdentifyPrompt()).toContain('前导零')
  })
})

describe('parseIdentifyResponse', () => {
  it('标准 JSON 与数字编号', () => {
    expect(parseIdentifyResponse('{"name":"张三","number":"12"}')).toEqual({
      name: '张三',
      number: '12',
    })
    expect(parseIdentifyResponse('{"name":"李四","number":15}')).toEqual({
      name: '李四',
      number: '15',
    })
  })

  it('围栏与空字段', () => {
    expect(parseIdentifyResponse('```json\n{"name":"","number":""}\n```')).toEqual({
      name: '',
      number: '',
    })
    expect(parseIdentifyResponse('不是 json')).toEqual({ name: '', number: '' })
  })
})

describe('classifyPaperIdentity — 四分支互斥', () => {
  const identity = { name: '张三', number: '' }
  const hit = { suggested: '张三', candidates: ['张三'] }
  const miss = { suggested: null, candidates: [] }

  it('空身份 → unresolved(即便名单唯一命中)', () => {
    expect(classifyPaperIdentity({ name: '', number: '' }, hit, new Set(), null)).toBe('unresolved')
  })

  it('suggested===null(歧义/未命中) → unresolved', () => {
    expect(classifyPaperIdentity(identity, miss, new Set(), null)).toBe('unresolved')
  })

  it('唯一命中且未占用 → assign', () => {
    expect(classifyPaperIdentity(identity, hit, new Set(), null)).toBe('assign')
    expect(classifyPaperIdentity(identity, hit, new Set(['李四']), null)).toBe('assign')
  })

  it('唯一命中已占用,anchor 无 ai 且 status∈{unassigned,pending} → merge', () => {
    const taken = new Set(['张三'])
    expect(
      classifyPaperIdentity(identity, hit, taken, { hasAi: false, status: 'pending' }),
    ).toBe('merge')
    expect(
      classifyPaperIdentity(identity, hit, taken, { hasAi: false, status: 'unassigned' }),
    ).toBe('merge')
  })

  it('唯一命中已占用,anchor 有 ai(补录) → duplicates', () => {
    expect(
      classifyPaperIdentity(identity, hit, new Set(['张三']), { hasAi: true, status: 'graded' }),
    ).toBe('duplicates')
  })

  it('唯一命中已占用,anchor 无 ai 但状态不可并(failed) → duplicates;anchor 缺失 → duplicates', () => {
    const taken = new Set(['张三'])
    expect(
      classifyPaperIdentity(identity, hit, taken, { hasAi: false, status: 'failed' }),
    ).toBe('duplicates')
    expect(classifyPaperIdentity(identity, hit, taken, null)).toBe('duplicates')
  })
})

describe('readIdentity — 仅页眉小图轻量模式', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('可解码首页: 只调一次模型,content 恰一张图(页眉 crop,非整页)', async () => {
    await writePageJpeg('ok-1.jpg', '张三 01')
    mocks.responses.push({ name: '张三', number: '01' })
    const identity = await readIdentity(TASK_ID, [fileRec('ok-1.jpg')], fakeModel, 'k', 'p')
    expect(identity).toEqual({ name: '张三', number: '01' })
    expect(mocks.completeSimple).toHaveBeenCalledTimes(1)
    const content = mocks.completeSimple.mock.calls[0][1].messages[0]
      .content as Array<{ type: string; data?: string }>
    const images = content.filter((p) => p.type === 'image')
    expect(images).toHaveLength(1)
    // 发出去的是页眉 crop,不是整页原图
    const fullPage = await fsp.readFile(path.join(mocks.filesDir, 'ok-1.jpg'))
    expect(images[0].data).not.toBe(fullPage.toString('base64'))
  })

  it('页眉 crop 解码失败 → 仍只调一次模型,content 图片列表为空,结果空身份', async () => {
    await fsp.writeFile(path.join(mocks.filesDir, 'bad-1.jpg'), Buffer.from('not-an-image'))
    mocks.responses.push({ name: '', number: '' })
    const identity = await readIdentity(TASK_ID, [fileRec('bad-1.jpg')], fakeModel, 'k', 'p')
    expect(identity).toEqual({ name: '', number: '' })
    expect(mocks.completeSimple).toHaveBeenCalledTimes(1)
    const content = mocks.completeSimple.mock.calls[0][1].messages[0]
      .content as Array<{ type: string; data?: string }>
    expect(content.filter((p) => p.type === 'image')).toHaveLength(0)
    // 不读整页、不翻次页: 第二个文件不存在,若被读取会抛错
    const identity2 = await readIdentity(
      TASK_ID,
      [fileRec('bad-1.jpg'), fileRec('missing-2.jpg')],
      fakeModel,
      'k',
      'p',
    )
    expect(identity2).toEqual({ name: '', number: '' })
    expect(mocks.completeSimple).toHaveBeenCalledTimes(2)
  })

  it('files 为空 → 直接返回空身份,不调模型', async () => {
    const identity = await readIdentity(TASK_ID, [], fakeModel, 'k', 'p')
    expect(identity).toEqual({ name: '', number: '' })
    expect(mocks.completeSimple).toHaveBeenCalledTimes(0)
  })
})

describe('identifyUnassignedPapers — 单学生多页归组闭环', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('3 页同姓名: 第 1 页 assign,续页按导入顺序 merge 进同一 anchor', async () => {
    await writePageJpeg('m-1.jpg', '张三')
    await writePageJpeg('m-2.jpg', '张三')
    await writePageJpeg('m-3.jpg', '张三')
    setTask([makePaper('paper-1', ['m-1.jpg']), makePaper('paper-2', ['m-2.jpg']), makePaper('paper-3', ['m-3.jpg'])])
    mocks.responses.push(
      { name: '张三', number: '' },
      { name: '张三', number: '' },
      { name: '张三', number: '' },
    )
    const result = await identifyUnassignedPapers(TASK_ID, [
      { name: '张三' },
      { name: '李四' },
    ])
    expect(result).toMatchObject({ assigned: 1, merged: 2, unresolved: 0, duplicates: [] })
    // 计数守恒: 1+2+0+0 === 3
    expect(result.assigned + result.merged + result.unresolved + result.duplicates.length).toBe(3)
    // 合并按导入顺序: p2→p1, p3→p1
    expect(mocks.appendCalls).toEqual([
      ['paper-1', 'paper-2'],
      ['paper-1', 'paper-3'],
    ])
    // 任务里只剩一份,文件按页序并齐
    const task = mocks.state.task
    expect(task?.papers).toHaveLength(1)
    expect(task?.papers[0].studentName).toBe('张三')
    expect(task?.papers[0].files.map((f) => f.storedName)).toEqual(['m-1.jpg', 'm-2.jpg', 'm-3.jpg'])
    // 无守恒告警
    expect(mocks.log.mock.calls.some((c) => c[0] === 'error')).toBe(false)
  })

  it('四类分配互斥全覆盖 + 计数守恒: N=5 → assign2+merge1+duplicates1+unresolved1', async () => {
    const stored = ['d-1.jpg', 'd-2.jpg', 'd-3.jpg', 'd-4.jpg', 'd-5.jpg']
    for (const [i, s] of stored.entries()) await writePageJpeg(s, `s${i}`)
    const anchorAi = { questions: [], totalScore: 0, model: { provider: 'p', model: 'm' }, finishedAt: '2026-09-20T00:00:00Z' }
    setTask([
      { ...makePaper('paper-0', ['d-0.jpg']), studentName: '钱八', status: 'graded', ai: anchorAi },
      ...['paper-1', 'paper-2', 'paper-3', 'paper-4', 'paper-5'].map((id, i) =>
        makePaper(id, [stored[i]]),
      ),
    ])
    mocks.responses.push(
      { name: '钱八', number: '' }, // 唯一命中但 anchor 已批改 → duplicates
      { name: '王五', number: '' }, // 唯一命中未占用 → assign
      { name: '李四', number: '' }, // 唯一命中未占用 → assign
      { name: '李四', number: '' }, // 唯一命中已占用,anchor pending 无 ai → merge
      { name: '', number: '' }, // 空身份 → unresolved
    )
    const result = await identifyUnassignedPapers(TASK_ID, [
      { name: '张三' },
      { name: '李四' },
      { name: '王五' },
      { name: '钱八' },
    ])
    expect(result.assigned).toBe(2)
    expect(result.merged).toBe(1)
    expect(result.duplicates).toEqual(['钱八'])
    expect(result.unresolved).toBe(1)
    // 计数守恒: 2+1+1+1 === 5
    expect(result.assigned + result.merged + result.unresolved + result.duplicates.length).toBe(5)
    // duplicates 的卷保持未归组(人工处理),不并入已批改 anchor
    const dup = mocks.state.task?.papers.find((p) => p.id === 'paper-1')
    expect(dup?.studentName).toBeNull()
    expect(mocks.appendCalls).toEqual([['paper-3', 'paper-4']])
    expect(mocks.log.mock.calls.some((c) => c[0] === 'error')).toBe(false)
  })

  it('歧义身份(两个候选) → unresolved,不 assign', async () => {
    await writePageJpeg('a-1.jpg', '张三')
    setTask([makePaper('paper-9', ['a-1.jpg'])])
    mocks.responses.push({ name: '张三', number: '' })
    const result = await identifyUnassignedPapers(TASK_ID, [
      { name: '张三' },
      { name: '张三丰' },
    ])
    expect(result).toMatchObject({ assigned: 0, merged: 0, unresolved: 1, duplicates: [] })
    expect(mocks.state.task?.papers[0].studentName).toBeNull()
    expect(mocks.state.task?.papers[0].identity).toMatchObject({ candidates: ['张三', '张三丰'] })
  })

  it('中止(signal.aborted)后不跑守恒核验 —— 不产生 error 日志', async () => {
    await writePageJpeg('x-1.jpg', '张三')
    await writePageJpeg('x-2.jpg', '张三')
    await writePageJpeg('x-3.jpg', '张三')
    setTask([
      makePaper('paper-a', ['x-1.jpg']),
      makePaper('paper-b', ['x-2.jpg']),
      makePaper('paper-c', ['x-3.jpg']),
    ])
    const controller = new AbortController()
    // 第 1 份开始处理时中止: 循环 break,计数必然不守恒,但不得误报 error
    const onProgress = () => controller.abort()
    const result = await identifyUnassignedPapers(TASK_ID, [{ name: '张三' }], {
      signal: controller.signal,
      onProgress,
    })
    expect(mocks.completeSimple.mock.calls.length).toBeLessThan(3)
    expect(mocks.log.mock.calls.some((c) => c[0] === 'error')).toBe(false)
    expect(result).toMatchObject({ assigned: 0, merged: 0 })
  })

  it('名单为空 / 任务已发布 → 拒绝', async () => {
    await expect(identifyUnassignedPapers(TASK_ID, [])).rejects.toThrow('学生名单为空')
    setTask([makePaper('paper-z', ['z-1.jpg'])], 'published')
    await expect(identifyUnassignedPapers(TASK_ID, [{ name: '张三' }])).rejects.toThrow(
      '不可识别归属',
    )
  })
})

// ===== 续页兜底(姓名只写在首页的多页卷) =====

describe('parsePageKey — 同源页号解析', () => {
  it('拆页命名 `${base}-p${N}[.ext]` → { base, page }', () => {
    expect(parsePageKey('9ban1-p3.jpg')).toEqual({ base: '9ban1', page: 3 })
    expect(parsePageKey('专题一-p12')).toEqual({ base: '专题一', page: 12 })
    expect(parsePageKey('quiz-p01.png')).toEqual({ base: 'quiz', page: 1 })
  })

  it('非拆页命名 → null(不参与续页兜底)', () => {
    expect(parsePageKey('m-1.jpg')).toBeNull()
    expect(parsePageKey('scan.jpg')).toBeNull()
    expect(parsePageKey('a-p1x.jpg')).toBeNull()
    expect(parsePageKey('')).toBeNull()
  })
})

describe('shouldMergeContinuation — 纯函数口径', () => {
  const emptyId = { name: '', number: '' }
  const anchor = { id: 'paper-1', lastPage: 2 }

  it('空身份 + 前页同源归属 + anchor 末页恰为前页 → 并', () => {
    expect(
      shouldMergeContinuation({ identity: emptyId, prevOwner: '张三', prevPage: 2, anchor }),
    ).toBe(true)
  })

  it('身份记录缺失(识别失败未留痕) → 不并: 读失败 ≠ 卷面没写', () => {
    expect(
      shouldMergeContinuation({ identity: undefined, prevOwner: '张三', prevPage: 2, anchor }),
    ).toBe(false)
  })

  it('读出姓名或编号 → 不并(可能是名册外学生,留人工)', () => {
    expect(
      shouldMergeContinuation({
        identity: { name: '王二', number: '' },
        prevOwner: '张三',
        prevPage: 2,
        anchor,
      }),
    ).toBe(false)
    expect(
      shouldMergeContinuation({
        identity: { name: '', number: '07' },
        prevOwner: '张三',
        prevPage: 2,
        anchor,
      }),
    ).toBe(false)
  })

  it('前页无归属 / anchor 缺失 / 页链断档(anchor 末页≠前页) → 不并', () => {
    expect(
      shouldMergeContinuation({ identity: emptyId, prevOwner: undefined, prevPage: 2, anchor }),
    ).toBe(false)
    expect(
      shouldMergeContinuation({ identity: emptyId, prevOwner: '张三', prevPage: 2, anchor: undefined }),
    ).toBe(false)
    expect(
      shouldMergeContinuation({
        identity: emptyId,
        prevOwner: '张三',
        prevPage: 4,
        anchor: { id: 'paper-1', lastPage: 3 },
      }),
    ).toBe(false)
  })
})

describe('identifyUnassignedPapers — 续页兜底闭环', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('首页有姓名、续页空身份: 按连续页号链式并入同一学生(3 页)', async () => {
    await writePageJpeg('exam-p1.jpg', '张三')
    await writePageJpeg('exam-p2.jpg', '')
    await writePageJpeg('exam-p3.jpg', '')
    setTask([
      makePaper('paper-1', ['exam-p1.jpg']),
      makePaper('paper-2', ['exam-p2.jpg']),
      makePaper('paper-3', ['exam-p3.jpg']),
    ])
    mocks.responses.push(
      { name: '张三', number: '' },
      { name: '', number: '' },
      { name: '', number: '' },
    )
    const result = await identifyUnassignedPapers(TASK_ID, [{ name: '张三' }, { name: '李四' }])
    expect(result).toMatchObject({
      assigned: 1,
      merged: 2,
      continuationMerged: 2,
      unresolved: 0,
      duplicates: [],
    })
    // 计数守恒: 1+2+0+0 === 3
    expect(result.assigned + result.merged + result.unresolved + result.duplicates.length).toBe(3)
    // 链式并入: p2→p1, p3→p1(anchor 末页随并入推进)
    expect(mocks.appendCalls).toEqual([
      ['paper-1', 'paper-2'],
      ['paper-1', 'paper-3'],
    ])
    const task = mocks.state.task
    expect(task?.papers).toHaveLength(1)
    expect(task?.papers[0].studentName).toBe('张三')
    expect(task?.papers[0].files.map((f) => f.storedName)).toEqual([
      'exam-p1.jpg',
      'exam-p2.jpg',
      'exam-p3.jpg',
    ])
    expect(mocks.log.mock.calls.some((c) => c[0] === 'error')).toBe(false)
  })

  it('页链断档(p4 缺失)不跨并: p5 留人工', async () => {
    await writePageJpeg('gap-p1.jpg', '张三')
    await writePageJpeg('gap-p2.jpg', '')
    await writePageJpeg('gap-p5.jpg', '')
    setTask([
      makePaper('paper-1', ['gap-p1.jpg']),
      makePaper('paper-2', ['gap-p2.jpg']),
      makePaper('paper-5', ['gap-p5.jpg']),
    ])
    mocks.responses.push(
      { name: '张三', number: '' },
      { name: '', number: '' },
      { name: '', number: '' },
    )
    const result = await identifyUnassignedPapers(TASK_ID, [{ name: '张三' }])
    expect(result).toMatchObject({
      assigned: 1,
      merged: 1,
      continuationMerged: 1,
      unresolved: 1,
    })
    expect(mocks.appendCalls).toEqual([['paper-1', 'paper-2']])
    // p5 保持独立未归组
    const left = mocks.state.task?.papers.find((p) => p.id === 'paper-5')
    expect(left?.studentName).toBeNull()
    expect(mocks.log.mock.calls.some((c) => c[0] === 'error')).toBe(false)
  })

  it('续页读出名单外姓名 → 不自动并,留人工', async () => {
    await writePageJpeg('nm-p1.jpg', '张三')
    await writePageJpeg('nm-p2.jpg', '王二麻子')
    setTask([makePaper('paper-1', ['nm-p1.jpg']), makePaper('paper-2', ['nm-p2.jpg'])])
    mocks.responses.push(
      { name: '张三', number: '' },
      { name: '王二麻子', number: '' },
    )
    const result = await identifyUnassignedPapers(TASK_ID, [{ name: '张三' }, { name: '李四' }])
    expect(result).toMatchObject({
      assigned: 1,
      merged: 0,
      continuationMerged: 0,
      unresolved: 1,
    })
    expect(mocks.appendCalls).toEqual([])
  })

  it('不同来源同页号互不干扰: A 卷 p2 不并入 B 卷 p1', async () => {
    await writePageJpeg('A-p1.jpg', '张三')
    await writePageJpeg('B-p1.jpg', '李四')
    await writePageJpeg('B-p2.jpg', '')
    setTask([
      makePaper('paper-a1', ['A-p1.jpg']),
      makePaper('paper-b1', ['B-p1.jpg']),
      makePaper('paper-b2', ['B-p2.jpg']),
    ])
    mocks.responses.push(
      { name: '张三', number: '' },
      { name: '李四', number: '' },
      { name: '', number: '' },
    )
    const result = await identifyUnassignedPapers(TASK_ID, [{ name: '张三' }, { name: '李四' }])
    expect(result).toMatchObject({ assigned: 2, merged: 1, continuationMerged: 1, unresolved: 0 })
    expect(mocks.appendCalls).toEqual([['paper-b1', 'paper-b2']])
  })
})

describe('readIdentity — 页眉裁剪格式路由', () => {
  beforeEach(() => {
    resetMocks()
  })

  it('webp/bmp 首页同样走页眉裁剪(解码按内容,mime 只做路由)', async () => {
    // 写 PNG 内容但按 image/webp 申报: 路由放行后 loadImage 按内容解码成功
    const canvas = createCanvas(160, 226)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 160, 226)
    ctx.fillStyle = '#000000'
    ctx.font = '14px sans-serif'
    ctx.fillText('张三', 8, 24)
    await fsp.writeFile(path.join(mocks.filesDir, 'ok-w.webp'), canvas.toBuffer('image/png'))
    mocks.responses.push({ name: '张三', number: '' })
    const identity = await readIdentity(
      TASK_ID,
      [fileRec('ok-w.webp', 'image/webp')],
      fakeModel,
      'k',
      'p',
    )
    expect(identity).toEqual({ name: '张三', number: '' })
    const content = mocks.completeSimple.mock.calls[0][1].messages[0]
      .content as Array<{ type: string }>
    // webp 放行前这里会是 0 张图(只发文字)
    expect(content.filter((p) => p.type === 'image')).toHaveLength(1)
  })
})

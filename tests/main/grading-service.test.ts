// =============================================================
// Grading Service 测试
// 覆盖: createTask/updateTask(量规校验)/importPapers(拷贝+白名单+上限)/
//       assignPaper/removePaper/saveAiResult(越界)/saveReview/setStatus(状态机)/deleteTask
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GradingPaper } from '@shared/types'
import fsp from 'node:fs/promises'
import path from 'node:path'

const mocks = vi.hoisted(() => {
  // 注意: hoisted 块内不能用顶层 import(hoist 时机早于 import 初始化),
  // 路径用字符串拼接(口径同 academic-service.test.ts)
  const sep = process.platform === 'win32' ? '\\' : '/'
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  const tmpDir = `${tmpBase}${sep}grading-svc-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    userDataDir: tmpDir,
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return tmpDir
      throw new Error(`Unexpected path: ${name}`)
    }),
  }
})

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
}))

import { gradingService } from '../../src/main/services/grading/grading-service'
import { academicService } from '../../src/main/services/academic-service'

const baseDir = path.join(mocks.userDataDir, 'grading')

/** 造一个临时图片文件 */
async function makeImage(name: string, bytes = 1024): Promise<string> {
  const p = path.join(mocks.userDataDir, name)
  await fsp.writeFile(p, Buffer.alloc(bytes, 1))
  return p
}

describe('gradingService — 任务与量规', () => {
  beforeAll(async () => {
    await fsp.mkdir(mocks.userDataDir, { recursive: true })
  })
  afterAll(async () => {
    try {
      await fsp.rm(mocks.userDataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('createTask: 最小入参 → 草稿态落盘', async () => {
    const task = await gradingService.createTask({ name: ' 数学周测 ', semester: '2026-秋' })
    expect(task.status).toBe('draft')
    expect(task.name).toBe('数学周测')
    expect(task.rubric).toEqual([])
    const loaded = await gradingService.getTask(task.id)
    expect(loaded.id).toBe(task.id)
  })

  it('createTask: 缺名/缺学期拒绝', async () => {
    await expect(gradingService.createTask({ name: '', semester: 's' })).rejects.toThrow('任务名')
    await expect(gradingService.createTask({ name: 'x', semester: '' })).rejects.toThrow('学期')
  })

  it('createTask/updateTask: 批改口径 gradingMode 落盘; 非法值拒绝', async () => {
    const task = await gradingService.createTask({
      name: '口径卷',
      semester: 's',
      gradingMode: 'strict',
    })
    expect(task.gradingMode).toBe('strict')
    expect((await gradingService.getTask(task.id)).gradingMode).toBe('strict')

    await gradingService.updateTask(task.id, { gradingMode: 'lenient' })
    expect((await gradingService.getTask(task.id)).gradingMode).toBe('lenient')

    await gradingService.updateTask(task.id, { gradingMode: 'normal' })
    expect((await gradingService.getTask(task.id)).gradingMode).toBe('normal')

    await expect(
      gradingService.createTask({ name: 'x', semester: 's', gradingMode: 'lazy' }),
    ).rejects.toThrow('批改口径')
    await expect(gradingService.updateTask(task.id, { gradingMode: 'easy' })).rejects.toThrow(
      '批改口径',
    )
  })

  it('updateTask: 量规重复 id / 非正满分拒绝; 合法量规通过', async () => {
    const task = await gradingService.createTask({ name: 't', semester: 's' })
    await expect(
      gradingService.updateTask(task.id, {
        rubric: [
          { id: 'q-1', title: '一', fullMark: 5, order: 1 },
          { id: 'q-1', title: '二', fullMark: 5, order: 2 },
        ],
      }),
    ).rejects.toThrow('重复')
    await expect(
      gradingService.updateTask(task.id, { rubric: [{ id: 'q-1', title: '一', fullMark: 0, order: 1 }] }),
    ).rejects.toThrow('fullMark')
    const updated = await gradingService.updateTask(task.id, {
      rubric: [
        { id: 'q-1', title: '选择题', fullMark: 30, referenceAnswer: '1-5 BACDA', order: 1 },
        { id: 'q-2', title: '解答题', fullMark: 20, order: 2 },
      ],
    })
    expect(updated.rubric).toHaveLength(2)
    await expect(
      gradingService.updateTask(task.id, {
        rubric: [{ id: 'q-1', title: '一', fullMark: 10, order: 1, presetMarks: [{ points: -1, note: '' }] }],
      }),
    ).rejects.toThrow('note')
  })

  it('updateTask: review 态量规锁定', async () => {
    const task = await gradingService.createTask({ name: 't2', semester: 's' })
    await gradingService.setStatus(task.id, 'ready')
    await gradingService.setStatus(task.id, 'grading')
    await gradingService.setStatus(task.id, 'review')
    await expect(
      gradingService.updateTask(task.id, { rubric: [{ id: 'q-1', title: 'x', fullMark: 1, order: 1 }] }),
    ).rejects.toThrow('锁定')
  })
})

describe('gradingService — 试卷导入/归组/结果', () => {
  let taskId: string

  beforeAll(async () => {
    await fsp.mkdir(mocks.userDataDir, { recursive: true })
    const task = await gradingService.createTask({
      name: '批改任务',
      semester: 's',
      rubric: [
        { id: 'q-1', title: '选择题', fullMark: 30, order: 1 },
        { id: 'q-2', title: '解答题', fullMark: 20, order: 2 },
      ],
    })
    taskId = task.id
  })

  it('importPapers: 拷贝文件并建 paper 记录', async () => {
    const img1 = await makeImage('张三-1.jpg')
    const img2 = await makeImage('张三-2.jpg')
    const task = await gradingService.importPapers(taskId, [
      { files: [{ path: img1, name: '张三-1.jpg' }, { path: img2 }] },
      { files: [{ path: await makeImage('李四.png') }] },
    ])
    expect(task.papers).toHaveLength(2)
    expect(task.papers[0].files).toHaveLength(2)
    expect(task.papers[0].status).toBe('unassigned')
    // 文件真实落盘
    const stored = await fsp.readdir(path.join(baseDir, 'files', taskId))
    expect(stored).toHaveLength(3)
  })

  it('importPapers: 非白名单扩展名/损坏 PDF/超限拒绝', async () => {
    const pdf = path.join(mocks.userDataDir, 'a.pdf')
    await fsp.writeFile(pdf, 'x')
    await expect(gradingService.importPapers(taskId, [{ files: [{ path: pdf }] }])).rejects.toThrow(
      '不是有效的 PDF',
    )
    const txt = path.join(mocks.userDataDir, 'a.txt')
    await fsp.writeFile(txt, 'x')
    await expect(gradingService.importPapers(taskId, [{ files: [{ path: txt }] }])).rejects.toThrow(
      '不支持的文件类型',
    )
    await expect(gradingService.importPapers(taskId, [])).rejects.toThrow('批次')
  })

  it('assignPaper: 指派 → pending; 取消 → unassigned', async () => {
    const task = await gradingService.getTask(taskId)
    const paperId = task.papers[0].id
    const assigned = await gradingService.assignPaper(taskId, paperId, '张三')
    expect(assigned.papers[0].studentName).toBe('张三')
    expect(assigned.papers[0].status).toBe('pending')
    const cleared = await gradingService.assignPaper(taskId, paperId, null)
    expect(cleared.papers[0].studentName).toBeNull()
    expect(cleared.papers[0].status).toBe('unassigned')
    await gradingService.assignPaper(taskId, paperId, '张三')
  })

  it('saveAiResult: 合法落库; 未知题目/越界拒绝', async () => {
    const task = await gradingService.getTask(taskId)
    const paperId = task.papers[0].id
    await expect(
      gradingService.saveAiResult(taskId, paperId, {
        questions: [{ questionId: 'q-999', score: 1 }],
        totalScore: 1,
        model: { provider: 'p', model: 'm' },
        finishedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('未知题目')
    await expect(
      gradingService.saveAiResult(taskId, paperId, {
        questions: [{ questionId: 'q-1', score: 99 }],
        totalScore: 99,
        model: { provider: 'p', model: 'm' },
        finishedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('越界')
    const ok = await gradingService.saveAiResult(taskId, paperId, {
      questions: [
        { questionId: 'q-1', score: 28, evidence: '错第 4 题' },
        { questionId: 'q-2', score: 15, comment: '步骤分' },
      ],
      totalScore: 43,
      model: { provider: 'p', model: 'm' },
      finishedAt: new Date().toISOString(),
    })
    expect(ok.papers[0].status).toBe('graded')
    expect(ok.papers[0].ai?.totalScore).toBe(43)
  })

  it('saveReview: 覆盖生效; 未批试卷拒绝复核', async () => {
    const task = await gradingService.getTask(taskId)
    await gradingService.setStatus(taskId, 'ready')
    await gradingService.setStatus(taskId, 'grading')
    await gradingService.setStatus(taskId, 'review')
    const graded = task.papers[0]
    const reviewed = await gradingService.saveReview(taskId, graded.id, {
      questions: { 'q-1': { score: 30 } },
      overallComment: '第 4 题判对了',
    })
    expect(reviewed.papers[0].review?.questions['q-1']?.score).toBe(30)
    // 第二份未批 → 拒绝
    await expect(
      gradingService.saveReview(taskId, task.papers[1].id, { questions: {} }),
    ).rejects.toThrow('尚无 AI 结果')
  })

  it('resetPaperForRegrade: 清 AI 结果/复核回 pending; grading 态拒绝', async () => {
    const task = await gradingService.getTask(taskId)
    const graded = task.papers[0]
    expect(graded.status).toBe('graded')
    const reset = await gradingService.resetPaperForRegrade(taskId, graded.id)
    const paper = reset.papers[0]
    expect(paper.status).toBe('pending')
    expect(paper.ai).toBeUndefined()
    expect(paper.review).toBeUndefined()
    expect(paper.error).toBeUndefined()
    // 归属与文件保留,可重新落 AI 结果(重改闭环)
    expect(paper.studentName).toBe('张三')
    expect(paper.files).toHaveLength(2)
    const again = await gradingService.saveAiResult(taskId, graded.id, {
      questions: [
        { questionId: 'q-1', score: 30 },
        { questionId: 'q-2', score: 18 },
      ],
      totalScore: 48,
      model: { provider: 'p', model: 'm' },
      finishedAt: new Date().toISOString(),
    })
    expect(again.papers[0].status).toBe('graded')
    expect(again.papers[0].ai?.totalScore).toBe(48)
    // grading 进行中拒绝重改
    await gradingService.setStatus(taskId, 'grading')
    await expect(gradingService.resetPaperForRegrade(taskId, graded.id)).rejects.toThrow('批改中')
    await gradingService.setStatus(taskId, 'review')
  })

  it('applyPaperSnapshot: 重改失败回滚旧结果并标 failed; 非法状态拒绝', async () => {
    // 上一用例的重置已清复核,先补存一份,让"回滚恢复复核"可断言
    const before = await gradingService.getTask(taskId)
    await gradingService.saveReview(taskId, before.papers[0].id, {
      questions: { 'q-1': { score: 25 } },
    })
    const task = await gradingService.getTask(taskId)
    const paper = task.papers[0]
    const snapshot = {
      ai: paper.ai,
      review: paper.review,
      status: paper.status as GradingPaper['status'],
    }
    // 模拟重改: 重置(review 态) → 进 grading → 新一轮失败 → 回滚旧结果 + 新错误信息
    await gradingService.resetPaperForRegrade(taskId, paper.id)
    await gradingService.setStatus(taskId, 'grading')
    const rolled = await gradingService.applyPaperSnapshot(taskId, paper.id, {
      ...snapshot,
      error: '批改输出不是有效 JSON',
      status: 'failed',
    })
    expect(rolled.papers[0].status).toBe('failed')
    expect(rolled.papers[0].error).toBe('批改输出不是有效 JSON')
    // 旧 AI 结果/复核回来了(重改失败不再丢分)
    expect(rolled.papers[0].ai?.totalScore).toBe(48)
    expect(rolled.papers[0].review?.questions).toBeDefined()
    // 非法状态拒绝
    await expect(
      gradingService.applyPaperSnapshot(taskId, paper.id, { ...snapshot, status: 'oops' as never }),
    ).rejects.toThrow('非法试卷状态')
    await gradingService.setStatus(taskId, 'review')
    // review 态也允许回滚(中止路径兜底)
    const inReview = await gradingService.applyPaperSnapshot(taskId, paper.id, {
      ...snapshot,
      status: 'graded',
    })
    expect(inReview.papers[0].status).toBe('graded')
    // draft 态拒绝
    const draftTask = await gradingService.createTask({ name: 't-snap', semester: 's' })
    const img = await makeImage('snap.jpg', 8)
    const imported = await gradingService.importPapers(draftTask.id, [{ files: [{ path: img }] }])
    await expect(
      gradingService.applyPaperSnapshot(draftTask.id, imported.papers[0].id, {
        status: 'graded',
      }),
    ).rejects.toThrow('不可回滚')
    await gradingService.deleteTask(draftTask.id)
  })

  it('removePaper: 连带文件删除', async () => {
    const task = await gradingService.getTask(taskId)
    const victim = task.papers[1]
    await gradingService.removePaper(taskId, victim.id)
    const after = await gradingService.getTask(taskId)
    expect(after.papers.find((p) => p.id === victim.id)).toBeUndefined()
    const stored = await fsp.readdir(path.join(baseDir, 'files', taskId))
    expect(stored.some((f) => f.startsWith(victim.id))).toBe(false)
  })
})

describe('gradingService — 状态机与删除', () => {
  it('非法迁移拒绝(草稿不能直接发布/复核)', async () => {
    const task = await gradingService.createTask({ name: 't', semester: 's' })
    await expect(gradingService.setStatus(task.id, 'published')).rejects.toThrow('非法状态迁移')
    await expect(gradingService.setStatus(task.id, 'review')).rejects.toThrow('非法状态迁移')
    // 同态幂等(重复点同一状态不报错)
    const same = await gradingService.setStatus(task.id, 'draft')
    expect(same.status).toBe('draft')
  })

  it('published → review/grading 允许(改错回流/重改), deleteTask 清理文件目录', async () => {
    const task = await gradingService.createTask({ name: 't', semester: 's' })
    const img = await makeImage('x.jpg', 8)
    await gradingService.importPapers(task.id, [{ files: [{ path: img }] }])
    await gradingService.setStatus(task.id, 'ready')
    await gradingService.setStatus(task.id, 'grading')
    await gradingService.setStatus(task.id, 'review')
    await gradingService.setStatus(task.id, 'published')
    const back = await gradingService.setStatus(task.id, 'review')
    expect(back.status).toBe('review')
    // 重改: published 也允许直接进 grading 重跑
    await gradingService.setStatus(task.id, 'published')
    const regrade = await gradingService.setStatus(task.id, 'grading')
    expect(regrade.status).toBe('grading')
    await gradingService.setStatus(task.id, 'review')
    await gradingService.deleteTask(task.id)
    await expect(gradingService.getTask(task.id)).rejects.toThrow('不存在')
    expect(await fsp.readdir(path.join(baseDir, 'files', task.id)).catch(() => [])).toEqual([])
  })

  it('非法 id 拒绝(路径注入)', async () => {
    await expect(gradingService.getTask('../../etc/passwd')).rejects.toThrow('非法任务 id')
    await expect(gradingService.getTask('grading-../../x')).rejects.toThrow('非法任务 id')
  })
})

describe('gradingService — 批改模式与双评附加字段', () => {
  it('createTask/updateTask: gradingStrategy 落盘;非法值拒绝', async () => {
    const task = await gradingService.createTask({
      name: '双评测试',
      semester: '2026-秋',
      gradingStrategy: 'dual',
    })
    expect(task.gradingStrategy).toBe('dual')
    const updated = await gradingService.updateTask(task.id, { gradingStrategy: 'fast' })
    expect(updated.gradingStrategy).toBe('fast')
    await expect(
      gradingService.updateTask(task.id, { gradingStrategy: 'turbo' as never }),
    ).rejects.toThrow('非法批改模式')
    await expect(
      gradingService.createTask({ name: 'x', semester: 's', gradingStrategy: 'xx' as never }),
    ).rejects.toThrow('非法批改模式')
  })

  it('saveAiResult: 双评附加字段落库/清空;第二模型越界拒绝;重置清双评;快照回滚含双评', async () => {
    const task = await gradingService.createTask({
      name: '双评落库',
      semester: '2026-秋',
      gradingStrategy: 'dual',
      rubric: [
        { id: 'q-1', title: '一、单选题', fullMark: 30, order: 1 },
        { id: 'q-2', title: '三、计算题', fullMark: 18, order: 2 },
      ],
    })
    const img = await makeImage('dual-a.jpg')
    const afterImport = await gradingService.importPapers(task.id, [{ files: [{ path: img }] }])
    const paperId = afterImport.papers[0]?.id as string
    await gradingService.assignPaper(task.id, paperId, '张三')

    const ok = await gradingService.saveAiResult(
      task.id,
      paperId,
      {
        questions: [
          { questionId: 'q-1', score: 24 },
          { questionId: 'q-2', score: 18 },
        ],
        totalScore: 42,
        model: { provider: 'a', model: 'A' },
        finishedAt: '2026-01-01T00:00:00Z',
      },
      {
        aiSecondary: {
          questions: [
            { questionId: 'q-1', score: 24 },
            { questionId: 'q-2', score: 9 },
          ],
          totalScore: 33,
          model: { provider: 'b', model: 'B' },
          finishedAt: '2026-01-01T00:00:01Z',
        },
        disputedQuestions: ['q-2'],
      },
    )
    const paper = afterImport === null ? null : ok.papers.find((p) => p.id === paperId)
    expect(paper?.aiSecondary?.model.model).toBe('B')
    expect(paper?.disputedQuestions).toEqual(['q-2'])

    // 第二模型未知题/越界拒绝(先重置回 pending,绕开状态门卫直达校验)
    await gradingService.resetPaperForRegrade(task.id, paperId)
    await expect(
      gradingService.saveAiResult(
        task.id,
        paperId,
        {
          questions: [{ questionId: 'q-1', score: 1 }],
          totalScore: 1,
          model: { provider: 'a', model: 'A' },
          finishedAt: '2026-01-01T00:00:00Z',
        },
        {
          aiSecondary: {
            questions: [{ questionId: 'q-9', score: 1 }],
            totalScore: 1,
            model: { provider: 'b', model: 'B' },
            finishedAt: '2026-01-01T00:00:00Z',
          },
        },
      ),
    ).rejects.toThrow('未知题目')
    await expect(
      gradingService.saveAiResult(
        task.id,
        paperId,
        {
          questions: [{ questionId: 'q-1', score: 1 }],
          totalScore: 1,
          model: { provider: 'a', model: 'A' },
          finishedAt: '2026-01-01T00:00:00Z',
        },
        {
          aiSecondary: {
            questions: [{ questionId: 'q-1', score: 99 }],
            totalScore: 99,
            model: { provider: 'b', model: 'B' },
            finishedAt: '2026-01-01T00:00:00Z',
          },
        },
      ),
    ).rejects.toThrow('越界')

    // 重置清双评
    await gradingService.resetPaperForRegrade(task.id, paperId)
    const afterReset = await gradingService.getTask(task.id)
    const resetPaper = afterReset.papers.find((p) => p.id === paperId)
    expect(resetPaper?.ai).toBeUndefined()
    expect(resetPaper?.aiSecondary).toBeUndefined()
    expect(resetPaper?.disputedQuestions).toBeUndefined()

    // 快照回滚恢复双评字段(draft→ready→grading→review 合法链)
    await gradingService.setStatus(task.id, 'ready')
    await gradingService.setStatus(task.id, 'grading')
    await gradingService.setStatus(task.id, 'review')
    await gradingService.applyPaperSnapshot(task.id, paperId, {
      ai: {
        questions: [{ questionId: 'q-1', score: 24 }],
        totalScore: 24,
        model: { provider: 'a', model: 'A' },
        finishedAt: '2026-01-01T00:00:00Z',
      },
      aiSecondary: {
        questions: [{ questionId: 'q-1', score: 30 }],
        totalScore: 30,
        model: { provider: 'b', model: 'B' },
        finishedAt: '2026-01-01T00:00:00Z',
      },
      disputedQuestions: ['q-1'],
      status: 'graded',
    })
    const afterRoll = await gradingService.getTask(task.id)
    const rolled = afterRoll.papers.find((p) => p.id === paperId)
    expect(rolled?.aiSecondary?.totalScore).toBe(30)
    expect(rolled?.disputedQuestions).toEqual(['q-1'])
    await gradingService.deleteTask(task.id)
  })
})

describe('gradingService — 多页 PDF 拆份导入与 appendPaperPages 合并', () => {
  beforeAll(async () => {
    await fsp.mkdir(mocks.userDataDir, { recursive: true })
  })
  afterAll(async () => {
    try {
      await fsp.rm(mocks.userDataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  // ---- n 页文字 PDF 夹具(xref 偏移精确计算) ----

  function assemblePdf(objects: Buffer[]): Buffer {
    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')]
    const offsets: number[] = []
    let pos = parts[0].length
    for (const [idx, body] of objects.entries()) {
      offsets.push(pos)
      const head = Buffer.from(`${idx + 1} 0 obj\n`)
      const tail = Buffer.from('\nendobj\n')
      parts.push(head, body, tail)
      pos += head.length + body.length + tail.length
    }
    const xrefPos = pos
    const size = objects.length + 1
    const lines = [`xref\n0 ${size}\n0000000000 65535 f \n`]
    for (const off of offsets) lines.push(`${String(off).padStart(10, '0')} 00000 n \n`)
    lines.push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`)
    parts.push(Buffer.from(lines.join('')))
    return Buffer.concat(parts)
  }

  function streamObj(dict: string, content: Buffer): Buffer {
    const head = Buffer.from(`<< ${dict} /Length ${content.length} >>\nstream\n`)
    return Buffer.concat([head, content, Buffer.from('\nendstream')])
  }

  /** n 页电子排版 PDF: 1=Catalog 2=Pages,第 i 页 Page=(3+2i)/Contents=(4+2i),末尾 Font */
  function buildTextPdfPages(n: number): Buffer {
    const objects: Buffer[] = []
    const kids = Array.from({ length: n }, (_, i) => `${3 + 2 * i} 0 R`).join(' ')
    objects.push(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'))
    objects.push(Buffer.from(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`))
    for (let i = 0; i < n; i++) {
      const content = Buffer.from(`BT /F1 24 Tf 72 720 Td (Page ${i + 1}) Tj ET`, 'latin1')
      objects.push(
        Buffer.from(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${3 + 2 * n} 0 R >> >> /Contents ${4 + 2 * i} 0 R >>`,
        ),
      )
      objects.push(streamObj('', content))
    }
    objects.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'))
    return assemblePdf(objects)
  }

  it('importPapers: 3 页多学生 PDF → 3 份试卷各 1 页(每页一批)', async () => {
    const task = await gradingService.createTask({ name: '多学生PDF', semester: 's' })
    const pdfPath = path.join(mocks.userDataDir, 'bundle.pdf')
    await fsp.writeFile(pdfPath, buildTextPdfPages(3))
    const imported = await gradingService.importPapers(task.id, [{ files: [{ path: pdfPath }] }])
    expect(imported.papers).toHaveLength(3)
    expect(imported.papers.every((p) => p.files.length === 1)).toBe(true)
    expect(imported.papers.every((p) => p.studentName === null && p.status === 'unassigned')).toBe(
      true,
    )
    // 每份文件名带页号且按 PDF 页序(identify 归组依赖导入顺序 = 页序)
    expect(imported.papers.map((p) => p.files[0]?.name)).toEqual([
      'bundle-p1.jpg',
      'bundle-p2.jpg',
      'bundle-p3.jpg',
    ])
    await gradingService.deleteTask(task.id)
  })

  it('appendPaperPages: files 按导入顺序并入 anchor,source 移除,物理文件保留可读', async () => {
    const task = await gradingService.createTask({ name: '续页合并', semester: 's' })
    const a1 = await makeImage('merge-a1.jpg')
    const a2 = await makeImage('merge-a2.jpg')
    const b1 = await makeImage('merge-b1.jpg')
    const imported = await gradingService.importPapers(task.id, [
      { files: [{ path: a1, name: 'a1.jpg' }, { path: a2, name: 'a2.jpg' }] },
      { files: [{ path: b1, name: 'b1.jpg' }] },
    ])
    const anchor = imported.papers[0]
    const source = imported.papers[1]
    const merged = await gradingService.appendPaperPages(task.id, anchor.id, source.id)
    // source 记录消失,只剩 anchor 一份
    expect(merged.papers).toHaveLength(1)
    expect(merged.papers[0]?.id).toBe(anchor.id)
    // files 按导入顺序追加
    expect(merged.papers[0]?.files.map((f) => f.name)).toEqual(['a1.jpg', 'a2.jpg', 'b1.jpg'])
    // 物理文件不删不移: 全部(含 source 的)仍可按 storedName 读到
    for (const f of merged.papers[0]?.files ?? []) {
      const buf = await fsp.readFile(gradingService.paperFilePath(task.id, f.storedName))
      expect(buf.length).toBe(1024)
    }
    const stored = await fsp.readdir(path.join(baseDir, 'files', task.id))
    expect(stored).toHaveLength(3)
    await gradingService.deleteTask(task.id)
  })

  it('appendPaperPages: anchor/source 已批改拒绝;同 id 与未知 id 拒绝', async () => {
    const task = await gradingService.createTask({
      name: '合并拒绝',
      semester: 's',
      rubric: [{ id: 'q-1', title: '一', fullMark: 10, order: 1 }],
    })
    const imported = await gradingService.importPapers(task.id, [
      { files: [{ path: await makeImage('c1.jpg') }] },
      { files: [{ path: await makeImage('c2.jpg') }] },
      { files: [{ path: await makeImage('c3.jpg') }] },
    ])
    const p1 = imported.papers[0]
    const p2 = imported.papers[1]
    const p3 = imported.papers[2]
    await expect(gradingService.appendPaperPages(task.id, p1.id, p1.id)).rejects.toThrow('同一份')
    await expect(
      gradingService.appendPaperPages(task.id, p1.id, 'paper-nope'),
    ).rejects.toThrow('试卷不存在')
    // anchor 已批改(补录场景)→ 拒绝
    await gradingService.assignPaper(task.id, p1.id, '张三')
    await gradingService.saveAiResult(task.id, p1.id, {
      questions: [{ questionId: 'q-1', score: 5 }],
      totalScore: 5,
      model: { provider: 'p', model: 'm' },
      finishedAt: new Date().toISOString(),
    })
    await expect(gradingService.appendPaperPages(task.id, p1.id, p2.id)).rejects.toThrow(
      '不能自动合并续页',
    )
    // source 已批改 → 拒绝(干净的 p3 作 anchor、已批改的 p1 作 source)
    await expect(gradingService.appendPaperPages(task.id, p3.id, p1.id)).rejects.toThrow(
      '不能作为续页并入',
    )
    await gradingService.deleteTask(task.id)
  })
})

describe('gradingService — 主结果量规覆盖与发布重试', () => {
  beforeAll(async () => {
    await fsp.mkdir(mocks.userDataDir, { recursive: true })
  })
  afterAll(async () => {
    try {
      await fsp.rm(mocks.userDataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('saveAiResult: 主结果缺量规题目 → 拒绝并列出缺失题号', async () => {
    const task = await gradingService.createTask({
      name: '缺题拒绝',
      semester: 's',
      rubric: [
        { id: 'q-1', title: '选择题', fullMark: 30, order: 1 },
        { id: 'q-2', title: '解答题', fullMark: 20, order: 2 },
      ],
    })
    const imported = await gradingService.importPapers(task.id, [
      { files: [{ path: await makeImage('partial.jpg') }] },
    ])
    const paperId = imported.papers[0]?.id as string
    await gradingService.assignPaper(task.id, paperId, '赵六')
    await expect(
      gradingService.saveAiResult(task.id, paperId, {
        questions: [{ questionId: 'q-1', score: 5 }],
        totalScore: 5,
        model: { provider: 'p', model: 'm' },
        finishedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/q-2/)
    await gradingService.deleteTask(task.id)
  })

  it('publishTask: batchSetGrades 失败后重试发布复用已回填 examId,不重复建考试', async () => {
    const task = await gradingService.createTask({
      name: '发布失败重试',
      semester: 's',
      rubric: [
        { id: 'q-1', title: '选择题', fullMark: 30, order: 1 },
        { id: 'q-2', title: '解答题', fullMark: 20, order: 2 },
      ],
    })
    const imported = await gradingService.importPapers(task.id, [
      { files: [{ path: await makeImage('pub-retry.jpg') }] },
    ])
    const paperId = imported.papers[0]?.id as string
    await gradingService.assignPaper(task.id, paperId, '钱七')
    await gradingService.saveAiResult(task.id, paperId, {
      questions: [
        { questionId: 'q-1', score: 28 },
        { questionId: 'q-2', score: 15 },
      ],
      totalScore: 43,
      model: { provider: 'p', model: 'm' },
      finishedAt: new Date().toISOString(),
    })
    await gradingService.setStatus(task.id, 'ready')
    await gradingService.setStatus(task.id, 'grading')
    await gradingService.setStatus(task.id, 'review')

    const createExamSpy = vi
      .spyOn(academicService, 'createExam')
      .mockImplementation(async (input) => ({
        ...input,
        id: 'exam-retry-1',
        createdAt: '2026-09-20T00:00:00.000Z',
      }))
    const batchSpy = vi
      .spyOn(academicService, 'batchSetGrades')
      .mockRejectedValueOnce(new Error('成绩写盘失败'))
      .mockResolvedValue(3)

    // 第一次发布: 写成绩失败 → 抛错,但 examId 已先行落盘
    await expect(gradingService.publishTask(task.id)).rejects.toThrow('成绩写盘失败')
    const persisted = await gradingService.getTask(task.id)
    expect(persisted.publishedExamId).toBe('exam-retry-1')
    expect(persisted.status).toBe('review') // 终态未写

    // 恢复后重试: 走 examId 复用分支,createExam 只调用过一次
    const published = await gradingService.publishTask(task.id)
    expect(published.task.status).toBe('published')
    expect(published.published).toBe(3) // 两题 + 总分
    expect(createExamSpy).toHaveBeenCalledTimes(1)
    expect(batchSpy).toHaveBeenCalledTimes(2)

    createExamSpy.mockRestore()
    batchSpy.mockRestore()
    await gradingService.deleteTask(task.id)
  })
})

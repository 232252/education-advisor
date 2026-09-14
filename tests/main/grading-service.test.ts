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

// =============================================================
// Grading Service 测试
// 覆盖: createTask/updateTask(量规校验)/importPapers(拷贝+白名单+上限)/
//       assignPaper/removePaper/saveAiResult(越界)/saveReview/setStatus(状态机)/deleteTask
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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

  it('importPapers: 非白名单扩展名/超限拒绝', async () => {
    const pdf = path.join(mocks.userDataDir, 'a.pdf')
    await fsp.writeFile(pdf, 'x')
    await expect(gradingService.importPapers(taskId, [{ files: [{ path: pdf }] }])).rejects.toThrow(
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

  it('published → review 允许(改错回流), deleteTask 清理文件目录', async () => {
    const task = await gradingService.createTask({ name: 't', semester: 's' })
    const img = await makeImage('x.jpg', 8)
    await gradingService.importPapers(task.id, [{ files: [{ path: img }] }])
    await gradingService.setStatus(task.id, 'ready')
    await gradingService.setStatus(task.id, 'grading')
    await gradingService.setStatus(task.id, 'review')
    await gradingService.setStatus(task.id, 'published')
    const back = await gradingService.setStatus(task.id, 'review')
    expect(back.status).toBe('review')
    await gradingService.deleteTask(task.id)
    await expect(gradingService.getTask(task.id)).rejects.toThrow('不存在')
    expect(await fsp.readdir(path.join(baseDir, 'files', task.id)).catch(() => [])).toEqual([])
  })

  it('非法 id 拒绝(路径注入)', async () => {
    await expect(gradingService.getTask('../../etc/passwd')).rejects.toThrow('非法任务 id')
    await expect(gradingService.getTask('grading-../../x')).rejects.toThrow('非法任务 id')
  })
})

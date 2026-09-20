// =============================================================
// Grading from files — 对话一条龙编排测试
// 覆盖: 样卷直走 extractRubricFromSamples(不走 materialize 绕行)/
//       roster_paths 文件花名册(csv/xlsx)与 eaa 名单合并去重/
//       merged·duplicates 告警进 hint / 花名册为空提示 / 非法花名册拒绝
// 依赖(grading-service/identify/rubric-extract/pipeline/eaa-bridge)全部 mock。
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StudentCandidate } from '@shared/grading-helpers'
import type { GradingTask } from '@shared/types'
import * as XLSX from 'xlsx'

const mocks = vi.hoisted(() => {
  const task: GradingTask = {
    id: 'grading-bff-1',
    name: '对话批改',
    semester: '2026-2027-1',
    status: 'draft',
    rubric: [],
    papers: [
      {
        id: 'paper-bff-1',
        studentName: '张三',
        files: [{ name: 'a.jpg', storedName: 'a.jpg', mime: 'image/jpeg', bytes: 8 }],
        uploadedAt: '2026-09-20T00:00:00Z',
        status: 'pending',
      },
    ],
    createdAt: '2026-09-20T00:00:00Z',
    updatedAt: '2026-09-20T00:00:00Z',
  }
  return {
    task,
    execute: vi.fn(),
    createTask: vi.fn(async () => task),
    updateTask: vi.fn(async () => task),
    importPapers: vi.fn(async () => task),
    getTask: vi.fn(async () => task),
    setStatus: vi.fn(async () => ({ ...task, status: 'ready' })),
    identify: vi.fn(async () => ({ assigned: 0, unresolved: 0, merged: 0, duplicates: [] })),
    extract: vi.fn(async () => [{ title: '一、计算', fullMark: 10 }]),
    startGrading: vi.fn(async () => undefined),
  }
})

vi.mock('../../src/main/services/eaa-bridge', () => ({ eaaBridge: { execute: mocks.execute } }))
vi.mock('../../src/main/services/grading/grading-service', () => ({
  gradingService: {
    createTask: mocks.createTask,
    updateTask: mocks.updateTask,
    importPapers: mocks.importPapers,
    getTask: mocks.getTask,
    setStatus: mocks.setStatus,
  },
}))
vi.mock('../../src/main/services/grading/identify-papers', () => ({
  identifyUnassignedPapers: mocks.identify,
}))
vi.mock('../../src/main/services/grading/rubric-extract', () => ({
  extractRubricFromSamples: mocks.extract,
}))
vi.mock('../../src/main/services/grading/grading-pipeline', () => ({
  startGrading: mocks.startGrading,
}))

import { startGradingFromFiles } from '../../src/main/services/grading/batch-from-files'

function bridgeStudents(students: Array<{ name: string; aliases?: string[] }>): void {
  mocks.execute.mockResolvedValue({
    success: true,
    data: { students: students.map((s) => ({ ...s, class_id: '高一4班' })) },
  })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('startGradingFromFiles — 样卷直走 sample-ingest', () => {
  it('extractRubricFromSamples 收到原始 samplePaths(去掉 materialize+slice 绕行)', async () => {
    bridgeStudents([{ name: '张三' }])
    const result = await startGradingFromFiles({
      name: '数学周测',
      samplePaths: ['C:/tmp/原卷.pdf', 'C:/tmp/答案.jpg'],
      homeworkPaths: ['C:/tmp/作业.zip'],
    })
    expect(mocks.extract).toHaveBeenCalledTimes(1)
    expect(mocks.extract).toHaveBeenCalledWith(['C:/tmp/原卷.pdf', 'C:/tmp/答案.jpg'])
    expect(result.rubricQuestions).toBe(1)
    // 作业包按「一个路径一批」导入
    expect(mocks.importPapers).toHaveBeenCalledWith('grading-bff-1', [
      { files: [{ path: 'C:/tmp/作业.zip' }] },
    ])
  })
})

describe('startGradingFromFiles — roster_paths 文件花名册', () => {
  it('csv 花名册与 eaa 名单合并去重(文件在前,别名并集)', async () => {
    bridgeStudents([
      { name: '张三', aliases: ['2026001'] },
      { name: '李四' },
    ])
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ea-roster-'))
    const csvPath = path.join(dir, 'roster.csv')
    await fsp.writeFile(csvPath, '姓名,学号\n李四,8888\n王五,9999\n', 'utf8')
    const result = await startGradingFromFiles({
      name: '带名册',
      samplePaths: ['C:/tmp/原卷.jpg'],
      homeworkPaths: ['C:/tmp/作业.pdf'],
      rosterPaths: [csvPath],
    })
    const roster = mocks.identify.mock.calls[0][1] as StudentCandidate[]
    expect(roster.map((s) => s.name)).toEqual(['李四', '王五', '张三'])
    // 同名(李四)并别名;csv 学号与 eaa 别名各自保留
    expect(roster.find((s) => s.name === '李四')?.aliases).toEqual(['8888'])
    expect(roster.find((s) => s.name === '张三')?.aliases).toEqual(['2026001'])
    expect(result.merged).toBe(0)
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('xlsx 花名册走 SheetJS 解析', async () => {
    mocks.execute.mockResolvedValue({ success: false, data: undefined })
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ea-roster-'))
    const xlsxPath = path.join(dir, 'roster.xlsx')
    const ws = XLSX.utils.aoa_to_sheet([
      ['班级', '姓名', '学号'],
      ['高一4班', '赵六', '66'],
      ['高一4班', '孙七', '77'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    await fsp.writeFile(xlsxPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
    await startGradingFromFiles({
      name: 'xlsx 名册',
      samplePaths: ['C:/tmp/原卷.jpg'],
      homeworkPaths: ['C:/tmp/作业.pdf'],
      rosterPaths: [xlsxPath],
    })
    const roster = mocks.identify.mock.calls[0][1] as StudentCandidate[]
    expect(roster.map((s) => s.name)).toEqual(['赵六', '孙七'])
    expect(roster.find((s) => s.name === '赵六')?.aliases).toEqual(['66'])
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('不支持的花名册格式拒绝(compat 面 parseRosterFile 白名单)', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ea-roster-'))
    const badPath = path.join(dir, 'roster.docx')
    await fsp.writeFile(badPath, 'x')
    await expect(
      startGradingFromFiles({
        name: '坏名册',
        samplePaths: ['C:/tmp/原卷.jpg'],
        homeworkPaths: ['C:/tmp/作业.pdf'],
        rosterPaths: [badPath],
      }),
    ).rejects.toThrow('不支持的名册格式')
    expect(mocks.identify).not.toHaveBeenCalled()
    await fsp.rm(dir, { recursive: true, force: true })
  })
})

describe('startGradingFromFiles — hint 与 merged/duplicates 告警', () => {
  it('花名册为空: 不识别不开批,hint 提示先配名册', async () => {
    mocks.execute.mockResolvedValue({ success: true, data: { students: [] } })
    // 该用例下任务里没有任何已归组卷(pending=0 不应开批);Once 防止污染后续用例
    mocks.getTask.mockResolvedValueOnce({ ...mocks.task, papers: [] })
    const result = await startGradingFromFiles({
      name: '无名册',
      samplePaths: ['C:/tmp/原卷.jpg'],
      homeworkPaths: ['C:/tmp/作业.pdf'],
    })
    expect(mocks.identify).not.toHaveBeenCalled()
    expect(mocks.startGrading).not.toHaveBeenCalled()
    expect(result.gradingStarted).toBe(false)
    expect(result.hint).toContain('花名册为空')
    expect(result.hint).toContain('人工归组')
  })

  it('merged/duplicates 计数与告警文本进 result 与 hint', async () => {
    bridgeStudents([{ name: '张三' }])
    mocks.identify.mockResolvedValue({
      assigned: 1,
      unresolved: 0,
      merged: 2,
      duplicates: ['张三', '张三'],
    })
    const result = await startGradingFromFiles({
      name: '合并告警',
      samplePaths: ['C:/tmp/原卷.jpg'],
      homeworkPaths: ['C:/tmp/作业.pdf'],
    })
    expect(result.merged).toBe(2)
    expect(result.duplicates).toEqual(['张三', '张三'])
    expect(result.gradingStarted).toBe(true)
    expect(result.hint).toContain('自动合并 2 页续页')
    expect(result.hint).toContain('2 份疑似补录/重复卷(张三)')
    expect(mocks.startGrading).toHaveBeenCalledTimes(1)
  })
})

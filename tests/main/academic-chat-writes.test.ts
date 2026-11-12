// =============================================================
// 对话学业写入：改分、删考试（教师点击确认 / 取消不删）
// =============================================================

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'

const mocks = vi.hoisted(() => {
  const sep = process.platform === 'win32' ? '\\' : '/'
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  const tmpDir = `${tmpBase}${sep}academic-chat-write-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    userDataDir: tmpDir,
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return tmpDir
      throw new Error(`Unexpected path: ${name}`)
    }),
  }
})

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath, isPackaged: false },
}))

import { academicService } from '../../src/main/services/academic-service'
import { deleteExamTool, setGradeTool } from '../../src/main/services/eaa/tools/academic-write-tools'
import {
  resetTeacherConfirmForTests,
  resolveTeacherConfirm,
  setTeacherConfirmSender,
} from '../../src/main/services/teacher-confirm'

beforeAll(async () => {
  await fsp.mkdir(mocks.userDataDir, { recursive: true })
})

afterAll(async () => {
  resetTeacherConfirmForTests()
  await fsp.rm(mocks.userDataDir, { recursive: true, force: true })
})

afterEach(() => {
  resetTeacherConfirmForTests()
})

describe('eaa_set_grade / eaa_delete_exam', () => {
  it('按科目名改分，并在教师取消删考试时保留考试和分数', async () => {
    const exam = await academicService.createExam({
      name: '对话改分',
      type: 'quiz',
      date: '2026-11-01',
      semester: '2026-2027-1',
      subjects: ['math'],
    })
    const written = await setGradeTool.execute('g1', {
      exam_id: exam.id,
      student: '张三',
      subject: '数学',
      score: 92,
    })
    const text = written.content[0]?.type === 'text' ? written.content[0].text : ''
    expect(text).toContain('92')
    const grades = await academicService.getGrades('张三')
    expect(grades.find((g) => g.examId === exam.id)?.score).toBe(92)

    setTeacherConfirmSender((req) => {
      expect(req.kind).toBe('delete-exam')
      expect(req.detail).toContain(exam.name)
      resolveTeacherConfirm(req.id, false)
    })
    await expect(deleteExamTool.execute('d1', { exam_id: exam.id })).rejects.toThrow('未删除')
    expect((await academicService.listExams()).some((e) => e.id === exam.id)).toBe(true)
    expect((await academicService.getGrades('张三')).some((g) => g.examId === exam.id)).toBe(true)
  })

  it('教师确认后删除考试并级联成绩', async () => {
    const exam = await academicService.createExam({
      name: '对话删考试',
      type: 'quiz',
      date: '2026-11-02',
      semester: '2026-2027-1',
      subjects: ['math'],
    })
    await setGradeTool.execute('g2', {
      exam_id: exam.id,
      student: '李四',
      subject: 'math',
      score: 80,
    })
    setTeacherConfirmSender((req) => resolveTeacherConfirm(req.id, true))
    await deleteExamTool.execute('d2', { exam_id: exam.id })
    expect((await academicService.listExams()).some((e) => e.id === exam.id)).toBe(false)
    expect((await academicService.getGrades('李四')).some((g) => g.examId === exam.id)).toBe(false)
  })

  it('没有确认窗口时不删除', async () => {
    const exam = await academicService.createExam({
      name: '无窗口',
      type: 'quiz',
      date: '2026-11-03',
      semester: '2026-2027-1',
      subjects: ['math'],
    })
    await expect(deleteExamTool.execute('d3', { exam_id: exam.id })).rejects.toThrow(
      '教师确认窗口不可用',
    )
    expect((await academicService.listExams()).some((e) => e.id === exam.id)).toBe(true)
  })
})

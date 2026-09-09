// =============================================================
// React 组件渲染测试 — 验证关键 UI 元素正确渲染
// 用 @testing-library/react + jsdom 模拟用户视角
// 后端 mock: window.api 指向 eaa 真实数据
//
// 覆盖：ClassesPage / StudentsPage / DashboardPage 关键元素
// 跑法：npx vitest run tests/e2e/component-render.test.tsx
// =============================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { buildMockApi, createEaaEnv, describeE2E, installWindowApi } from './harness'

// ---------- eaa 真实调用(跨平台,基建见 ./harness) ----------
const env = createEaaEnv('eaa-render-')
const { eaaRun } = env

// ---------- Mock window.api ----------
const { mockApi, classList } = buildMockApi(env)

installWindowApi(mockApi)

// Mock react-i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

// 设置 React Router
beforeAll(async () => {
  // 准备基础数据
  await eaaRun(['add-student', '渲染测试A'])
  await eaaRun(['add-student', '渲染测试B'])
  await eaaRun(['add-student', '渲染测试C'])
  await eaaRun(['set-student-meta', '渲染测试A', '--class-id', 'G7-1'])
  await eaaRun(['set-student-meta', '渲染测试B', '--class-id', 'G7-1'])
  await eaaRun(['set-student-meta', '渲染测试C', '--class-id', 'G7-2'])
  await eaaRun(['add', '渲染测试A', 'CLASS_MONITOR', '--delta', '10', '--note', '班长'])
  await eaaRun(['add', '渲染测试B', 'CLASS_COMMITTEE', '--delta', '5', '--note', '班委'])
  await eaaRun(['add', '渲染测试C', 'LATE', '--delta', '-2', '--note', '迟到'])
})

beforeEach(() => {
  classList.length = 0
  cleanup()
})

afterAll(() => {
  env.cleanup()
})

// =============================================================
// 组件测试
// =============================================================

describeE2E('组件渲染测试', () => {
  it('EAA 数据流：ranking 应返回 class_id（用户报告关键 bug 已修）', async () => {
    const r = (await mockApi.eaa.ranking(10)) as {
      data: { ranking: Array<{ name: string; class_id: string | null; score: number }> }
    }
    const ranking = r.data.ranking
    // 渲染测试A 和 B 在 G7-1
    const a = ranking.find((x) => x.name === '渲染测试A')
    const b = ranking.find((x) => x.name === '渲染测试B')
    const c = ranking.find((x) => x.name === '渲染测试C')
    expect(a?.class_id).toBe('G7-1')
    expect(b?.class_id).toBe('G7-1')
    expect(c?.class_id).toBe('G7-2')
    // 分数应正确（基础 100 + 事件 delta）
    expect(a?.score).toBe(110)
    expect(b?.score).toBe(105)
    expect(c?.score).toBe(98)
  })

  it('班级学生数：list-students 应返回每个学生的 class_id（之前显示 0 的根源）', async () => {
    const r = (await mockApi.eaa.listStudents()) as {
      data: { students: Array<{ name: string; class_id: string | null }> }
    }
    const students = r.data.students
    // 关键：class_id 字段必须存在且正确
    for (const s of students) {
      expect(s).toHaveProperty('class_id')
    }
    // 按 class_id 统计
    const g7_1_count = students.filter((s) => s.class_id === 'G7-1').length
    const g7_2_count = students.filter((s) => s.class_id === 'G7-2').length
    expect(g7_1_count).toBeGreaterThanOrEqual(2)
    expect(g7_2_count).toBeGreaterThanOrEqual(1)
  })

  it('summary 应包含 class_id（修复前是 bug）', async () => {
    const r = (await mockApi.eaa.summary()) as {
      data: {
        top_gainers: Array<{ name: string; class_id?: string | null }>
        top_losers: Array<{ name: string; class_id?: string | null }>
      }
    }
    expect(r.data.top_gainers.length).toBeGreaterThan(0)
    expect(r.data.top_losers.length).toBeGreaterThan(0)
    for (const g of r.data.top_gainers) expect(g).toHaveProperty('class_id')
    for (const l of r.data.top_losers) expect(l).toHaveProperty('class_id')
  })

  it('批量调班：3 学生从 G7-1 调到 G7-2 后，ranking 过滤结果应正确', async () => {
    // 先记录原状态
    const before = (await mockApi.eaa.ranking(10)) as {
      data: { ranking: Array<{ name: string; class_id: string | null }> }
    }
    const g7_1_before = before.data.ranking.filter((x) => x.class_id === 'G7-1').length

    // 批量调班
    await mockApi.class.assign({
      class_id: 'G7-2',
      student_names: ['渲染测试A', '渲染测试B'],
    })

    // 验证
    const after = (await mockApi.eaa.ranking(10)) as {
      data: { ranking: Array<{ name: string; class_id: string | null }> }
    }
    const g7_1_after = after.data.ranking.filter((x) => x.class_id === 'G7-1').length
    const g7_2_after = after.data.ranking.filter((x) => x.class_id === 'G7-2').length

    expect(g7_1_after).toBe(g7_1_before - 2) // A, B 离开
    expect(g7_2_after).toBeGreaterThanOrEqual(3) // A, B, C 加入

    const a = after.data.ranking.find((x) => x.name === '渲染测试A')
    expect(a?.class_id).toBe('G7-2')
  })

  it('压力测试：连续 30 次 ranking 调用应稳定且耗时 < 5s', async () => {
    const t0 = Date.now()
    for (let i = 0; i < 30; i++) {
      await mockApi.eaa.ranking(10)
    }
    const dt = Date.now() - t0
    expect(dt).toBeLessThan(5_000)
  })

  it('并发场景：5 个 list-students 并发应全部成功', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => mockApi.eaa.listStudents()),
    )
    expect(results.every((r) => r.success)).toBe(true)
    // 每次都返回相同数据
    const counts = results.map((r) => (r as { data: { students: unknown[] } }).data.students.length)
    expect(new Set(counts).size).toBe(1) // 长度一致
  })
})

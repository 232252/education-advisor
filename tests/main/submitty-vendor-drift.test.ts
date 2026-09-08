// =============================================================
// tests/main/submitty-vendor-drift.test.ts
//
// Submitty vendor 参照面的双重防护：
// 1. 完整性 — vendor/submitty 的文件与 UPSTREAM.json pin（tag/commit/sha256）一致，
//    防止参照面被静默篡改或半更新。
// 2. 漂移检测 — 上游 schema dump 中必须存在原生批改域模型
//    （src/main/services/grading/）所映射的表/列。上游重命名/删除即红，
//    提示先跑 npm run update:vendor:submitty 再按 diff 更新映射。
// =============================================================

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const VENDOR_DIR = join(ROOT, 'vendor', 'submitty')

/** 原生批改域模型依赖的上游表 → 必需列（映射蓝本，删改需同步 grading 模块） */
const COURSE_TABLE_DEPS: Record<string, string[]> = {
  // 量规三层：题目组件 → 预设评分点 marks → 每题给分
  gradeable: ['g_id', 'g_title', 'g_gradeable_type', 'g_grade_released_date', 'g_syllabus_bucket'],
  gradeable_component: [
    'gc_id',
    'g_id',
    'gc_title',
    'gc_lower_clamp',
    'gc_default',
    'gc_max_value',
    'gc_upper_clamp',
    'gc_is_text',
    'gc_order',
  ],
  gradeable_component_mark: ['gcm_id', 'gc_id', 'gcm_points', 'gcm_note', 'gcm_order', 'gcm_publish'],
  gradeable_component_mark_data: ['gc_id', 'gd_id', 'gcd_grader_id', 'gcm_id'],
  gradeable_component_data: ['gc_id', 'gd_id', 'gcd_score', 'gcd_grader_id', 'gcd_grade_time'],
  gradeable_data: ['gd_id', 'g_id', 'gd_user_id', 'gd_team_id'],
  // 提交与版本（我们的"一份试卷" ≈ 一次提交）
  electronic_gradeable: ['g_id', 'eg_submission_due_date', 'eg_late_days', 'eg_precision'],
  electronic_gradeable_data: [
    'g_id',
    'user_id',
    'g_version',
    'submission_time',
    'autograding_non_hidden_non_extra_credit',
    'autograding_complete',
  ],
  electronic_gradeable_version: ['g_id', 'user_id', 'active_version'],
  // 自动批改逐项得分（≈ AI 逐题给分 + 依据）
  autograding_testcase: ['g_id', 'testcase_id', 'points_possible', 'hidden', 'extra_credit'],
  autograding_testcase_data: ['user_id', 'g_version', 'points_earned'],
  // 教师复核覆盖
  grade_override: ['user_id', 'g_id', 'marks', 'comment'],
  // 迟交体系
  late_days: ['user_id', 'allowed_late_days', 'since_timestamp'],
  late_day_exceptions: ['user_id', 'g_id', 'late_day_exceptions'],
  // 课程库内同步的学生名单（归组匹配用）
  users: [
    'user_id',
    'user_givenname',
    'user_preferred_givenname',
    'user_familyname',
    'user_preferred_familyname',
    'user_group',
    'registration_section',
  ],
}

const MASTER_TABLE_DEPS: Record<string, string[]> = {
  terms: ['term_id', 'name', 'start_date', 'end_date'],
  courses: ['term', 'course', 'status'],
  courses_users: ['term', 'course', 'user_id', 'user_group', 'registration_type'],
  users: [
    'user_id',
    'user_givenname',
    'user_preferred_givenname',
    'user_familyname',
    'user_preferred_familyname',
  ],
}

/** 从 pg_dump 风格 SQL 提取 表名 → 列名集合 */
function extractColumns(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>()
  const tableRe = /CREATE TABLE public\.(\w+) \(([\s\S]*?)\n\);/g
  for (const match of sql.matchAll(tableRe)) {
    const [, table, body] = match
    const columns = new Set<string>()
    for (const line of body.split('\n')) {
      // 列行 = 4 空格缩进 + 小写标识符；跳过 CONSTRAINT/表级约束行
      const col = line.match(/^\s{4}([a-z_][a-z0-9_]*)\s/)
      if (col && !/^\s{4}(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b/i.test(line)) {
        columns.add(col[1])
      }
    }
    tables.set(table, columns)
  }
  return tables
}

function loadDump(file: 'course_tables.sql' | 'submitty_db.sql'): Map<string, Set<string>> {
  const path = join(VENDOR_DIR, 'sql', file)
  if (!existsSync(path)) {
    throw new Error(`缺少 ${path} — 先跑 npm run update:vendor:submitty`)
  }
  return extractColumns(readFileSync(path, 'utf-8'))
}

describe('submitty vendor 完整性', () => {
  it('UPSTREAM.json pin 有效（tag/commit/文件哈希一致）', () => {
    const upstreamPath = join(VENDOR_DIR, 'UPSTREAM.json')
    expect(existsSync(upstreamPath), 'UPSTREAM.json 不存在').toBe(true)
    const upstream = JSON.parse(readFileSync(upstreamPath, 'utf-8')) as {
      repo?: string
      tag?: string
      commit?: string
      files?: Array<{ path: string; sha256: string }>
    }
    expect(upstream.repo, 'repo 指向 Submitty').toContain('Submitty')
    expect(upstream.tag, 'tag 为 vYY.MM.NN 格式').toMatch(/^v\d+\.\d+\.\d+$/)
    expect(upstream.commit, 'commit 为 40 位 sha').toMatch(/^[0-9a-f]{40}$/)
    expect(upstream.files?.length, '至少 pin 两个 sql + LICENSE').toBeGreaterThanOrEqual(3)
    for (const f of upstream.files ?? []) {
      const file = join(VENDOR_DIR, f.path)
      expect(existsSync(file), `${f.path} 缺失`).toBe(true)
      const actual = createHash('sha256').update(readFileSync(file)).digest('hex')
      expect(actual, `${f.path} sha256 与 pin 不符（参照面被改动或半更新）`).toBe(f.sha256)
    }
  })
})

describe('submitty vendor 漂移检测（原生批改模型的映射蓝本）', () => {
  const cases: Array<[string, Record<string, string[]>]> = [
    ['course_tables.sql', COURSE_TABLE_DEPS],
    ['submitty_db.sql', MASTER_TABLE_DEPS],
  ]

  for (const [file, deps] of cases) {
    it(`${file} 含全部依赖表与列`, () => {
      const tables = loadDump(file as 'course_tables.sql' | 'submitty_db.sql')
      const problems: string[] = []
      for (const [table, requiredColumns] of Object.entries(deps)) {
        const columns = tables.get(table)
        if (!columns) {
          problems.push(`表 ${table} 不存在`)
          continue
        }
        for (const col of requiredColumns) {
          if (!columns.has(col)) problems.push(`${table}.${col} 不存在`)
        }
      }
      expect(
        problems,
        `上游 schema 与原生批改域模型的映射出现漂移：\n  ${problems.join('\n  ')}\n` +
          '请先跑 npm run update:vendor:submitty 对照 diff，更新 src/main/services/grading/ 的映射后再提交。',
      ).toEqual([])
    })
  }
})

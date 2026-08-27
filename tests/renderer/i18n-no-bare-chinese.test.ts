// =============================================================
// R2-13 防回归扫描 — JSX UI 层禁止裸中文文案
//
// 语义(关键):
//  - 只扫 pages/ components/ layouts/ 的 .tsx UI 层(测试、stores、
//    lib 领域数据/工具、hooks 归各自关注点,不在此列)
//  - t('key', '中文兜底') 的设计模式放行(fallback 中文是特性,不是违规)
//  - 注释行剥离后不参与判定
//  - 白名单仅允许「数据即文案」的情形(域名术语表/打印文档/欢迎页),
//    并写清理由 —— 新增白名单条目必须带注释
// =============================================================

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RENDERER_ROOT = path.resolve(__dirname, '../..', 'src', 'renderer')
const UI_DIRS = ['pages', 'components', 'layouts']

/** 白名单:文件相对路径 → 理由(新增必须注明) */
const ALLOWLIST: Record<string, string> = {
  'pages/Welcome/WelcomePage.tsx': '整页为宣传视频介绍,计划整页重做双语(R3),先行豁免',
  'components/print/PrintOverlay.tsx': '打印界面向教师输出,保持单语中文打印体验(产品决策)',
  'components/onboarding/steps/WelcomeStep.tsx': 'onboarding 步骤文案与页面标题联动,R3 与 Welcome 页一并处理',
}

/** R2-13 长尾白名单(行级,必须注明理由;只允许「数据即文案」行,UI 文案必须接线) */
const ALLOWLIST_LINE: Record<string, Record<number, string>> = {
  'pages/Classes/ClassesPage.tsx': {
    99: '动态生成班级名数据(如 "3班")',
  },
  'pages/Dashboard/components/ClassComparisonPanel.tsx': {
    82: 'EAARiskLevel 数据键值(极高/高/中/低 来自后端枚举)',
    85: 'EAARiskLevel 数据键值',
    88: 'EAARiskLevel 数据键值',
    91: 'EAARiskLevel 数据键值',
  },
}

const CJK = /[\u4e00-\u9fff]/

/** 剥离块注释 /* *&#47;(多行注释按行内状态剥离) */
function stripBlockComments(lines: string[]): string[] {
  let inBlock = false
  return lines.map((line) => {
    let s = line
    if (inBlock) {
      const end = s.indexOf('*/')
      if (end === -1) return ''
      s = s.slice(end + 2)
      inBlock = false
    }
    // 可能行内出现多个 /* */ 对
    let m = s.indexOf('/*')
    while (m !== -1) {
      const close = s.indexOf('*/', m + 2)
      if (close === -1) {
        s = s.slice(0, m)
        inBlock = true
        break
      }
      s = s.slice(0, m) + s.slice(close + 2)
      m = s.indexOf('/*')
    }
    return s
  })
}

/** 剥离行注释(忽略模板字符串内 // 的极端情形,够用) */
function stripLineComment(line: string): string {
  return line.replace(/\/\/.*$/, '')
}

/** 剥离 t('key', 'fallback') / {t(...)} 整体(含中文 fallback) */
function stripTInvocations(line: string): string {
  // t('key', '中文兜底') 或 t('key') 或 t(`…`)
  let out = line
  out = out.replace(/t\(\s*'[^']*'(?:\s*,\s*'[^']*')?\s*\)/g, 'T')
  out = out.replace(/t\(\s*`[^`]*`(?:\s*,\s*'[^']*')?\s*\)/g, 'T')
  out = out.replace(/t\(\s*'[^']*'\s*,\s*`[^`]*`\s*\)/g, 'T')
  return out
}

function collectHits(): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = []
  for (const dir of UI_DIRS) {
    const base = path.join(RENDERER_ROOT, dir)
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) {
          if (e.name === '__tests__') continue
          walk(p)
        } else if (e.name.endsWith('.tsx')) {
          const rel = path.relative(RENDERER_ROOT, p).replace(/\\/g, '/')
          if (ALLOWLIST[rel]) continue
          const lineAllow: Record<number, string> = ALLOWLIST_LINE[rel] ?? {}
          const lines = fs.readFileSync(p, 'utf-8').split('\n')
          const stripped = stripBlockComments(lines)
          stripped.forEach((noBlock, i) => {
            const noComment = stripLineComment(noBlock)
            const noT = stripTInvocations(noComment)
            if (CJK.test(noT) && !lineAllow[i + 1]) {
              hits.push({ file: rel, line: i + 1, text: lines[i]!.trim().slice(0, 120) })
            }
          })
        }
      }
    }
    walk(base)
  }
  return hits
}

import { mkdirSync, writeFileSync } from 'node:fs'

/** 基线快照: R2-13 审计名单接线完成后的剩余长尾(≈297 处/85 文件)。
 *  语义: 对比基线 — 新增的裸中文行才失败(长尾逐步清零,基线随之重生成)。 */
const BASELINE_FILE = path.join(__dirname, '__fixtures__', 'bare-chinese-baseline.json')

function loadBaseline(): Array<{ file: string; line: number }> {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8')) as Array<{ file: string; line: number }>
  } catch {
    return []
  }
}

describe('R2-13 JSX 裸中文防回归(R2-13)', () => {
  it('仅新增裸中文即失败;基线内长尾允许(待逐步清零)', () => {
    const hits = collectHits()
    // REPORT=1 时重生成基线(清理一批后运行一次)
    if (process.env.R2_I18N_REPORT === '1') {
      mkdirSync(path.dirname(BASELINE_FILE), { recursive: true })
      writeFileSync(BASELINE_FILE, JSON.stringify(hits.map(({ file, line }) => ({ file, line })).sort(), null, 2))
      return
    }
    const baseline = new Set(loadBaseline().map((b) => `${b.file}:${b.line}`))
    const fresh = hits.filter((h) => !baseline.has(`${h.file}:${h.line}`))
    if (fresh.length > 0) {
      const shown = fresh.slice(0, 40).map((h) => `${h.file}:${h.line}  ${h.text}`).join('\n')
      expect.fail(
        `新增 ${fresh.length} 处裸中文(UI 文案应走 t('key','fallback')):\n${shown}\n` +
          `确属「数据即文案」的加 ALLOWLIST_LINE,其余请接线 t();清理完毕用 R2_I18N_REPORT=1 重生成基线。`,
      )
    }
    expect(true).toBe(true)
  })
})

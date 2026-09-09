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
  'components/print/ParentReportDocument.tsx': '家长报告打印文档,与 PrintOverlay 同一单语打印体验(产品决策)',
  'components/onboarding/steps/WelcomeStep.tsx': 'onboarding 步骤文案与页面标题联动,R3 与 Welcome 页一并处理',
}

/** R2-13 长尾白名单(行级,必须注明理由;只允许「数据即文案」行,UI 文案必须接线) */
const ALLOWLIST_LINE: Record<string, Record<number, string>> = {
  'pages/Classes/ClassesPage.tsx': {
    99: '动态生成班级名数据(如 "3班")',
  },
  'pages/Dashboard/components/ClassComparisonPanel.tsx': {
    93: 'EAARiskLevel 数据键值(极高/高/中/低 来自后端枚举,属性访问非文案)',
    96: 'EAARiskLevel 数据键值',
    99: 'EAARiskLevel 数据键值',
    102: 'EAARiskLevel 数据键值',
    169: 'EAARiskLevel 数据键值',
    173: 'EAARiskLevel 数据键值',
    177: 'EAARiskLevel 数据键值',
    181: 'EAARiskLevel 数据键值',
  },
  'pages/Dashboard/components/ScoreDistChartCard.tsx': {
    29: '分数段 label 与后端枚举比对选色(数据匹配非 UI 文案)',
    31: '分数段 label 比对',
    32: '分数段 label 比对',
    33: '分数段 label 比对',
  },
  'pages/Dashboard/components/RiskDistChartCard.tsx': {
    22: '风险等级枚举名比对选色(数据匹配)',
    33: 'echarts tooltip 模板串,{c} 人 为数值单位',
  },
  'pages/Dashboard/components/ReasonDistCard.tsx': {
    57: '原因码标签表查值失败时的兜底展示(数据即文案)',
  },
  'pages/Models/components/RecommendedModelCard.tsx': {
    46: 'm.tier 后端枚举值比对(GPU/大内存 等)',
    48: 'm.tier 后端枚举值比对',
    57: 'm.chineseLevel 后端枚举值比对(优秀)',
  },
  'components/onboarding/OnboardingWizardBody.tsx': {
    39: '表单默认值=示例数据(七年级),随向导写入业务数据',
    40: '表单默认值=示例数据(1班)',
  },
  'components/onboarding/steps/ClassStep.tsx': {
    12: '年级预设数据项,直接写入业务数据',
    14: '班级名预设数据项(1班~20班)',
  },
  'pages/Students/tabs/AIAnalysisTab.tsx': {
    49: '解析 AI 输出的分节标题(数据匹配)',
    50: '解析 AI 输出的分节标题',
    51: '解析 AI 输出的分节标题',
    52: '解析 AI 输出的分节标题',
    109: '对自身 toast 消息文本做成功/失败分流(数据流 hack)',
  },
  'pages/Students/tabs/ProfileTab.tsx': {
    86: '对自身 toast 消息文本做成功/失败分流(数据流 hack)',
  },
  'pages/Students/tabs/EventsTab.tsx': {
    150: '撤销事件写入 EAA 的审计备注(业务数据非 UI 文案)',
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

/**
 * 剥离 t('key','fallback') / tr('key',{…},'fallback') 调用整体(含中文 fallback)。
 * 跨行多行调用同样剥离: 逐行正则识别不了换行拆开的实参,会把已接线文案误报成
 * 裸中文。匹配段替换为等长空白(保留换行位置),行号不漂移。
 * \b 词边界: 避免 start(/expect( 等"以 t 结尾标识符+(" 的误匹配。
 * 覆盖变体: tf 别名(模块级 t 重命名导入)/尾逗号(prettier 多行实参)/
 * 三元 fallback( t('k', cond ? 'a' : 'b') )/双引号实参(内嵌单引号的文案)。
 */
const STR = String.raw`(?:'[^']*'|"[^"]*"|` + '`[^`]*`)'
function stripTInvocations(lines: string[]): string[] {
  const blankKeepNewlines = (m: string) => m.replace(/[^\n]/g, ' ')
  let text = lines.join('\n')
  // tr('key', { 0: '…' }, '中文兜底') — 带插值参数的变体,同为正规接线(尾逗号同容错)
  text = text.replace(
    new RegExp(`\\btr\\(\\s*${STR}\\s*,\\s*\\{[^}]*\\}\\s*,\\s*${STR}\\s*,?\\s*\\)`, 'gs'),
    blankKeepNewlines,
  )
  // t('key') / t('key','兜底') / t(cond ? 'k1' : 'k2', cond ? 'a' : 'b')
  // key 与兜底均允许「简单条件表达式 ? 串 : 串」(如 NewTaskForm 编辑/新建双态标题;
  // 条件限标识符/取反/空白,不含括号引号,防跨结构吞行)
  // tf = 模块级 t 的重命名导入(ModelRow formatCost 等非 hook 作用域)
  const ternary = `[\\w.\\s!]+\\?\\s*${STR}\\s*:\\s*${STR}`
  text = text.replace(
    new RegExp(
      `\\btf?\\(\\s*(?:${STR}|${ternary})\\s*(?:,\\s*(?:${STR}|${ternary})\\s*)?,?\\s*\\)`,
      'gs',
    ),
    blankKeepNewlines,
  )
  return text.split('\n')
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
        } else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) {
          const rel = path.relative(RENDERER_ROOT, p).replace(/\\/g, '/')
          if (ALLOWLIST[rel]) continue
          const lineAllow: Record<number, string> = ALLOWLIST_LINE[rel] ?? {}
          const lines = fs.readFileSync(p, 'utf-8').split('\n')
          const stripped = stripBlockComments(lines)
          const noT = stripTInvocations(stripped)
          stripped.forEach((noBlock, i) => {
            const noComment = stripLineComment(noT[i] ?? '')
            if (CJK.test(noComment) && !lineAllow[i + 1]) {
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

function loadBaseline(): Array<{ file: string; line: number; text: string }> {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8')) as Array<{ file: string; line: number; text: string }>
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
      writeFileSync(BASELINE_FILE, JSON.stringify(hits.map((h) => ({ file: h.file, line: h.line, text: h.text })).sort(), null, 2))
      return
    }
    // 内容匹配:同一文件同一行文本视为基线(行号随编辑漂移不算新增)
    const baseline = new Set(loadBaseline().map((b) => `${b.file}\u0000${b.text}`))
    const fresh = hits.filter((h) => !baseline.has(`${h.file}\u0000${h.text}`))
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

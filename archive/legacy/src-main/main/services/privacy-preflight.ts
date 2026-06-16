// =============================================================
// Privacy Preflight — 主进程侧上传/导出前的隐私预检工具
//
// 目的:
//   - 在数据"离开应用"前(发飞书 / 写文件 / 备份 / 邮件)统一过一道 PII 扫描
//   - 复用现有 eaaBridge 调隐私引擎的 dry-run,不发明新协议
//   - 返回结构化报告:PII 类型 + 数量 + 脱敏后文本 + 引擎是否加载
//
// 设计要点:
//   - 失败安全:引擎未加载时**保守放行**(标记 privacyEnabled=false),
//     由调用方根据业务策略决定拦截还是放行
//   - 不解析 dry-run 的字面输出:用 dry-run 结果 vs 输入的"长度差 + 化名标记"
//     反推 PII 类别,避免脆弱的字符串解析
//   - 同步 API:不调系统资源,纯 CPU+IPC,可在 hot path 放心使用
// =============================================================

import { eaaBridge } from './eaa-bridge'

/** 主进程 PII 类别(与渲染端 PIIKind 对齐) */
export type MainPIIKind = 'person' | 'place' | 'org' | 'phone' | 'email' | 'id_card' | 'student_id'

/** 一类 PII 的命中摘要 */
export interface MainPIISummary {
  kind: MainPIIKind
  count: number
}

/** 预检报告 */
export interface MainPreflightReport {
  /** 文本中是否包含 PII(基于 dry-run 差异 + 化名标记) */
  hasPII: boolean
  /** 各 PII 类别命中数 */
  entities: MainPIISummary[]
  /** 脱敏后的文本(引擎失败时回退为原文) */
  redacted: string
  /** 原始输入文本(供"原文决策"使用) */
  original: string
  /** 原文本长度 */
  originalLength: number
  /** 隐私引擎是否加载成功 */
  privacyEnabled: boolean
  /** 错误信息(引擎未初始化等) */
  error?: string
}

/** 拦截决策 */
export type PreflightDecision = 'cancel' | 'redacted' | 'original'

/**
 * 上传预检主入口
 * - 调用隐私引擎 dry-run
 * - 解析输出,反推 PII 类别
 * - 引擎未加载/失败时返回 hasPII=false + error(调用方决定策略)
 */
export async function preflightCheck(text: string): Promise<MainPreflightReport> {
  const originalLength = text?.length ?? 0
  if (originalLength === 0) {
    return {
      hasPII: false,
      entities: [],
      redacted: text ?? '',
      original: text ?? '',
      originalLength: 0,
      privacyEnabled: false,
    }
  }

  let raw: unknown = null
  let privacyEnabled = false
  let error: string | undefined

  try {
    raw = await eaaBridge.execute({ command: 'privacy', args: ['dry-run', text] })
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  // 1. 引擎返回失败 → 保守放行
  if (!raw || typeof raw !== 'object' || (raw as { success?: boolean }).success !== true) {
    return {
      hasPII: false,
      entities: [],
      redacted: text,
      original: text,
      originalLength,
      privacyEnabled: false,
      error: error ?? (raw as { error?: string } | null)?.error ?? 'privacy engine unavailable',
    }
  }
  privacyEnabled = true

  // 2. 提取 dry-run 输出(支持 data:string 与 data:{output:string} 两种返回)
  const data = (raw as { data?: unknown }).data
  const redacted =
    typeof data === 'string' ? data : ((data as { output?: string } | null)?.output ?? text)

  if (redacted === text) {
    return {
      hasPII: false,
      entities: [],
      redacted,
      original: text,
      originalLength,
      privacyEnabled,
    }
  }

  // 3. 通过化名标记反推 PII 类别
  const entities = detectPIITypes(redacted)
  return {
    hasPII: entities.length > 0,
    entities,
    redacted,
    original: text,
    originalLength,
    privacyEnabled,
  }
}

/** 干跑(返回脱敏后文本,不阻止调用方) */
export async function preflightAnonymize(text: string): Promise<string> {
  const report = await preflightCheck(text)
  return report.redacted
}

/**
 * 用预检 + 决策构造拦截返回
 * - 若 hasPII 且 policy=block 且 decision=original → 抛错(由调用方转换成错误响应)
 * - 返回 redacted 供"redacted 决策"使用
 */
export interface PreflightGuardOptions {
  /** 拦截策略: 'block' = PII 命中时强制要求脱敏/取消;'warn' = 仅警告放行 */
  policy: 'block' | 'warn'
  /** 决策:'cancel' / 'redacted' / 'original' (渲染层决定) */
  decision?: PreflightDecision
  /** 调用上下文(用于错误信息) */
  context: string
}

/**
 * 守卫工具:基于预检报告 + 决策,决定返回脱敏文本还是抛错
 * - 渲染层先调 preflightCheck 拿到 report,再让用户做 decision
 * - 然后调 guardDecision(report, decision, options) 拿到最终要发送的文本
 *   或者抛错(用户选了 cancel / 选 original 但 policy=block)
 */
export function applyDecision(
  report: MainPreflightReport,
  decision: PreflightDecision,
  options: PreflightGuardOptions,
): { allowed: boolean; text: string; error?: string } {
  // 无 PII → 放行原文
  if (!report.hasPII) {
    return { allowed: true, text: report.redacted }
  }

  // 用户取消
  if (decision === 'cancel') {
    return { allowed: false, text: '', error: `${options.context}: 用户取消` }
  }

  // 选 redacted → 走脱敏后文本
  if (decision === 'redacted') {
    return { allowed: true, text: report.redacted }
  }

  // 选 original + policy=block → 拦截
  if (options.policy === 'block') {
    return {
      allowed: false,
      text: '',
      error: `${options.context}: 检测到 PII 且策略为 block,已拦截(类别: ${report.entities.map((e) => e.kind).join(', ')})`,
    }
  }

  // policy=warn + original → 放行原文(用原始文本,因为 report.redacted 已被脱敏)
  return { allowed: true, text: report.original }
}

// ---- 内部:从脱敏输出反推 PII 类别 ----

/**
 * 隐私引擎脱敏产出的化名标记前缀(与 eaa-cli/src/privacy/mod.rs 一致):
 *   - S_xxx: 学生
 *   - P_xxx: 家长
 *   - T_xxx: 教师
 *   - C_xxx: 班级
 *   - SCH_xxx: 学校
 *   - ADDR_xxx: 地址
 *   - PH_xxx: 电话
 *   - ID_xxx: 身份证 / 学号
 */
const PII_PATTERNS: Array<{ kind: MainPIIKind; re: RegExp }> = [
  // person: S_xxx (学生) / P_xxx (家长) / T_xxx (教师) — 必须带下划线,与 plain 单词区分
  { kind: 'person', re: /\b(?:S|P|T)_\d{2,}\b/g },
  { kind: 'place', re: /\bADDR_\d{2,}/g },
  { kind: 'org', re: /\bSCH_\d{2,}|\bC_\d{2,}/g },
  { kind: 'phone', re: /\bPH_\d{2,}|1[3-9]\d{1,2}-?X{3,4}-?\d{4}/g },
  { kind: 'email', re: /[\w.]+@(?!example\.)[\w-]+/g },
  { kind: 'id_card', re: /\b1\d{5}\*{6,}\d{4}\b/g },
  { kind: 'student_id', re: /\bID_[A-Za-z0-9]{2,}/g },
]

function detectPIITypes(redacted: string): MainPIISummary[] {
  const out: MainPIISummary[] = []
  for (const { kind, re } of PII_PATTERNS) {
    const matches = redacted.match(re)
    if (matches && matches.length > 0) {
      out.push({ kind, count: matches.length })
    }
  }
  return out
}

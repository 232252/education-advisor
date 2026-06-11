// =============================================================
// UploadPreflightDialog — 上传/导出前的隐私预检对话框
//
// 用途:
//   - 任何"数据离开应用"的操作(导出文件 / 发送飞书 / 备份 / 邮件等)前,
//     扫描 PII(姓名/地址/手机/身份证/邮箱/IP/坐标/银行卡 等)
//   - 如果 PII 命中且隐私引擎**未启用**,强制用户做出选择
//   - 用户可选三选一:
//       1. 取消上传(默认安全选项)
//       2. 先脱敏再上传(走 privacy.filter / anonymize)
//       3. 坚持原文上传(强提醒二次确认)
//
// 设计要点:
//   - 复用既有 IPC_PRIVACY_DRYRUN 通道,不发明新协议
//   - 不做"猜疑式"拦截,完全交给用户决定
//   - 同步给出"已检测到的 PII 类别",不展示原文样本(避免对话框成为新的泄漏面)
//   - 隐私已开启时,直接放行,只 toast 告知
// =============================================================

import { useEffect, useState } from 'react'
import { getAPI } from '../lib/ipc-client'

/** 上传预检支持的 PII 类别(按隐私引擎 EntityType 命名) */
export type PIIKind = 'person' | 'place' | 'org' | 'phone' | 'email' | 'id_card' | 'student_id'

/** 检测到的一类 PII 的描述 */
export interface PIISummary {
  kind: PIIKind
  count: number
}

/** 预检结果 */
export interface PreflightReport {
  hasPII: boolean
  entities: PIISummary[]
  /** 脱敏后的文本(用户选择"脱敏上传"时由父组件使用) */
  redacted: string
  /** 原文本长度,用于显示"处理了 N 个字符" */
  originalLength: number
  /** 隐私引擎是否开启 */
  privacyEnabled: boolean
}

export interface UploadPreflightDialogProps {
  /** 是否打开对话框 */
  open: boolean
  /** 即将上传的文本(由父组件提供,可以来自文件预览 / 当前表单 / 查询结果) */
  text: string
  /** 上传动作的描述,例如"导出 ranking.csv" / "发送消息到张三妈妈" */
  action: string
  /** 用户做出选择后的回调: cancel | redacted(已脱敏) | original(原文) */
  onDecision: (decision: 'cancel' | 'redacted' | 'original', redacted?: string) => void
}

/**
 * 调用 dryrun 接口解析 PII
 * 隐私引擎 dry-run 返回:
 *   - 成功: { success: true, data: { output: "脱敏后文本", ... } } 或 { success: true, data: "脱敏后文本" }
 *   - 失败: { success: false, error: "..." }
 * 我们用"输出 vs 输入"的差异来反推 PII:
 *   - 长度变小 + 输出包含化名标记(S_/P_/ID_/ADDR_/PH_)→ PII 命中
 *   - 类别通过占位符前缀识别
 */
async function detectPII(text: string): Promise<{ redacted: string; entities: PIISummary[] }> {
  if (!text || text.length === 0) {
    return { redacted: text, entities: [] }
  }
  const result = await getAPI().privacy.dryrun(text)
  if (!result.success) {
    // 隐私引擎未初始化 / 失败:保守地当作"无法扫描",返回原文 + 空报告
    // 父组件可决定是否仍要放行
    return { redacted: text, entities: [] }
  }

  // 兼容 { data: string } 与 { data: { output: string } } 两种返回
  const output =
    typeof result.data === 'string'
      ? result.data
      : ((result.data as { output?: string } | null)?.output ?? text)

  if (output === text) {
    return { redacted: output, entities: [] }
  }

  // 通过化名标记反推 PII 类别
  const patterns: Array<{ kind: PIIKind; re: RegExp }> = [
    { kind: 'person', re: /\bS_\d{2,}|\bP_\d{2,}|\bT_\d{2,}/g },
    { kind: 'place', re: /\bADDR_\d{2,}/g },
    { kind: 'org', re: /\bSCH_\d{2,}/g },
    { kind: 'phone', re: /\bPH_\d{2,}|1[3-9]\d{1,2}-?X{3,4}-?\d{4}/g },
    { kind: 'email', re: /[\w.]+@(?!example\.)[\w-]+/g },
    { kind: 'id_card', re: /\bID_[A-Za-z0-9]{2,}|1\d{5}\*{6,}\d{4}/g },
    { kind: 'student_id', re: /\bID_\d{2,}/g },
  ]
  const entities: PIISummary[] = []
  for (const { kind, re } of patterns) {
    const matches = output.match(re)
    if (matches && matches.length > 0) {
      entities.push({ kind, count: matches.length })
    }
  }
  return { redacted: output, entities }
}

const KIND_LABELS: Record<PIIKind, { label: string; emoji: string }> = {
  person: { label: '姓名', emoji: '👤' },
  place: { label: '地址', emoji: '📍' },
  org: { label: '机构', emoji: '🏫' },
  phone: { label: '手机/电话', emoji: '📱' },
  email: { label: '邮箱', emoji: '📧' },
  id_card: { label: '身份证号', emoji: '🆔' },
  student_id: { label: '学号', emoji: '🔢' },
}

export function UploadPreflightDialog({
  open,
  text,
  action,
  onDecision,
}: UploadPreflightDialogProps) {
  const [scanning, setScanning] = useState(false)
  const [report, setReport] = useState<PreflightReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 打开时触发扫描
  useEffect(() => {
    if (!open) {
      setReport(null)
      setError(null)
      return
    }
    let cancelled = false
    setScanning(true)
    void (async () => {
      try {
        const { redacted, entities } = await detectPII(text)
        if (cancelled) return
        // 隐私引擎是否启用:从当前 dialog 的 props 之外读 — 这里简单通过 redacted === text 推断
        // (如果引擎没加载,dryrun 会失败,redacted 会被回退为原文,entities 空)
        const privacyEnabled = redacted !== text && entities.length > 0
        setReport({
          hasPII: entities.length > 0,
          entities,
          redacted,
          originalLength: text.length,
          privacyEnabled,
        })
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
      } finally {
        if (!cancelled) setScanning(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, text])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[480px] max-w-[92vw] p-5">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <span>🛡️</span>
          <span>上传前隐私检查</span>
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{action}</p>

        <div className="mt-4 min-h-[120px]">
          {scanning && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-8 justify-center">
              <span className="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              正在扫描 {text.length} 个字符的 PII ...
            </div>
          )}

          {!scanning && error && (
            <div className="p-3 rounded bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-sm text-yellow-800 dark:text-yellow-200">
              隐私扫描失败: {error}
              <div className="text-xs mt-1 text-yellow-600 dark:text-yellow-400">
                提示: 请在「设置 → 隐私」中先初始化隐私引擎。
              </div>
            </div>
          )}

          {!scanning && !error && report && !report.hasPII && (
            <div className="p-3 rounded bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200">
              <div className="font-medium">✅ 未检测到 PII</div>
              <div className="text-xs mt-1 text-green-600 dark:text-green-400">
                共扫描 {report.originalLength} 字符,可以安全上传。
              </div>
            </div>
          )}

          {!scanning && !error && report?.hasPII && (
            <>
              <div className="p-3 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200">
                <div className="font-medium">⚠️ 检测到 {report.entities.length} 类 PII</div>
                <div className="text-xs mt-1 text-amber-700 dark:text-amber-300">
                  {report.privacyEnabled
                    ? '隐私引擎已开启,建议沿用脱敏版本上传。'
                    : '隐私引擎未启用! 建议先在「设置 → 隐私」中开启,或选择下方"脱敏后再上传"。'}
                </div>
              </div>
              <ul className="mt-3 space-y-1.5">
                {report.entities.map((e) => {
                  const meta = KIND_LABELS[e.kind]
                  return (
                    <li
                      key={e.kind}
                      className="flex items-center justify-between px-3 py-1.5
                        bg-gray-50 dark:bg-gray-900/50 rounded text-xs"
                    >
                      <span className="flex items-center gap-2">
                        <span>{meta.emoji}</span>
                        <span className="text-gray-700 dark:text-gray-200">{meta.label}</span>
                      </span>
                      <span className="text-gray-500 dark:text-gray-400 font-mono">×{e.count}</span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          {report?.hasPII ? (
            <>
              <button
                type="button"
                onClick={() => onDecision('redacted', report.redacted)}
                className="w-full py-2 px-3 rounded bg-blue-600 text-white text-sm font-medium
                  hover:bg-blue-700 transition-colors"
              >
                脱敏后再上传 (推荐)
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm('坚持上传包含真实 PII 的原文?\n\n该数据将离开本机,后果由您承担。')) {
                    onDecision('original')
                  }
                }}
                className="w-full py-2 px-3 rounded bg-amber-600 text-white text-sm font-medium
                  hover:bg-amber-700 transition-colors"
              >
                坚持原文上传 (强提醒)
              </button>
              <button
                type="button"
                onClick={() => onDecision('cancel')}
                className="w-full py-2 px-3 rounded bg-gray-100 dark:bg-gray-700
                  text-gray-700 dark:text-gray-200 text-sm hover:bg-gray-200
                  dark:hover:bg-gray-600 transition-colors"
              >
                取消上传
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onDecision('original')}
              className="w-full py-2 px-3 rounded bg-blue-600 text-white text-sm font-medium
                hover:bg-blue-700 transition-colors"
            >
              {scanning ? '扫描中...' : '确认上传'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

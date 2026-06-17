// =============================================================
// AgentApprovalDialog — HITL 人工审批弹窗
//
// 监听 approvalStore.pending,有请求时模态展示:
//   - 工具名 / Agent / 风险等级
//   - 参数 JSON（可折叠）
//   - 批准 / 拒绝 / 编辑参数后批准
//
// 放置位置: App.tsx 全局挂载,保证任何页面都能弹出。
// =============================================================

import { useState } from 'react'
import { useApprovalStore } from '../stores/approvalStore'

const RISK_LABELS: Record<string, { label: string; color: string }> = {
  low: { label: '只读 / 低风险', color: 'text-green-600 dark:text-green-400' },
  medium: { label: '写入 / 中风险', color: 'text-yellow-600 dark:text-yellow-400' },
  high: { label: '删除 / 高风险', color: 'text-orange-600 dark:text-orange-400' },
  destructive: { label: '破坏性操作', color: 'text-red-600 dark:text-red-400' },
}

export function AgentApprovalDialog() {
  const { pending, resolving, approve, reject, edit, dismiss } = useApprovalStore()
  const req = pending[0] ?? null
  const [showArgs, setShowArgs] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editedArgs, setEditedArgs] = useState('')

  if (!req) return null

  const risk = RISK_LABELS[req.risk] ?? { label: req.risk, color: 'text-gray-600' }
  const argsText = JSON.stringify(req.args, null, 2)

  const handleApprove = () => approve('user')
  const handleReject = () => reject('user', '用户拒绝')
  const handleEditApprove = () => {
    try {
      const parsed = JSON.parse(editedArgs) as Record<string, unknown>
      void edit('user', parsed)
      setEditMode(false)
    } catch {
      alert('参数 JSON 格式错误,请检查')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[520px] max-w-[94vw] p-5">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <span>🛡️</span>
          <span>Agent 操作需要审批</span>
        </h2>

        <div className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-500 dark:text-gray-400">工具</span>
            <span className="font-mono font-medium text-gray-800 dark:text-gray-100">
              {req.tool}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500 dark:text-gray-400">Agent</span>
            <span className="text-gray-800 dark:text-gray-100">{req.agentId}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500 dark:text-gray-400">风险等级</span>
            <span className={`font-medium ${risk.color}`}>{risk.label}</span>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowArgs((v) => !v)}
              className="text-blue-600 dark:text-blue-400 hover:underline text-xs"
            >
              {showArgs ? '隐藏参数' : '查看参数'}
            </button>
            {showArgs && (
              <pre className="mt-2 max-h-[200px] overflow-auto rounded bg-gray-50 dark:bg-gray-900 p-3 text-xs text-gray-700 dark:text-gray-300 font-mono">
                {argsText}
              </pre>
            )}
          </div>

          {editMode && (
            <div className="space-y-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">编辑参数(JSON)后批准</span>
              <textarea
                className="w-full h-32 rounded border border-gray-300 dark:border-gray-600
                  bg-white dark:bg-gray-900 p-2 text-xs font-mono
                  text-gray-800 dark:text-gray-200"
                defaultValue={argsText}
                onChange={(e) => setEditedArgs(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          {!editMode ? (
            <>
              <button
                type="button"
                disabled={resolving}
                onClick={handleApprove}
                className="w-full py-2 px-3 rounded bg-blue-600 text-white text-sm font-medium
                  hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {resolving ? '处理中...' : '✅ 批准执行'}
              </button>
              <button
                type="button"
                disabled={resolving}
                onClick={() => setEditMode(true)}
                className="w-full py-2 px-3 rounded bg-gray-100 dark:bg-gray-700
                  text-gray-700 dark:text-gray-200 text-sm
                  hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-60"
              >
                ✏️ 编辑参数后批准
              </button>
              <button
                type="button"
                disabled={resolving}
                onClick={handleReject}
                className="w-full py-2 px-3 rounded bg-red-50 dark:bg-red-900/20
                  text-red-700 dark:text-red-200 text-sm font-medium
                  hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-60"
              >
                ❌ 拒绝执行
              </button>
              <button
                type="button"
                disabled={resolving}
                onClick={dismiss}
                className="w-full py-2 px-3 rounded bg-transparent text-gray-500 dark:text-gray-400
                  text-sm hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                稍后处理
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={resolving}
                onClick={handleEditApprove}
                className="w-full py-2 px-3 rounded bg-blue-600 text-white text-sm font-medium
                  hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {resolving ? '处理中...' : '确认编辑并批准'}
              </button>
              <button
                type="button"
                disabled={resolving}
                onClick={() => setEditMode(false)}
                className="w-full py-2 px-3 rounded bg-gray-100 dark:bg-gray-700
                  text-gray-700 dark:text-gray-200 text-sm hover:bg-gray-200
                  dark:hover:bg-gray-600 transition-colors disabled:opacity-60"
              >
                取消编辑
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// =============================================================
// ModelRow — 单个模型行(显示/编辑模式)
// 从 ModelsPage.tsx 抽出。逻辑零修改(逐行对照搬迁)。
// =============================================================

import type { ModelInfo } from '@shared/types'
import { memo } from 'react'

/** 格式化 token 成本(美元/百万 token) */
function formatCost(costPerToken: number): string {
  if (costPerToken === 0) return '免费'
  const perMillion = costPerToken * 1_000_000
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}/M`
  return `$${perMillion.toFixed(2)}/M`
}

/** 格式化上下文窗口大小 */
function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`
  return String(tokens)
}

export interface ModelRowProps {
  model: ModelInfo
  isEditing: boolean
  editForm: Record<string, string>
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onEditFormChange: (form: Record<string, string>) => void
  onDelete?: () => void
  onUpdateAvailable: boolean
  onDeleteAvailable: boolean
}

export const ModelRow = memo(function ModelRow({
  model: m,
  isEditing,
  editForm,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditFormChange,
  onDelete,
  onUpdateAvailable,
  onDeleteAvailable,
}: ModelRowProps) {
  if (isEditing && m.isCustom) {
    // 编辑模式：显示可编辑表单
    return (
      <>
        <tr className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
          <td className="px-3 py-2">
            <div className="font-medium text-gray-700 dark:text-gray-200">{m.name}</div>
            <div className="text-gray-400 dark:text-gray-500 font-mono text-[10px]">{m.id}</div>
            {m.isCustom && (
              <span className="text-[9px] bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1 rounded">
                自定义
              </span>
            )}
          </td>
          <td className="px-3 py-2">
            <select
              value={editForm.api ?? ''}
              onChange={(e) => onEditFormChange({ ...editForm, api: e.target.value })}
              className="bg-white dark:bg-surface-elevated border border-gray-300 dark:border-white/[0.08] rounded px-1 py-0.5 text-[10px] font-mono w-full"
            >
              <option value="openai-completions">openai-completions</option>
              <option value="openai-responses">openai-responses</option>
              <option value="anthropic-messages">anthropic-messages</option>
              <option value="mistral-conversations">mistral-conversations</option>
              <option value="google-generative-ai">google-generative-ai</option>
            </select>
          </td>
          <td className="px-3 py-2">
            <input
              type="number"
              value={editForm.contextWindow ?? ''}
              onChange={(e) => onEditFormChange({ ...editForm, contextWindow: e.target.value })}
              className="bg-white dark:bg-surface-elevated border border-gray-300 dark:border-white/[0.08] rounded px-1 py-0.5 text-[10px] font-mono w-full text-right"
            />
          </td>
          <td className="px-3 py-2">
            <input
              type="number"
              value={editForm.maxOutputTokens ?? ''}
              onChange={(e) => onEditFormChange({ ...editForm, maxOutputTokens: e.target.value })}
              className="bg-white dark:bg-surface-elevated border border-gray-300 dark:border-white/[0.08] rounded px-1 py-0.5 text-[10px] font-mono w-full text-right"
            />
          </td>
          <td className="px-3 py-2">
            <input
              type="number"
              step="0.0000001"
              value={editForm.costPerInputToken ?? ''}
              onChange={(e) => onEditFormChange({ ...editForm, costPerInputToken: e.target.value })}
              className="bg-white dark:bg-surface-elevated border border-gray-300 dark:border-white/[0.08] rounded px-1 py-0.5 text-[10px] font-mono w-full text-right"
            />
          </td>
          <td className="px-3 py-2">
            <input
              type="number"
              step="0.0000001"
              value={editForm.costPerOutputToken ?? ''}
              onChange={(e) =>
                onEditFormChange({ ...editForm, costPerOutputToken: e.target.value })
              }
              className="bg-white dark:bg-surface-elevated border border-gray-300 dark:border-white/[0.08] rounded px-1 py-0.5 text-[10px] font-mono w-full text-right"
            />
          </td>
          <td className="px-3 py-2 text-center">
            <select
              value={editForm.supportsReasoning ?? 'false'}
              onChange={(e) => onEditFormChange({ ...editForm, supportsReasoning: e.target.value })}
              className="bg-white dark:bg-surface-elevated border border-gray-300 dark:border-white/[0.08] rounded px-1 py-0.5 text-[10px] w-full"
            >
              <option value="true">R</option>
              <option value="false">-</option>
            </select>
          </td>
          <td className="px-3 py-2 text-center">
            <div className="flex items-center gap-1 justify-center">
              <button
                type="button"
                onClick={onSaveEdit}
                className="bg-green-600 hover:bg-green-700 text-white px-2 py-0.5 rounded text-[10px] transition-colors"
              >
                保存
              </button>
              <button
                type="button"
                onClick={onCancelEdit}
                className="bg-gray-400 hover:bg-gray-500 text-white px-2 py-0.5 rounded text-[10px] transition-colors"
              >
                取消
              </button>
            </div>
          </td>
        </tr>
        {/* Base URL 编辑行 */}
        <tr className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
          <td colSpan={8} className="px-3 py-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                Base URL:
              </span>
              <input
                type="text"
                value={editForm.baseUrl ?? ''}
                onChange={(e) => onEditFormChange({ ...editForm, baseUrl: e.target.value })}
                placeholder="留空使用 Provider 默认值"
                className="flex-1 bg-white dark:bg-surface-elevated border border-gray-300 dark:border-white/[0.08] rounded px-2 py-0.5 text-[10px] font-mono"
              />
            </div>
          </td>
        </tr>
      </>
    )
  }

  // 显示模式
  return (
    <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-200/50 dark:hover:bg-gray-800/50 transition-colors">
      <td className="px-3 py-2">
        <div className="font-medium text-gray-700 dark:text-gray-200">{m.name}</div>
        <div className="text-gray-400 dark:text-gray-500 font-mono text-[10px]">{m.id}</div>
        {m.isCustom && (
          <span className="text-[9px] bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1 rounded">
            自定义
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <span className="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300 font-mono text-[10px]">
          {m.api}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono text-gray-600 dark:text-gray-300">
        {formatContextWindow(m.contextWindow)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-gray-600 dark:text-gray-300">
        {formatContextWindow(m.maxOutputTokens)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-gray-600 dark:text-gray-300">
        {formatCost(m.costPerInputToken)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-gray-600 dark:text-gray-300">
        {formatCost(m.costPerOutputToken)}
      </td>
      <td className="px-3 py-2 text-center">
        {m.supportsReasoning ? (
          <span className="text-blue-500 dark:text-blue-400" title="支持推理">
            R
          </span>
        ) : (
          <span className="text-gray-400 dark:text-gray-600">-</span>
        )}
      </td>
      {(onUpdateAvailable || onDeleteAvailable) && (
        <td className="px-3 py-2 text-center">
          {m.isCustom && (
            <div className="flex items-center gap-1 justify-center">
              {onUpdateAvailable && (
                <button
                  type="button"
                  onClick={onStartEdit}
                  className="text-blue-500 hover:text-blue-400 text-[10px] transition-colors"
                  title="编辑属性"
                >
                  编辑
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="text-red-500 hover:text-red-400 text-[10px] transition-colors"
                  title="删除"
                >
                  删除
                </button>
              )}
            </div>
          )}
        </td>
      )}
    </tr>
  )
})

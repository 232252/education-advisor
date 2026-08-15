// =============================================================
// AI 智能录入面板 — 粘贴成绩文本 + 流式解析进度展示
// (需已配置 AI 模型,否则禁用并提示)
// =============================================================

import { Sparkles } from 'lucide-react'
import { Button } from '../../../../components/Button'
import { Card } from '../../../../components/Card'

interface AIEntryPanelProps {
  aiInputText: string
  onAiInputTextChange: (value: string) => void
  aiParsing: boolean
  aiProgress: string
  currentProvider: string
  currentModel: string
  onParse: () => void
  onClose: () => void
}

export function AIEntryPanel({
  aiInputText,
  onAiInputTextChange,
  aiParsing,
  aiProgress,
  currentProvider,
  currentModel,
  onParse,
  onClose,
}: AIEntryPanelProps) {
  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          🤖 AI 智能录入 — 粘贴文本,自动解析
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
        >
          ×
        </button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        支持多种格式: &ldquo;张三 85, 李四 92&rdquo;、表格文本、微信聊天记录等。
        {currentProvider && currentModel
          ? ` 当前模型: ${currentProvider}/${currentModel}`
          : ' ⚠️ 请先在"模型"页面配置 AI 模型'}
      </p>
      <textarea
        value={aiInputText}
        onChange={(e) => onAiInputTextChange(e.target.value)}
        placeholder={'粘贴成绩文本,例如:\n张三 85\n李四 92\n王五 78分\n赵六 88 排名3'}
        rows={6}
        className="w-full bg-gray-50 dark:bg-surface-primary border border-gray-200 dark:border-white/[0.06] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 font-mono"
        disabled={aiParsing}
      />
      <div className="flex items-center gap-2 mt-2">
        <Button
          variant="primary"
          size="sm"
          loading={aiParsing}
          icon={!aiParsing ? <Sparkles className="h-3.5 w-3.5" /> : undefined}
          onClick={onParse}
          disabled={aiParsing || !aiInputText.trim() || !currentProvider || !currentModel}
        >
          {aiParsing ? '解析中...' : 'AI 解析并填充'}
        </Button>
        {aiProgress && (
          <span className="text-xs text-gray-500 dark:text-gray-400">{aiProgress}</span>
        )}
      </div>
      {!currentProvider && (
        <p className="text-xs text-amber-500 mt-2">
          💡 未检测到 AI 模型配置。请先到&ldquo;模型&rdquo;页面选择并配置一个 AI 提供商。
        </p>
      )}
    </Card>
  )
}

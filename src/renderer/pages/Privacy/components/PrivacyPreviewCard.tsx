// =============================================================
// PrivacyPreviewCard — 脱敏预览卡(输入文本 → 查看脱敏效果)
// 结构自 PrivacyPage.tsx 逐字搬移
// =============================================================

import { Card } from '../../../components/Card'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'

interface PrivacyPreviewCardProps {
  previewInput: string
  setPreviewInput: (v: string) => void
  onPreview: () => void
  previewResult: string
}

export function PrivacyPreviewCard({
  previewInput,
  setPreviewInput,
  onPreview,
  previewResult,
}: PrivacyPreviewCardProps) {
  return (
    <Card padding="md" className="bg-gray-50 dark:bg-surface-tertiary">
      <h2 className="font-semibold mb-3">脱敏预览</h2>
      <textarea
        value={previewInput}
        onChange={(e) => setPreviewInput(e.target.value)}
        placeholder="输入包含学生姓名的文本，查看脱敏效果..."
        rows={3}
        className={cn('w-full resize-none mb-3', INPUT_BASE)}
      />
      <button
        type="button"
        onClick={onPreview}
        aria-label="测试脱敏"
        className={btnStyle('primary')}
      >
        测试脱敏
      </button>
      {previewResult && (
        <pre className="mt-3 bg-gray-100 dark:bg-surface-elevated rounded-lg p-3 text-sm font-mono text-gray-600 dark:text-gray-300 overflow-x-auto">
          {previewResult}
        </pre>
      )}
    </Card>
  )
}

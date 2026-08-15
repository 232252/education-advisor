// =============================================================
// PrivacyLoadCard — 加密映射表加载/备份卡
// 结构自 PrivacyPage.tsx 逐字搬移
// =============================================================

import { Card } from '../../../components/Card'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'

interface PrivacyLoadCardProps {
  password: string
  setPassword: (v: string) => void
  onLoad: () => void
  onBackup: () => void
  isLoaded: boolean
  mappingsCount: number
}

export function PrivacyLoadCard({
  password,
  setPassword,
  onLoad,
  onBackup,
  isLoaded,
  mappingsCount,
}: PrivacyLoadCardProps) {
  return (
    <Card padding="md" className="bg-gray-50 dark:bg-surface-tertiary">
      <h2 className="font-semibold mb-3">加密映射表</h2>
      <div className="flex gap-3 items-center">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="输入隐私密码..."
          className={cn('flex-1', INPUT_BASE)}
        />
        <button
          type="button"
          onClick={onLoad}
          aria-label="加载映射表"
          className={btnStyle('primary')}
        >
          加载映射表
        </button>
        <button
          type="button"
          onClick={onBackup}
          disabled={!isLoaded}
          aria-label="备份映射表"
          className={btnStyle('secondary')}
        >
          备份
        </button>
      </div>
      {isLoaded && (
        <div className="mt-3 text-sm text-green-500 dark:text-green-400">
          已加载 {mappingsCount} 条映射记录
        </div>
      )}
    </Card>
  )
}

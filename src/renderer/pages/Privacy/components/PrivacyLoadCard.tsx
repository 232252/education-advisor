// =============================================================
// PrivacyLoadCard — 加密映射表加载/备份卡
// 结构自 PrivacyPage.tsx 逐字搬移
// =============================================================

import { Card } from '../../../components/Card'
import { tr, useT } from '../../../i18n'
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
  const { t } = useT()
  return (
    <Card padding="md" className="bg-gray-50 dark:bg-surface-tertiary">
      <h2 className="font-semibold mb-3">{t('page.privacy.load.title', '加密映射表')}</h2>
      <div className="flex gap-3 items-center">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('page.privacy.load.passwordPlaceholder', '输入隐私密码...')}
          className={cn('flex-1', INPUT_BASE)}
        />
        <button
          type="button"
          onClick={onLoad}
          aria-label={t('page.privacy.load.ariaLoad', '加载映射表')}
          className={btnStyle('primary')}
        >
          {t('page.privacy.load.action', '加载映射表')}
        </button>
        <button
          type="button"
          onClick={onBackup}
          disabled={!isLoaded}
          aria-label={t('page.privacy.load.ariaBackup', '备份映射表')}
          className={btnStyle('secondary')}
        >
          {t('page.privacy.load.backup', '备份')}
        </button>
      </div>
      {isLoaded && (
        <div className="mt-3 text-sm text-green-500 dark:text-green-400">
          {tr(
            'page.privacy.load.loadedCount',
            { count: String(mappingsCount) },
            '已加载 {count} 条映射记录',
          )}
        </div>
      )}
    </Card>
  )
}

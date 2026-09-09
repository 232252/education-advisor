// =============================================================
// PrivacyInitCard — 隐私引擎初始化引导卡(首次使用)
// 结构自 PrivacyPage.tsx 逐字搬移
// =============================================================

import { useT } from '../../../i18n'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'

interface PrivacyInitCardProps {
  initPassword: string
  setInitPassword: (v: string) => void
  onInit: () => void
}

export function PrivacyInitCard({ initPassword, setInitPassword, onInit }: PrivacyInitCardProps) {
  const { t } = useT()
  return (
    <div className="bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800 rounded-xl p-5">
      <h2 className="font-semibold mb-2">{t('page.privacy.init.title')}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{t('page.privacy.init.desc')}</p>
      <div className="flex gap-3 items-center">
        <input
          type="password"
          value={initPassword}
          onChange={(e) => setInitPassword(e.target.value)}
          placeholder={t('page.privacy.init.passwordPlaceholder')}
          className={cn('flex-1', INPUT_BASE)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onInit()
          }}
        />
        <button
          type="button"
          onClick={onInit}
          disabled={initPassword.length < 4}
          aria-label={t('page.privacy.init.ariaInit')}
          className={btnStyle('primary')}
        >
          {t('page.privacy.init.action')}
        </button>
      </div>
    </div>
  )
}

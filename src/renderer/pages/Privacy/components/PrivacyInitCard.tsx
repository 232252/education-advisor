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
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
        设置一个加密密码来保护学生隐私数据。初始化后，所有敏感信息将自动脱敏处理。
        密码仅在本次传输,主进程在内存中保留,关闭软件或点击"锁定"后将清空。
      </p>
      <div className="flex gap-3 items-center">
        <input
          type="password"
          value={initPassword}
          onChange={(e) => setInitPassword(e.target.value)}
          placeholder="设置隐私密码（至少 4 位）..."
          className={cn('flex-1', INPUT_BASE)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onInit()
          }}
        />
        <button
          type="button"
          onClick={onInit}
          disabled={initPassword.length < 4}
          aria-label="初始化隐私引擎"
          className={btnStyle('primary')}
        >
          初始化
        </button>
      </div>
    </div>
  )
}
